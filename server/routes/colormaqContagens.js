// Contagens da Colormaq — mesmo padrão geral de server/routes/contagens.js
// (a Mondial: cada contagem é um período de apuração, sempre nasce zerada,
// só edita enquanto ABERTA), mas adaptado ao modelo da Colormaq:
//   - "peças produzidas" por produto (não estoque de produto) é o que
//     alimenta o consumo de matéria-prima — ver server/colormaqCalc.js.
//   - Lançamento físico pelo celular é PESO (matéria-prima, em KG) ou UN
//     (produto, peça contada) — schema já garante um dos dois, nunca os
//     dois nem nenhum (ver server/db.js, colormaq_contagem_lancamentos).
//   - Só 2 estados de mistura (MISTURA/MOÍDO), não os 8 da Mondial.
// Tabelas e rota totalmente próprias — nada aqui toca em contagens.js nem
// nas tabelas da Mondial.
const express = require('express');
const crypto = require('crypto');
const XLSX = require('xlsx');
const db = require('../db');
const { requireAuth, requireEdit, requireViewAny } = require('../auth');
const { computeDivergence } = require('../calc');
const { computeRawMaterialSummary } = require('../colormaqCalc');
const { ESTADOS_COLORMAQ } = require('../constants');
const { buildColormaqWorkbook } = require('../colormaqExportWorkbook');

const router = express.Router();
const viewContagem = requireViewAny(['colormaq_contagem', 'colormaq_contagem_mobile']);

async function assertContagemAberta(contagemId) {
  const { rows } = await db.query('SELECT status FROM colormaq_contagens WHERE id = $1', [contagemId]);
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
}

// Peças produzidas por produto nessa contagem = valor direto (tela Matéria-
// Prima Processada) + soma dos lançamentos em UN pelo celular — mesmo
// espírito da Mondial (mobile + desktop somam juntos), ver
// server/routes/contagens.js, loadItens.
async function getPecasProduzidas(contagemId) {
  const [diretasRes, unRes] = await Promise.all([
    db.query('SELECT product_code AS "productCode", quantidade FROM colormaq_contagem_pecas_produzidas WHERE contagem_id = $1', [contagemId]),
    db.query(
      `SELECT product_code AS "productCode", COALESCE(SUM(valor), 0) AS quantidade
       FROM colormaq_contagem_lancamentos WHERE contagem_id = $1 AND tipo = 'UN' GROUP BY product_code`,
      [contagemId]
    ),
  ]);
  const byProduct = new Map();
  for (const d of diretasRes.rows) byProduct.set(d.productCode, (byProduct.get(d.productCode) || 0) + Number(d.quantidade));
  for (const u of unRes.rows) byProduct.set(u.productCode, (byProduct.get(u.productCode) || 0) + Number(u.quantidade));
  return Array.from(byProduct, ([productCode, quantidade]) => ({ productCode, quantidade }));
}

async function loadBlendsForContagem(contagemId) {
  const [blendsRes, componentsRes, quantitiesRes] = await Promise.all([
    db.query('SELECT id, nome FROM colormaq_blends ORDER BY nome'),
    db.query('SELECT id, blend_id AS "blendId", raw_material_code AS "rawMaterialCode", papel FROM colormaq_blend_components'),
    db.query(
      'SELECT blend_id AS "blendId", estado, quantidade FROM colormaq_contagem_blend_quantities WHERE contagem_id = $1',
      [contagemId]
    ),
  ]);
  const componentsByBlend = {};
  for (const c of componentsRes.rows) (componentsByBlend[c.blendId] = componentsByBlend[c.blendId] || []).push(c);
  const quantitiesByBlend = {};
  for (const q of quantitiesRes.rows) (quantitiesByBlend[q.blendId] = quantitiesByBlend[q.blendId] || {})[q.estado] = q.quantidade;

  return blendsRes.rows.map((b) => ({
    ...b,
    components: componentsByBlend[b.id] || [],
    estados: ESTADOS_COLORMAQ.reduce((acc, e) => {
      acc[e] = (quantitiesByBlend[b.id] || {})[e] || 0;
      return acc;
    }, {}),
  }));
}

