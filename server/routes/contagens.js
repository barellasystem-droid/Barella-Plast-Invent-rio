const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const { requireAuth, requireEdit, requireViewAny } = require('../auth');
const { computeDivergence } = require('../calc');
const { parseXlsxBuffer, parsePdfBuffer, normalizeCode } = require('../import-parsers');
const { getRawMaterialSummary } = require('../materiaPrimaProduzida');
const { ESTADOS } = require('../constants');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const viewContagem = requireViewAny(['contagem', 'contagem_mobile']);

// Contagem só pode receber lançamentos/edições no dia em que foi iniciada —
// "data" é sempre o dia de hoje no fuso de Brasília na criação (nunca
// informada pelo cliente, ver POST / abaixo), então uma contagem de outro dia
// é sempre passado, nunca futuro. Também trava quando o status é FINALIZADA,
// independente da data — quem finalizou não quer que ninguém (nem no mesmo
// dia) siga lançando por engano; só um administrador reabre (ver PUT /:id).
// Usado por toda rota que "conta" alguma coisa (lançamento, saldo do
// sistema, importação, estoque de produto/virgem, estado da mistura);
// consulta (GET) nunca é bloqueada.
const HOJE_SQL = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";

async function assertContagemDeHoje(contagemId) {
  const { rows } = await db.query(`SELECT status, (data = ${HOJE_SQL}) AS "isToday" FROM contagens WHERE id = $1`, [contagemId]);
  if (!rows.length) {
    const err = new Error('Contagem não encontrada.');
    err.status = 404;
    throw err;
  }
  if (rows[0].status === 'FINALIZADA') {
    const err = new Error('Essa contagem já foi finalizada — só é possível consultar. Um administrador pode reabri-la.');
    err.status = 403;
    throw err;
  }
  if (!rows[0].isToday) {
    const err = new Error('Essa contagem é de outra data — só é possível consultar, sem lançar ou editar.');
    err.status = 403;
    throw err;
  }
}

router.get('/', requireAuth, viewContagem, async (req, res) => {
  const { rows } = await db.query('SELECT id, titulo, fornecedor, periodo, status, data, created_at AS "createdAt" FROM contagens ORDER BY data DESC, created_at DESC');
  res.json(rows);
});

router.post('/', requireAuth, requireEdit('contagem'), async (req, res) => {
  const { titulo, fornecedor, periodo } = req.body || {};
  if (!titulo) return res.status(400).json({ error: 'Informe um título para a contagem.' });
  const id = crypto.randomUUID();
  await db.withTransaction(async (client) => {
    await client.query(
      'INSERT INTO contagens (id, titulo, fornecedor, periodo, created_by) VALUES ($1, $2, $3, $4, $5)',
      [id, titulo, fornecedor || null, periodo || null, req.user.username]
    );
    const { rows: materials } = await client.query('SELECT code FROM raw_materials');
    for (const m of materials) {
      await client.query(
        `INSERT INTO contagem_itens (id, contagem_id, raw_material_code) VALUES ($1, $2, $3)`,
        [crypto.randomUUID(), id, m.code]
      );
    }
    // Toda contagem nova começa zerada (estoque de produto, estoque virgem e
    // estado da mistura) — não copia nada da contagem anterior. Contagem é
    // uma apuração física do zero; começar com valor antigo pré-preenchido
    // mascara item esquecido (fica parecendo que já foi conferido) e gera
    // divergência errada no Relatório de Contagem.
  });
  res.status(201).json({ id });
});

