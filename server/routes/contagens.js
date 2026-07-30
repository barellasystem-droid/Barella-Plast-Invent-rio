const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const { requireAuth, requireEdit, requireViewAny } = require('../auth');
const { computeDivergence } = require('../calc');
const { parseXlsxBuffer, parsePdfBuffer, normalizeCode } = require('../import-parsers');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const viewContagem = requireViewAny(['contagem', 'contagem_mobile']);

router.get('/', requireAuth, viewContagem, async (req, res) => {
  const { rows } = await db.query('SELECT id, titulo, fornecedor, periodo, status, created_at AS "createdAt" FROM contagens ORDER BY created_at DESC');
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
  });
  res.status(201).json({ id });
});

router.put('/:id', requireAuth, requireEdit('contagem'), async (req, res) => {
  const { titulo, fornecedor, periodo, status } = req.body || {};
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

async function loadItens(contagemId) {
  const { rows } = await db.query(
    `SELECT ci.id, ci.raw_material_code AS "rawMaterialCode", rm.nome, rm.unidade,
            ci.saldo_sistema AS "saldoSistema", ci.saldo_sistema_origem AS "saldoSistemaOrigem",
            ci.notas_transito AS "notasTransito", ci.observacao,
            COALESCE(SUM(cl.valor), 0) AS "saldoInventario"
     FROM contagem_itens ci
     JOIN raw_materials rm ON rm.code = ci.raw_material_code
     LEFT JOIN contagem_lancamentos cl ON cl.contagem_item_id = ci.id
     WHERE ci.contagem_id = $1
     GROUP BY ci.id, rm.nome, rm.unidade
     ORDER BY ci.raw_material_code`,
    [contagemId]
  );
  return rows.map((r) => {
    const { divergencia, percentual, condicao } = computeDivergence(r.saldoSistema, r.saldoInventario, r.notasTransito);
    return { ...r, divergencia, divergenciaPercentual: percentual, condicao };
  });
}

router.get('/:id', requireAuth, viewContagem, async (req, res) => {
  const { rows } = await db.query('SELECT id, titulo, fornecedor, periodo, status, created_at AS "createdAt" FROM contagens WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Contagem não encontrada.' });
  const itens = await loadItens(req.params.id);
  res.json({ ...rows[0], itens });
});

router.put('/:id/itens/:rawMaterialCode', requireAuth, requireEdit('contagem'), async (req, res) => {
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
    'SELECT id, valor, criado_por AS "criadoPor", criado_em AS "criadoEm" FROM contagem_lancamentos WHERE contagem_item_id = $1 ORDER BY criado_em',
    [itemRows[0].id]
  );
  res.json(rows);
});

router.post('/:id/itens/:rawMaterialCode/lancamentos', requireAuth, requireEdit('contagem_mobile'), async (req, res) => {
  const valor = Number((req.body || {}).valor);
  if (Number.isNaN(valor)) return res.status(400).json({ error: 'Valor inválido.' });
  const { rows: itemRows } = await db.query(
    'SELECT id FROM contagem_itens WHERE contagem_id = $1 AND raw_material_code = $2',
    [req.params.id, req.params.rawMaterialCode]
  );
  if (!itemRows.length) return res.status(404).json({ error: 'Item não encontrado nessa contagem.' });
  const id = crypto.randomUUID();
  await db.query(
    'INSERT INTO contagem_lancamentos (id, contagem_item_id, valor, criado_por) VALUES ($1, $2, $3, $4)',
    [id, itemRows[0].id, valor, req.user.username]
  );
  const { rows: sumRows } = await db.query(
    'SELECT COALESCE(SUM(valor), 0) AS total FROM contagem_lancamentos WHERE contagem_item_id = $1',
    [itemRows[0].id]
  );
  res.status(201).json({ id, total: sumRows[0].total });
});

router.delete('/:id/itens/:rawMaterialCode/lancamentos/:lancamentoId', requireAuth, requireEdit('contagem_mobile'), async (req, res) => {
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
  if (!req.file) return res.status(400).json({ error: 'Envie um arquivo XLS/XLSX ou PDF.' });
  const { rows: contagem } = await db.query('SELECT id FROM contagens WHERE id = $1', [req.params.id]);
  if (!contagem.length) return res.status(404).json({ error: 'Contagem não encontrada.' });

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

module.exports = router;