async function getRawMaterialSummary(contagemId) {
  const [rawMaterialsRes, productMaterialsRes, pecasProduzidas, blends] = await Promise.all([
    db.query('SELECT code, nome, unidade FROM colormaq_raw_materials'),
    db.query(
      'SELECT product_code AS "productCode", raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario" FROM colormaq_product_materials'
    ),
    getPecasProduzidas(contagemId),
    loadBlendsForContagem(contagemId),
  ]);
  // loadBlendsForContagem devolve blend.estados (objeto); computeRawMaterialSummary
  // espera uma lista achatada {blendId, estado, quantidade} — achata aqui.
  const blendQuantities = [];
  for (const b of blends) {
    for (const [estado, quantidade] of Object.entries(b.estados || {})) {
      blendQuantities.push({ blendId: b.id, estado, quantidade });
    }
  }
  return computeRawMaterialSummary({
    rawMaterials: rawMaterialsRes.rows,
    productMaterials: productMaterialsRes.rows,
    pecasProduzidas,
    blends,
    blendQuantities,
  });
}

// Saldo do Inventário de cada matéria-prima = peso contado fisicamente pelo
// celular (lançamentos tipo PESO) + quanto foi processado (resumo acima,
// que já embute peças produzidas + reciclo da mistura).
async function loadItens(contagemId) {
  const [itensRes, pesoRes, summary] = await Promise.all([
    db.query(
      `SELECT rm.code AS "rawMaterialCode", rm.nome, rm.unidade,
              COALESCE(ci.saldo_sistema, 0) AS "saldoSistema",
              COALESCE(ci.saldo_sistema_origem, 'manual') AS "saldoSistemaOrigem",
              COALESCE(ci.notas_transito, 0) AS "notasTransito",
              ci.observacao
       FROM colormaq_raw_materials rm
       LEFT JOIN colormaq_contagem_itens ci ON ci.contagem_id = $1 AND ci.raw_material_code = rm.code
       ORDER BY rm.code`,
      [contagemId]
    ),
    db.query(
      `SELECT raw_material_code AS "rawMaterialCode", COALESCE(SUM(valor), 0) AS peso
       FROM colormaq_contagem_lancamentos WHERE contagem_id = $1 AND tipo = 'PESO' GROUP BY raw_material_code`,
      [contagemId]
    ),
    getRawMaterialSummary(contagemId),
  ]);
  const pesoByMaterial = new Map(pesoRes.rows.map((p) => [p.rawMaterialCode, Number(p.peso)]));
  const summaryByMaterial = new Map(summary.map((s) => [s.code, s]));

  return itensRes.rows.map((r) => {
    const processado = summaryByMaterial.get(r.rawMaterialCode);
    const materiaPrimaProcessada = processado ? processado.total : 0;
    const contagemFisica = pesoByMaterial.get(r.rawMaterialCode) || 0;
    const saldoInventario = contagemFisica + materiaPrimaProcessada;
    const { divergencia, percentual, condicao } = computeDivergence(r.saldoSistema, saldoInventario, r.notasTransito);
    return { ...r, contagemFisica, materiaPrimaProcessada, saldoInventario, divergencia, divergenciaPercentual: percentual, condicao };
  });
}

router.get('/', requireAuth, viewContagem, async (req, res) => {
  const { rows } = await db.query('SELECT id, titulo, status, data, created_at AS "createdAt" FROM colormaq_contagens ORDER BY data DESC, created_at DESC');
  res.json(rows);
});

router.post('/', requireAuth, requireEdit('colormaq_contagem'), async (req, res) => {
  const { titulo } = req.body || {};
  if (!titulo) return res.status(400).json({ error: 'Informe um título para a contagem.' });
  const id = crypto.randomUUID();
  await db.withTransaction(async (client) => {
    await client.query('INSERT INTO colormaq_contagens (id, titulo, created_by) VALUES ($1, $2, $3)', [id, titulo, req.user.username]);
    const { rows: materials } = await client.query('SELECT code FROM colormaq_raw_materials');
    for (const m of materials) {
      await client.query('INSERT INTO colormaq_contagem_itens (id, contagem_id, raw_material_code) VALUES ($1, $2, $3)', [crypto.randomUUID(), id, m.code]);
    }
  });
  res.status(201).json({ id });
});