router.put('/:id', requireAuth, requireEdit('contagem'), async (req, res) => {
  const { titulo, fornecedor, periodo, status } = req.body || {};
  if (status !== undefined) {
    const { rows } = await db.query('SELECT status FROM contagens WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Contagem não encontrada.' });
    // Finalizar é uma ação normal de quem edita a contagem; reabrir (tirar o
    // FINALIZADA) só um administrador pode fazer, para não virar rotina
    // reverter uma contagem já fechada.
    if (rows[0].status === 'FINALIZADA' && status !== 'FINALIZADA' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Só um administrador pode reabrir uma contagem finalizada.' });
    }
  }
  const { rowCount } = await db.query(
    `UPDATE contagens SET titulo = COALESCE($1, titulo), fornecedor = $2, periodo = $3, status = COALESCE($4, status) WHERE id = $5`,
    [titulo, fornecedor || null, periodo || null, status, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Contagem não encontrada.' });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireEdit('contagem'), async (req, res) => {
  await db.query('DELETE FROM contagens WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Saldo do Inventário = o que foi contado fisicamente pelo celular (soma dos
// lançamentos) + o que já está "produzido" segundo Explosão/Matéria-Prima
// Produzida (BOM x estoque de produto, virgem, e os estados da mistura) —
// tudo que é informado na aba Explosão entra automaticamente nessa soma,
// para não faltar nem duplicar material que já está em processo/mistura e
// não dá para contar fisicamente de novo.
async function loadItens(contagemId) {
  const [itensRes, producaoPorMaterial] = await Promise.all([
    db.query(
      `SELECT ci.id, ci.raw_material_code AS "rawMaterialCode", rm.nome, rm.unidade,
              ci.saldo_sistema AS "saldoSistema", ci.saldo_sistema_origem AS "saldoSistemaOrigem",
              ci.notas_transito AS "notasTransito", ci.observacao,
              COALESCE(SUM(cl.valor) FILTER (WHERE cl.tipo = 'PESO'), 0) AS "contagemFisica",
              COALESCE(SUM(cl.valor) FILTER (WHERE cl.tipo = 'QUANTIDADE'), 0) AS "contagemQuantidade"
       FROM contagem_itens ci
       JOIN raw_materials rm ON rm.code = ci.raw_material_code
       LEFT JOIN contagem_lancamentos cl ON cl.contagem_item_id = ci.id
       WHERE ci.contagem_id = $1
       GROUP BY ci.id, rm.nome, rm.unidade
       ORDER BY ci.raw_material_code`,
      [contagemId]
    ),
    getRawMaterialSummary(contagemId),
  ]);
  const producaoByCode = new Map(producaoPorMaterial.map((p) => [p.code, p.total]));

  return itensRes.rows.map((r) => {
    const materiaPrimaProduzida = producaoByCode.get(r.rawMaterialCode) || 0;
    const saldoInventario = Number(r.contagemFisica) + Number(materiaPrimaProduzida);
    const { divergencia, percentual, condicao } = computeDivergence(r.saldoSistema, saldoInventario, r.notasTransito);
    return { ...r, materiaPrimaProduzida, saldoInventario, divergencia, divergenciaPercentual: percentual, condicao };
  });
}

router.get('/:id', requireAuth, viewContagem, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, titulo, fornecedor, periodo, status, data, (data = ${HOJE_SQL}) AS "isToday", created_at AS "createdAt"
     FROM contagens WHERE id = $1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Contagem não encontrada.' });
  const itens = await loadItens(req.params.id);
  res.json({ ...rows[0], itens });
});

router.put('/:id/itens/:rawMaterialCode', requireAuth, requireEdit('contagem'), async (req, res) => {
  await assertContagemDeHoje(req.params.id);
  const { saldoSistema, notasTransito, observacao } = req.body || {};
  const { rowCount } = await db.query(
    `UPDATE contagem_itens SET
       saldo_sistema = COALESCE($1, saldo_sistema),
       saldo_sistema_origem = CASE WHEN $1 IS NOT NULL THEN 'manual' ELSE saldo_sistema_origem END,
       notas_transito = COALESCE($2, notas_transito),
       observacao = COALESCE($3, observacao),
       updated_at = now()
     WHERE contagem_id = $4 AND raw_material_code = $5`,
    [saldoSistema === undefined ? null : Number(saldoSistema), notasTransito === undefined ? null : Number(notasTransito), observacao === undefined ? null : observacao, req.params.id, req.params.rawMaterialCode]
  );
  if (!rowCount) return res.status(404).json({ error: 'Item não encontrado nessa contagem.' });
  res.json({ ok: true });
});

// Lançamentos de contagem física (celular): cada valor somado fica registrado
// individualmente (não só o total), para dar pra conferir/apagar um valor
// digitado errado sem perder o resto do que já foi contado naquele material.
router.get('/:id/itens/:rawMaterialCode/lancamentos', requireAuth, viewContagem, async (req, res) => {
  const { rows: itemRows } = await db.query(
    'SELECT id FROM contagem_itens WHERE contagem_id = $1 AND raw_material_code = $2',
    [req.params.id, req.params.rawMaterialCode]
  );
  if (!itemRows.length) return res.status(404).json({ error: 'Item não encontrado nessa contagem.' });
  const { rows } = await db.query(
    'SELECT id, valor, tipo, criado_por AS "criadoPor", criado_em AS "criadoEm" FROM contagem_lancamentos WHERE contagem_item_id = $1 ORDER BY criado_em',
    [itemRows[0].id]
  );
  res.json(rows);
});

router.post('/:id/itens/:rawMaterialCode/lancamentos', requireAuth, requireEdit('contagem_mobile'), async (req, res) => {
  await assertContagemDeHoje(req.params.id);
  const valor = Number((req.body || {}).valor);
  const tipo = (req.body || {}).tipo === 'QUANTIDADE' ? 'QUANTIDADE' : 'PESO';
  if (Number.isNaN(valor)) return res.status(400).json({ error: 'Valor inválido.' });
  const { rows: itemRows } = await db.query(
    'SELECT id FROM contagem_itens WHERE contagem_id = $1 AND raw_material_code = $2',
    [req.params.id, req.params.rawMaterialCode]
  );
  if (!itemRows.length) return res.status(404).json({ error: 'Item não encontrado nessa contagem.' });
  const id = crypto.randomUUID();
  await db.query(
    'INSERT INTO contagem_lancamentos (id, contagem_item_id, valor, tipo, criado_por) VALUES ($1, $2, $3, $4, $5)',
    [id, itemRows[0].id, valor, tipo, req.user.username]
  );
  const { rows: sumRows } = await db.query(
    "SELECT COALESCE(SUM(valor) FILTER (WHERE tipo = 'PESO'), 0) AS peso, COALESCE(SUM(valor) FILTER (WHERE tipo = 'QUANTIDADE'), 0) AS quantidade FROM contagem_lancamentos WHERE contagem_item_id = $1",
    [itemRows[0].id]
  );
  res.status(201).json({ id, tipo, totalPeso: sumRows[0].peso, totalQuantidade: sumRows[0].quantidade });
});

router.delete('/:id/itens/:rawMaterialCode/lancamentos/:lancamentoId', requireAuth, requireEdit('contagem_mobile'), async (req, res) => {
  await assertContagemDeHoje(req.params.id);
  await db.query(
    `DELETE FROM contagem_lancamentos WHERE id = $1 AND contagem_item_id = (
       SELECT id FROM contagem_itens WHERE contagem_id = $2 AND raw_material_code = $3
     )`,
    [req.params.lancamentoId, req.params.id, req.params.rawMaterialCode]
  );
  res.json({ ok: true });
});

// Casa cada linha {code, descricao, saldo} contra raw_materials pelo código
// (normalizado: maiúsculo, sem espaço/traço/pontuação, já que o arquivo do
// fornecedor pode vir formatado diferente do cadastro). Só aplica o Saldo do
// Sistema quando o código bate; o resto volta como "pendentes" para o
// frontend oferecer cadastro ou correção manual do código.
async function applyImportRows(contagemId, entries, username) {
  const { rows: materials } = await db.query('SELECT code FROM raw_materials');
  const byNormalized = new Map(materials.map((m) => [normalizeCode(m.code), m.code]));

  const matched = [];
  const pendentes = [];
  for (const entry of entries) {
    const code = byNormalized.get(normalizeCode(entry.code));
    if (!code) {
      pendentes.push(entry);
      continue;
    }
    const { rowCount } = await db.query(
      `UPDATE contagem_itens SET saldo_sistema = $1, saldo_sistema_origem = 'upload', updated_at = now()
       WHERE contagem_id = $2 AND raw_material_code = $3`,
      [entry.saldo, contagemId, code]
    );
    if (!rowCount) {
      // Material existe no cadastro mas ainda não tinha linha nessa contagem
      // (ex: foi cadastrado depois que a contagem já existia).
      await db.query(
        `INSERT INTO contagem_itens (id, contagem_id, raw_material_code, saldo_sistema, saldo_sistema_origem)
         VALUES ($1, $2, $3, $4, 'upload')`,
        [crypto.randomUUID(), contagemId, code, entry.saldo]
      );
    }
    matched.push({ ...entry, code });
  }
  return { matchedCount: matched.length, pendentes };
}

router.post('/:id/import', requireAuth, requireEdit('contagem'), upload.single('file'), async (req, res) => {
  await assertContagemDeHoje(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Envie um arquivo XLS/XLSX ou PDF.' });

  const name = (req.file.originalname || '').toLowerCase();
  let entries;
  try {
    if (name.endsWith('.pdf')) {
      entries = await parsePdfBuffer(req.file.buffer);
    } else {
      entries = parseXlsxBuffer(req.file.buffer);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Não foi possível ler o arquivo: ' + err.message });
  }
  if (!entries.length) {
    return res.status(400).json({ error: 'Nenhuma linha reconhecida no arquivo. Confira o formato (código, descrição, saldo).' });
  }

  const result = await applyImportRows(req.params.id, entries, req.user.username);
  res.json({ totalLinhas: entries.length, ...result });
});

// Reaplica uma lista de pendências (depois que o usuário cadastrou a matéria-
// prima que faltava, ou corrigiu o código à mão) sem precisar reenviar o
// arquivo original.
router.post('/:id/import/retry', requireAuth, requireEdit('contagem'), async (req, res) => {
  await assertContagemDeHoje(req.params.id);
  const entries = (req.body || {}).itens;
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'Nenhum item para reprocessar.' });
  }
  const result = await applyImportRows(req.params.id, entries, req.user.username);
  res.json(result);
});

router.get('/:id/export', requireAuth, viewContagem, async (req, res) => {
  const { rows: contagemRows } = await db.query('SELECT titulo FROM contagens WHERE id = $1', [req.params.id]);
  if (!contagemRows.length) return res.status(404).json({ error: 'Contagem não encontrada.' });
  const itens = await loadItens(req.params.id);
  const data = itens.map((i) => ({
    'Código': i.rawMaterialCode,
    'Descrição': i.nome,
    'Saldo do Sistema': i.saldoSistema,
    'Saldo do Inventário': i.saldoInventario,
    'Notas em Trânsito': i.notasTransito,
    'Divergência': i.divergencia,
    'Unidade de Referência': i.unidade,
    'Divergência %': i.divergenciaPercentual,
    'Condição': i.condicao,
    'Observação': i.observacao || '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contagem');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${contagemRows[0].titulo.replace(/[^a-z0-9]/gi, '_')}.xlsx"`);
  res.send(buffer);
});

// ------------------------------------------------------------ Matéria-Prima
// Processada e Explosão, por contagem: estoque de produto, estoque virgem e
// quantidade por estado da mistura são um retrato daquela contagem
// específica (ver server/db.js) — por isso vivem aninhados aqui, e só podem
// ser editados enquanto a contagem for a de hoje (mesma regra de
// assertContagemDeHoje usada para lançamento/saldo do sistema/importação).

router.get('/:id/product-stock', requireAuth, viewContagem, async (req, res) => {
  const { rows } = await db.query(
    'SELECT product_code AS "productCode", quantidade FROM contagem_product_stock WHERE contagem_id = $1',
    [req.params.id]
  );
  res.json(rows);
});

router.put('/:id/product-stock/:productCode', requireAuth, requireEdit('materia_prima_produzida'), async (req, res) => {
  await assertContagemDeHoje(req.params.id);
  const value = Number((req.body || {}).quantidade);
  if (Number.isNaN(value)) return res.status(400).json({ error: 'Quantidade inválida.' });
  const { rows: prod } = await db.query('SELECT code FROM products WHERE code = $1', [req.params.productCode]);
  if (!prod.length) return res.status(404).json({ error: 'Produto não encontrado.' });
  await db.query(
    `INSERT INTO contagem_product_stock (contagem_id, product_code, quantidade, updated_at, updated_by)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (contagem_id, product_code) DO UPDATE SET quantidade = $3, updated_at = now(), updated_by = $4`,
    [req.params.id, req.params.productCode, value, req.user.username]
  );
  res.json({ ok: true });
});

router.get('/:id/virgin-stock', requireAuth, viewContagem, async (req, res) => {
  const { rows } = await db.query(
    'SELECT raw_material_code AS "rawMaterialCode", quantidade FROM contagem_virgin_stock WHERE contagem_id = $1',
    [req.params.id]
  );
  res.json(rows);
});

router.put('/:id/virgin-stock/:rawMaterialCode', requireAuth, requireEdit('materia_prima_produzida'), async (req, res) => {
  await assertContagemDeHoje(req.params.id);
  const value = Number((req.body || {}).quantidade);
  if (Number.isNaN(value)) return res.status(400).json({ error: 'Quantidade inválida.' });
  const { rows: mat } = await db.query('SELECT code FROM raw_materials WHERE code = $1', [req.params.rawMaterialCode]);
  if (!mat.length) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
  await db.query(
    `INSERT INTO contagem_virgin_stock (contagem_id, raw_material_code, quantidade, updated_at, updated_by)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (contagem_id, raw_material_code) DO UPDATE SET quantidade = $3, updated_at = now(), updated_by = $4`,
    [req.params.id, req.params.rawMaterialCode, value, req.user.username]
  );
  res.json({ ok: true });
});

router.get('/:id/summary', requireAuth, viewContagem, async (req, res) => {
  const itens = await getRawMaterialSummary(req.params.id);
  res.json({ estados: ESTADOS, itens });
});

// Receita da mistura (nome/componentes/percentuais) continua global — só a
// quantidade lançada por estado é presa a essa contagem.
router.get('/:id/blends', requireAuth, viewContagem, async (req, res) => {
  const { rows: blends } = await db.query('SELECT id, nome FROM blends ORDER BY nome');
  const { rows: components } = await db.query(
    `SELECT id, blend_id AS "blendId", raw_material_code AS "rawMaterialCode", percentual, ordem
     FROM blend_components ORDER BY blend_id, ordem`
  );
  const { rows: states } = await db.query(
    'SELECT blend_id AS "blendId", estado, quantidade FROM contagem_blend_state_quantities WHERE contagem_id = $1',
    [req.params.id]
  );
  const componentsByBlend = {};
  for (const c of components) (componentsByBlend[c.blendId] = componentsByBlend[c.blendId] || []).push(c);
  const statesByBlend = {};
  for (const s of states) (statesByBlend[s.blendId] = statesByBlend[s.blendId] || {})[s.estado] = s.quantidade;

  res.json(
    blends.map((b) => ({
      ...b,
      components: componentsByBlend[b.id] || [],
      estados: ESTADOS.reduce((acc, e) => {
        acc[e] = (statesByBlend[b.id] || {})[e] || 0;
        return acc;
      }, {}),
    }))
  );
});

router.put('/:id/blends/:blendId/estados/:estado', requireAuth, requireEdit('explosao'), async (req, res) => {
  await assertContagemDeHoje(req.params.id);
  const estado = req.params.estado.toUpperCase();
  if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });
  const value = Number((req.body || {}).quantidade);
  if (Number.isNaN(value)) return res.status(400).json({ error: 'Quantidade inválida.' });
  const { rows: blend } = await db.query('SELECT id FROM blends WHERE id = $1', [req.params.blendId]);
  if (!blend.length) return res.status(404).json({ error: 'Mistura não encontrada.' });
  await db.query(
    `INSERT INTO contagem_blend_state_quantities (contagem_id, blend_id, estado, quantidade, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (contagem_id, blend_id, estado) DO UPDATE SET quantidade = $4, updated_at = now(), updated_by = $5`,
    [req.params.id, req.params.blendId, estado, value, req.user.username]
  );
  res.json({ ok: true });
});

module.exports = router;