router.put('/:id', requireAuth, requireEdit('colormaq_contagem'), async (req, res) => {
  const { titulo, status } = req.body || {};
  if (status !== undefined) {
    const { rows } = await db.query('SELECT status FROM colormaq_contagens WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Contagem não encontrada.' });
    if (rows[0].status === 'FINALIZADA' && status !== 'FINALIZADA' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Só um administrador pode reabrir uma contagem finalizada.' });
    }
  }
  const { rowCount } = await db.query(
    'UPDATE colormaq_contagens SET titulo = COALESCE($1, titulo), status = COALESCE($2, status) WHERE id = $3',
    [titulo, status, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Contagem não encontrada.' });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireEdit('colormaq_contagem'), async (req, res) => {
  await db.query('DELETE FROM colormaq_contagens WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

router.get('/:id', requireAuth, viewContagem, async (req, res) => {
  const { rows } = await db.query('SELECT id, titulo, status, data, created_at AS "createdAt" FROM colormaq_contagens WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Contagem não encontrada.' });
  const itens = await loadItens(req.params.id);
  res.json({ ...rows[0], itens });
});

router.put('/:id/itens/:rawMaterialCode', requireAuth, requireEdit('colormaq_contagem'), async (req, res) => {
  await assertContagemAberta(req.params.id);
  const { saldoSistema, notasTransito, observacao } = req.body || {};
  const saldoVal = saldoSistema === undefined ? null : Number(saldoSistema);
  const notasVal = notasTransito === undefined ? null : Number(notasTransito);
  const observacaoVal = observacao === undefined ? null : observacao;
  const { rows: mat } = await db.query('SELECT code FROM colormaq_raw_materials WHERE code = $1', [req.params.rawMaterialCode]);
  if (!mat.length) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
  await db.query(
    `INSERT INTO colormaq_contagem_itens (id, contagem_id, raw_material_code, saldo_sistema, saldo_sistema_origem, notas_transito, observacao)
     VALUES ($1, $2, $3, COALESCE($4, 0::double precision), 'manual', COALESCE($5, 0::double precision), $6)
     ON CONFLICT (contagem_id, raw_material_code) DO UPDATE SET
       saldo_sistema = COALESCE($4, colormaq_contagem_itens.saldo_sistema),
       saldo_sistema_origem = CASE WHEN $4 IS NOT NULL THEN 'manual' ELSE colormaq_contagem_itens.saldo_sistema_origem END,
       notas_transito = COALESCE($5, colormaq_contagem_itens.notas_transito),
       observacao = COALESCE($6, colormaq_contagem_itens.observacao),
       updated_at = now()`,
    [crypto.randomUUID(), req.params.id, req.params.rawMaterialCode, saldoVal, notasVal, observacaoVal]
  );
  res.json({ ok: true });
});

// ------------------------------------------------------------- Lançamentos
// PESO (matéria-prima) — pesar um saco de resina/masterbatch fisicamente.
router.get('/:id/materiais/:rawMaterialCode/lancamentos', requireAuth, viewContagem, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, valor, criado_por AS "criadoPor", criado_em AS "criadoEm" FROM colormaq_contagem_lancamentos
     WHERE contagem_id = $1 AND tipo = 'PESO' AND raw_material_code = $2 ORDER BY criado_em`,
    [req.params.id, req.params.rawMaterialCode]
  );
  res.json(rows);
});

router.post('/:id/materiais/:rawMaterialCode/lancamentos', requireAuth, requireEdit('colormaq_contagem_mobile'), async (req, res) => {
  await assertContagemAberta(req.params.id);
  const valor = Number((req.body || {}).valor);
  if (Number.isNaN(valor)) return res.status(400).json({ error: 'Valor inválido.' });
  const { rows: mat } = await db.query('SELECT code FROM colormaq_raw_materials WHERE code = $1', [req.params.rawMaterialCode]);
  if (!mat.length) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO colormaq_contagem_lancamentos (id, contagem_id, tipo, raw_material_code, valor, criado_por)
     VALUES ($1, $2, 'PESO', $3, $4, $5)`,
    [id, req.params.id, req.params.rawMaterialCode, valor, req.user.username]
  );
  const { rows: sumRows } = await db.query(
    `SELECT COALESCE(SUM(valor), 0) AS total FROM colormaq_contagem_lancamentos WHERE contagem_id = $1 AND tipo = 'PESO' AND raw_material_code = $2`,
    [req.params.id, req.params.rawMaterialCode]
  );
  res.status(201).json({ id, totalPeso: sumRows[0].total });
});

router.delete('/:id/materiais/:rawMaterialCode/lancamentos/:lancamentoId', requireAuth, requireEdit('colormaq_contagem_mobile'), async (req, res) => {
  await assertContagemAberta(req.params.id);
  await db.query(
    `DELETE FROM colormaq_contagem_lancamentos WHERE id = $1 AND contagem_id = $2 AND tipo = 'PESO' AND raw_material_code = $3`,
    [req.params.lancamentoId, req.params.id, req.params.rawMaterialCode]
  );
  res.json({ ok: true });
});

// ------------------------------------------------------------- Lançamentos
// UN (produto) — contar peça acabada; alimenta peças produzidas / Explosão.
router.get('/:id/produtos/:productCode/lancamentos', requireAuth, viewContagem, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, valor, criado_por AS "criadoPor", criado_em AS "criadoEm" FROM colormaq_contagem_lancamentos
     WHERE contagem_id = $1 AND tipo = 'UN' AND product_code = $2 ORDER BY criado_em`,
    [req.params.id, req.params.productCode]
  );
  res.json(rows);
});

router.post('/:id/produtos/:productCode/lancamentos', requireAuth, requireEdit('colormaq_contagem_mobile'), async (req, res) => {
  await assertContagemAberta(req.params.id);
  const valor = Number((req.body || {}).valor);
  if (Number.isNaN(valor)) return res.status(400).json({ error: 'Valor inválido.' });
  const { rows: prod } = await db.query('SELECT code FROM colormaq_products WHERE code = $1', [req.params.productCode]);
  if (!prod.length) return res.status(404).json({ error: 'Produto não encontrado.' });
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO colormaq_contagem_lancamentos (id, contagem_id, tipo, product_code, valor, criado_por)
     VALUES ($1, $2, 'UN', $3, $4, $5)`,
    [id, req.params.id, req.params.productCode, valor, req.user.username]
  );
  const { rows: sumRows } = await db.query(
    `SELECT COALESCE(SUM(valor), 0) AS total FROM colormaq_contagem_lancamentos WHERE contagem_id = $1 AND tipo = 'UN' AND product_code = $2`,
    [req.params.id, req.params.productCode]
  );
  res.status(201).json({ id, totalPecas: sumRows[0].total });
});

router.delete('/:id/produtos/:productCode/lancamentos/:lancamentoId', requireAuth, requireEdit('colormaq_contagem_mobile'), async (req, res) => {
  await assertContagemAberta(req.params.id);
  await db.query(
    `DELETE FROM colormaq_contagem_lancamentos WHERE id = $1 AND contagem_id = $2 AND tipo = 'UN' AND product_code = $3`,
    [req.params.lancamentoId, req.params.id, req.params.productCode]
  );
  res.json({ ok: true });
});

// ------------------------------------------------------------- Peças produzidas
// (tela Matéria-Prima Processada — edição direta, soma com os lançamentos UN)
router.get('/:id/pecas-produzidas', requireAuth, viewContagem, async (req, res) => {
  const { rows } = await db.query(
    'SELECT product_code AS "productCode", quantidade FROM colormaq_contagem_pecas_produzidas WHERE contagem_id = $1',
    [req.params.id]
  );
  res.json(rows);
});

router.put('/:id/pecas-produzidas/:productCode', requireAuth, requireEdit('colormaq_materia_prima_produzida'), async (req, res) => {
  await assertContagemAberta(req.params.id);
  const value = Number((req.body || {}).quantidade);
  if (Number.isNaN(value)) return res.status(400).json({ error: 'Quantidade inválida.' });
  const { rows: prod } = await db.query('SELECT code FROM colormaq_products WHERE code = $1', [req.params.productCode]);
  if (!prod.length) return res.status(404).json({ error: 'Produto não encontrado.' });
  await db.query(
    `INSERT INTO colormaq_contagem_pecas_produzidas (contagem_id, product_code, quantidade, updated_at, updated_by)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (contagem_id, product_code) DO UPDATE SET quantidade = $3, updated_at = now(), updated_by = $4`,
    [req.params.id, req.params.productCode, value, req.user.username]
  );
  res.json({ ok: true });
});

router.get('/:id/summary', requireAuth, viewContagem, async (req, res) => {
  const itens = await getRawMaterialSummary(req.params.id);
  res.json({ itens });
});

// ------------------------------------------------------------- Explosão (blends)
router.get('/:id/blends', requireAuth, viewContagem, async (req, res) => {
  const blends = await loadBlendsForContagem(req.params.id);
  res.json(blends);
});

router.put('/:id/blends/:blendId/estados/:estado', requireAuth, requireEdit('colormaq_explosao'), async (req, res) => {
  await assertContagemAberta(req.params.id);
  const estado = req.params.estado.toUpperCase();
  if (!ESTADOS_COLORMAQ.includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });
  const value = Number((req.body || {}).quantidade);
  if (Number.isNaN(value)) return res.status(400).json({ error: 'Quantidade inválida.' });
  const { rows: blend } = await db.query('SELECT id FROM colormaq_blends WHERE id = $1', [req.params.blendId]);
  if (!blend.length) return res.status(404).json({ error: 'Blend não encontrado.' });
  await db.query(
    `INSERT INTO colormaq_contagem_blend_quantities (contagem_id, blend_id, estado, quantidade, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (contagem_id, blend_id, estado) DO UPDATE SET quantidade = $4, updated_at = now(), updated_by = $5`,
    [req.params.id, req.params.blendId, estado, value, req.user.username]
  );
  res.json({ ok: true });
});

// ------------------------------------------------------------- Exportação
router.get('/:id/export', requireAuth, viewContagem, async (req, res) => {
  const { rows: contagemRows } = await db.query('SELECT titulo, data::text AS data FROM colormaq_contagens WHERE id = $1', [req.params.id]);
  if (!contagemRows.length) return res.status(404).json({ error: 'Contagem não encontrada.' });

  const [itens, rawMaterialsRes, productsRes, productMaterialsRes, pecasProduzidas, blends] = await Promise.all([
    loadItens(req.params.id),
    db.query('SELECT code, nome, unidade, tipo FROM colormaq_raw_materials ORDER BY code'),
    db.query('SELECT code, nome FROM colormaq_products ORDER BY code'),
    db.query(
      'SELECT product_code AS "productCode", raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario" FROM colormaq_product_materials'
    ),
    getPecasProduzidas(req.params.id),
    loadBlendsForContagem(req.params.id),
  ]);

  const [ano, mes, dia] = contagemRows[0].data.split('-');
  const dataFormatada = `${dia}.${mes}`;

  const wb = buildColormaqWorkbook({
    dataFormatada,
    itens,
    rawMaterials: rawMaterialsRes.rows,
    products: productsRes.rows,
    productMaterials: productMaterialsRes.rows,
    pecasProduzidas,
    blends,
  });
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="COLORMAQ_${contagemRows[0].titulo.replace(/[^a-z0-9]/gi, '_')}.xlsx"`);
  res.send(buffer);
});

module.exports = router;
