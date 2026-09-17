// Rotas dos fornecedores genéricos (Colormaq, Cadence, Inplast, Amvox — ver
// server/suppliers.js) — um único módulo, parametrizado por fornecedor, em
// vez de um arquivo de rotas copiado e colado pra cada um (era assim
// enquanto só existia a Colormaq; generalizado quando Cadence/Inplast/Amvox
// entraram, pra um bug corrigido aqui não precisar ser corrigido em 4
// lugares separados). Cada createXxxRouter recebe { key, label } (ver
// server/suppliers.js) e monta um router Express com os nomes de
// tabela/tab_id certos pra aquele fornecedor. server/app.js chama
// createSupplierRouters(supplier) uma vez por fornecedor e monta cada
// router em /api/<key>/....
//
// Nada aqui toca em server/routes/contagens.js nem nas tabelas da Mondial —
// ver server/db.js (supplierSchemaSql) pro schema correspondente.
const express = require('express');
const crypto = require('crypto');
const XLSX = require('xlsx');
const db = require('./db');
const { requireAuth, requireEdit, requireViewAny, blockPending } = require('./auth');
const { computeDivergence } = require('./calc');
const { computeRawMaterialSummary, percentualMasterbatch } = require('./supplierCalc');
const { ESTADOS_FORNECEDOR_PADRAO } = require('./constants');
const { buildSupplierWorkbook } = require('./supplierExportWorkbook');

function createRawMaterialsRouter({ key }) {
  const T = `${key}_raw_materials`;
  const tabId = `${key}_cadastros`;
  const router = express.Router();

  router.get('/', requireAuth, blockPending, async (req, res) => {
    const { rows } = await db.query(`SELECT code, nome, unidade, tipo FROM ${T} ORDER BY code`);
    res.json(rows);
  });

  router.get('/:code', requireAuth, blockPending, async (req, res) => {
    const { rows } = await db.query(`SELECT code, nome, unidade, tipo FROM ${T} WHERE code = $1`, [req.params.code]);
    if (!rows.length) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
    res.json(rows[0]);
  });

  router.post('/bulk', requireAuth, requireEdit(tabId), async (req, res) => {
    const { items } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Nenhum item informado.' });
    const created = [];
    const skipped = [];
    for (const item of items) {
      if (!item || !item.code || !item.nome) continue;
      const { rows: existing } = await db.query(`SELECT code FROM ${T} WHERE code = $1`, [item.code]);
      if (existing.length) { skipped.push(item.code); continue; }
      await db.query(`INSERT INTO ${T} (code, nome, unidade, tipo) VALUES ($1, $2, $3, $4)`, [item.code, item.nome, item.unidade || 'KG', item.tipo || null]);
      created.push(item.code);
    }
    res.status(201).json({ created, skipped });
  });

  router.post('/', requireAuth, requireEdit(tabId), async (req, res) => {
    const { code, nome, unidade, tipo } = req.body || {};
    if (!code || !nome) return res.status(400).json({ error: 'Informe código e nome.' });
    if (tipo && !['RESINA', 'MASTERBATCH'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
    const { rows: existing } = await db.query(`SELECT code FROM ${T} WHERE code = $1`, [code]);
    if (existing.length) return res.status(409).json({ error: 'Já existe uma matéria-prima com esse código.' });
    await db.query(`INSERT INTO ${T} (code, nome, unidade, tipo) VALUES ($1, $2, $3, $4)`, [code, nome, unidade || 'KG', tipo || null]);
    res.status(201).json({ code, nome, unidade: unidade || 'KG', tipo: tipo || null });
  });

  router.put('/:code', requireAuth, requireEdit(tabId), async (req, res) => {
    const { code, nome, unidade, tipo } = req.body || {};
    if (!nome) return res.status(400).json({ error: 'Informe o nome.' });
    if (tipo && !['RESINA', 'MASTERBATCH'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
    const newCode = code || req.params.code;
    if (newCode !== req.params.code) {
      const { rows: existing } = await db.query(`SELECT code FROM ${T} WHERE code = $1`, [newCode]);
      if (existing.length) return res.status(409).json({ error: 'Já existe uma matéria-prima com esse código.' });
    }
    const { rowCount } = await db.query(`UPDATE ${T} SET code = $1, nome = $2, unidade = $3, tipo = $4 WHERE code = $5`, [newCode, nome, unidade || 'KG', tipo || null, req.params.code]);
    if (!rowCount) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
    res.json({ ok: true, code: newCode });
  });

  router.delete('/:code', requireAuth, requireEdit(tabId), async (req, res) => {
    await db.query(`DELETE FROM ${T} WHERE code = $1`, [req.params.code]);
    res.json({ ok: true });
  });

  return router;
}

function createProductsRouter({ key }) {
  const PRODUCTS = `${key}_products`;
  const MATERIALS = `${key}_product_materials`;
  const RAW_MATERIALS = `${key}_raw_materials`;
  const BLENDS = `${key}_blends`;
  const BLEND_COMPONENTS = `${key}_blend_components`;
  const tabId = `${key}_cadastros`;
  const router = express.Router();

  async function replaceMaterials(client, productCode, materials) {
    await client.query(`DELETE FROM ${MATERIALS} WHERE product_code = $1`, [productCode]);
    for (const m of materials || []) {
      if (!m || !m.rawMaterialCode) continue;
      await client.query(
        `INSERT INTO ${MATERIALS} (id, product_code, raw_material_code, consumo_unitario) VALUES ($1, $2, $3, $4)`,
        [crypto.randomUUID(), productCode, m.rawMaterialCode, Number(m.consumoUnitario) || 0]
      );
    }
  }

  // Se a receita do produto tem exatamente uma matéria-prima tipo RESINA e
  // uma tipo MASTERBATCH, garante que existe um blend com essa dupla
  // (reaproveita se já existir). Sem tela própria de cadastro de blend — é
  // sempre derivado daqui.
  async function syncBlend(client, materials) {
    if (!materials || materials.length < 2) return;
    const { rows: tipos } = await client.query(`SELECT code, tipo FROM ${RAW_MATERIALS} WHERE code = ANY($1::text[])`, [materials.map((m) => m.rawMaterialCode)]);
    const tipoByCode = new Map(tipos.map((t) => [t.code, t.tipo]));
    const resinas = materials.filter((m) => tipoByCode.get(m.rawMaterialCode) === 'RESINA');
    const masterbatches = materials.filter((m) => tipoByCode.get(m.rawMaterialCode) === 'MASTERBATCH');
    if (resinas.length !== 1 || masterbatches.length !== 1) return;
    const resinaCode = resinas[0].rawMaterialCode;
    const masterbatchCode = masterbatches[0].rawMaterialCode;

    const { rows: existing } = await client.query(
      `SELECT b.id FROM ${BLENDS} b
       JOIN ${BLEND_COMPONENTS} r ON r.blend_id = b.id AND r.papel = 'RESINA' AND r.raw_material_code = $1
       JOIN ${BLEND_COMPONENTS} m ON m.blend_id = b.id AND m.papel = 'MASTERBATCH' AND m.raw_material_code = $2`,
      [resinaCode, masterbatchCode]
    );
    if (existing.length) return;

    const { rows: nomes } = await client.query(`SELECT code, nome FROM ${RAW_MATERIALS} WHERE code = ANY($1::text[])`, [[resinaCode, masterbatchCode]]);
    const nomeByCode = new Map(nomes.map((n) => [n.code, n.nome]));
    const blendId = crypto.randomUUID();
    await client.query(`INSERT INTO ${BLENDS} (id, nome) VALUES ($1, $2)`, [blendId, `${nomeByCode.get(resinaCode) || resinaCode} + ${nomeByCode.get(masterbatchCode) || masterbatchCode}`]);
    await client.query(
      `INSERT INTO ${BLEND_COMPONENTS} (id, blend_id, raw_material_code, papel) VALUES ($1, $2, $3, 'RESINA'), ($4, $2, $5, 'MASTERBATCH')`,
      [crypto.randomUUID(), blendId, resinaCode, crypto.randomUUID(), masterbatchCode]
    );
  }

  router.get('/', requireAuth, blockPending, async (req, res) => {
    const { rows } = await db.query(`SELECT code, nome FROM ${PRODUCTS} ORDER BY code`);
    res.json(rows);
  });

  router.get('/:code', requireAuth, blockPending, async (req, res) => {
    const { rows } = await db.query(`SELECT code, nome FROM ${PRODUCTS} WHERE code = $1`, [req.params.code]);
    if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado.' });
    const { rows: materials } = await db.query(`SELECT raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario" FROM ${MATERIALS} WHERE product_code = $1`, [req.params.code]);
    res.json({ ...rows[0], materials });
  });

  router.post('/', requireAuth, requireEdit(tabId), async (req, res) => {
    const { code, nome, materials } = req.body || {};
    if (!code || !nome) return res.status(400).json({ error: 'Informe código e nome.' });
    const { rows: existing } = await db.query(`SELECT code FROM ${PRODUCTS} WHERE code = $1`, [code]);
    if (existing.length) return res.status(409).json({ error: 'Já existe um produto com esse código.' });
    await db.withTransaction(async (client) => {
      await client.query(`INSERT INTO ${PRODUCTS} (code, nome) VALUES ($1, $2)`, [code, nome]);
      await replaceMaterials(client, code, materials);
      await syncBlend(client, materials);
    });
    res.status(201).json({ code, nome });
  });

  router.put('/:code', requireAuth, requireEdit(tabId), async (req, res) => {
    const { code, nome, materials } = req.body || {};
    if (!nome) return res.status(400).json({ error: 'Informe o nome.' });
    const newCode = code || req.params.code;
    if (newCode !== req.params.code) {
      const { rows: existing } = await db.query(`SELECT code FROM ${PRODUCTS} WHERE code = $1`, [newCode]);
      if (existing.length) return res.status(409).json({ error: 'Já existe um produto com esse código.' });
    }
    const { rowCount } = await db.query(`UPDATE ${PRODUCTS} SET code = $1, nome = $2 WHERE code = $3`, [newCode, nome, req.params.code]);
    if (!rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
    await db.withTransaction(async (client) => {
      await replaceMaterials(client, newCode, materials);
      await syncBlend(client, materials);
    });
    res.json({ ok: true, code: newCode });
  });

  router.delete('/:code', requireAuth, requireEdit(tabId), async (req, res) => {
    await db.query(`DELETE FROM ${PRODUCTS} WHERE code = $1`, [req.params.code]);
    res.json({ ok: true });
  });

  return router;
}

function createProductMaterialsRouter({ key }) {
  const T = `${key}_product_materials`;
  const router = express.Router();
  router.get('/', requireAuth, blockPending, async (req, res) => {
    const { rows } = await db.query(`SELECT product_code AS "productCode", raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario" FROM ${T}`);
    res.json(rows);
  });
  return router;
}

function createBlendsRouter({ key }) {
  const BLENDS = `${key}_blends`;
  const BLEND_COMPONENTS = `${key}_blend_components`;
  const router = express.Router();
  router.get('/', requireAuth, blockPending, async (req, res) => {
    const { rows: blends } = await db.query(`SELECT id, nome FROM ${BLENDS} ORDER BY nome`);
    const { rows: components } = await db.query(`SELECT id, blend_id AS "blendId", raw_material_code AS "rawMaterialCode", papel FROM ${BLEND_COMPONENTS} ORDER BY blend_id, papel`);
    const componentsByBlend = {};
    for (const c of components) (componentsByBlend[c.blendId] = componentsByBlend[c.blendId] || []).push(c);
    res.json(blends.map((b) => ({ ...b, components: componentsByBlend[b.id] || [] })));
  });
  return router;
}

function createContagensRouter({ key, label }) {
  const RAW_MATERIALS = `${key}_raw_materials`;
  const PRODUCTS = `${key}_products`;
  const PRODUCT_MATERIALS = `${key}_product_materials`;
  const BLENDS = `${key}_blends`;
  const BLEND_COMPONENTS = `${key}_blend_components`;
  const CONTAGENS = `${key}_contagens`;
  const CONTAGEM_ITENS = `${key}_contagem_itens`;
  const CONTAGEM_LANCAMENTOS = `${key}_contagem_lancamentos`;
  const CONTAGEM_PECAS = `${key}_contagem_pecas_produzidas`;
  const CONTAGEM_BLEND_QTY = `${key}_contagem_blend_quantities`;
  const tabContagem = `${key}_contagem`;
  const tabContagemMobile = `${key}_contagem_mobile`;
  const tabExplosao = `${key}_explosao`;
  const tabMateriaPrima = `${key}_materia_prima_produzida`;

  const router = express.Router();
  const viewContagem = requireViewAny([tabContagem, tabContagemMobile]);

  async function assertContagemAberta(contagemId) {
    const { rows } = await db.query(`SELECT status FROM ${CONTAGENS} WHERE id = $1`, [contagemId]);
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

  async function getPecasProduzidas(contagemId) {
    const [diretasRes, unRes] = await Promise.all([
      db.query(`SELECT product_code AS "productCode", quantidade FROM ${CONTAGEM_PECAS} WHERE contagem_id = $1`, [contagemId]),
      db.query(`SELECT product_code AS "productCode", COALESCE(SUM(valor), 0) AS quantidade FROM ${CONTAGEM_LANCAMENTOS} WHERE contagem_id = $1 AND tipo = 'UN' GROUP BY product_code`, [contagemId]),
    ]);
    const byProduct = new Map();
    for (const d of diretasRes.rows) byProduct.set(d.productCode, (byProduct.get(d.productCode) || 0) + Number(d.quantidade));
    for (const u of unRes.rows) byProduct.set(u.productCode, (byProduct.get(u.productCode) || 0) + Number(u.quantidade));
    return Array.from(byProduct, ([productCode, quantidade]) => ({ productCode, quantidade }));
  }

  async function loadBlendsForContagem(contagemId) {
    const [blendsRes, componentsRes, quantitiesRes] = await Promise.all([
      db.query(`SELECT id, nome FROM ${BLENDS} ORDER BY nome`),
      db.query(`SELECT id, blend_id AS "blendId", raw_material_code AS "rawMaterialCode", papel FROM ${BLEND_COMPONENTS}`),
      db.query(`SELECT blend_id AS "blendId", estado, quantidade FROM ${CONTAGEM_BLEND_QTY} WHERE contagem_id = $1`, [contagemId]),
    ]);
    const componentsByBlend = {};
    for (const c of componentsRes.rows) (componentsByBlend[c.blendId] = componentsByBlend[c.blendId] || []).push(c);
    const quantitiesByBlend = {};
    for (const q of quantitiesRes.rows) (quantitiesByBlend[q.blendId] = quantitiesByBlend[q.blendId] || {})[q.estado] = q.quantidade;
    return blendsRes.rows.map((b) => ({
      ...b,
      components: componentsByBlend[b.id] || [],
      estados: ESTADOS_FORNECEDOR_PADRAO.reduce((acc, e) => {
        acc[e] = (quantitiesByBlend[b.id] || {})[e] || 0;
        return acc;
      }, {}),
    }));
  }

  async function getRawMaterialSummary(contagemId) {
    const [rawMaterialsRes, productMaterialsRes, pecasProduzidas, blends] = await Promise.all([
      db.query(`SELECT code, nome, unidade FROM ${RAW_MATERIALS}`),
      db.query(`SELECT product_code AS "productCode", raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario" FROM ${PRODUCT_MATERIALS}`),
      getPecasProduzidas(contagemId),
      loadBlendsForContagem(contagemId),
    ]);
    const blendQuantities = [];
    for (const b of blends) {
      for (const [estado, quantidade] of Object.entries(b.estados || {})) blendQuantities.push({ blendId: b.id, estado, quantidade });
    }
    return computeRawMaterialSummary({ rawMaterials: rawMaterialsRes.rows, productMaterials: productMaterialsRes.rows, pecasProduzidas, blends, blendQuantities });
  }

  async function loadItens(contagemId) {
    const [itensRes, pesoRes, summary] = await Promise.all([
      db.query(
        `SELECT rm.code AS "rawMaterialCode", rm.nome, rm.unidade,
                COALESCE(ci.saldo_sistema, 0) AS "saldoSistema",
                COALESCE(ci.saldo_sistema_origem, 'manual') AS "saldoSistemaOrigem",
                COALESCE(ci.notas_transito, 0) AS "notasTransito",
                ci.observacao
         FROM ${RAW_MATERIALS} rm
         LEFT JOIN ${CONTAGEM_ITENS} ci ON ci.contagem_id = $1 AND ci.raw_material_code = rm.code
         ORDER BY rm.code`,
        [contagemId]
      ),
      db.query(`SELECT raw_material_code AS "rawMaterialCode", COALESCE(SUM(valor), 0) AS peso FROM ${CONTAGEM_LANCAMENTOS} WHERE contagem_id = $1 AND tipo = 'PESO' GROUP BY raw_material_code`, [contagemId]),
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
    const { rows } = await db.query(`SELECT id, titulo, status, data, created_at AS "createdAt" FROM ${CONTAGENS} ORDER BY data DESC, created_at DESC`);
    res.json(rows);
  });

  router.post('/', requireAuth, requireEdit(tabContagem), async (req, res) => {
    const { titulo } = req.body || {};
    if (!titulo) return res.status(400).json({ error: 'Informe um título para a contagem.' });
    const id = crypto.randomUUID();
    await db.withTransaction(async (client) => {
      await client.query(`INSERT INTO ${CONTAGENS} (id, titulo, created_by) VALUES ($1, $2, $3)`, [id, titulo, req.user.username]);
      const { rows: materials } = await client.query(`SELECT code FROM ${RAW_MATERIALS}`);
      for (const m of materials) {
        await client.query(`INSERT INTO ${CONTAGEM_ITENS} (id, contagem_id, raw_material_code) VALUES ($1, $2, $3)`, [crypto.randomUUID(), id, m.code]);
      }
    });
    res.status(201).json({ id });
  });

  router.put('/:id', requireAuth, requireEdit(tabContagem), async (req, res) => {
    const { titulo, status } = req.body || {};
    if (status !== undefined) {
      const { rows } = await db.query(`SELECT status FROM ${CONTAGENS} WHERE id = $1`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Contagem não encontrada.' });
      if (rows[0].status === 'FINALIZADA' && status !== 'FINALIZADA' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Só um administrador pode reabrir uma contagem finalizada.' });
      }
    }
    const { rowCount } = await db.query(`UPDATE ${CONTAGENS} SET titulo = COALESCE($1, titulo), status = COALESCE($2, status) WHERE id = $3`, [titulo, status, req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Contagem não encontrada.' });
    res.json({ ok: true });
  });

  router.delete('/:id', requireAuth, requireEdit(tabContagem), async (req, res) => {
    await db.query(`DELETE FROM ${CONTAGENS} WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  });

  router.get('/:id', requireAuth, viewContagem, async (req, res) => {
    const { rows } = await db.query(`SELECT id, titulo, status, data, created_at AS "createdAt" FROM ${CONTAGENS} WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Contagem não encontrada.' });
    const itens = await loadItens(req.params.id);
    res.json({ ...rows[0], itens });
  });

  router.put('/:id/itens/:rawMaterialCode', requireAuth, requireEdit(tabContagem), async (req, res) => {
    await assertContagemAberta(req.params.id);
    const { saldoSistema, notasTransito, observacao } = req.body || {};
    const saldoVal = saldoSistema === undefined ? null : Number(saldoSistema);
    const notasVal = notasTransito === undefined ? null : Number(notasTransito);
    const observacaoVal = observacao === undefined ? null : observacao;
    const { rows: mat } = await db.query(`SELECT code FROM ${RAW_MATERIALS} WHERE code = $1`, [req.params.rawMaterialCode]);
    if (!mat.length) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
    await db.query(
      `INSERT INTO ${CONTAGEM_ITENS} (id, contagem_id, raw_material_code, saldo_sistema, saldo_sistema_origem, notas_transito, observacao)
       VALUES ($1, $2, $3, COALESCE($4, 0::double precision), 'manual', COALESCE($5, 0::double precision), $6)
       ON CONFLICT (contagem_id, raw_material_code) DO UPDATE SET
         saldo_sistema = COALESCE($4, ${CONTAGEM_ITENS}.saldo_sistema),
         saldo_sistema_origem = CASE WHEN $4 IS NOT NULL THEN 'manual' ELSE ${CONTAGEM_ITENS}.saldo_sistema_origem END,
         notas_transito = COALESCE($5, ${CONTAGEM_ITENS}.notas_transito),
         observacao = COALESCE($6, ${CONTAGEM_ITENS}.observacao),
         updated_at = now()`,
      [crypto.randomUUID(), req.params.id, req.params.rawMaterialCode, saldoVal, notasVal, observacaoVal]
    );
    res.json({ ok: true });
  });

  // ----------------------------------------------------------- Lançamentos PESO
  router.get('/:id/materiais/:rawMaterialCode/lancamentos', requireAuth, viewContagem, async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, valor, criado_por AS "criadoPor", criado_em AS "criadoEm" FROM ${CONTAGEM_LANCAMENTOS} WHERE contagem_id = $1 AND tipo = 'PESO' AND raw_material_code = $2 ORDER BY criado_em`,
      [req.params.id, req.params.rawMaterialCode]
    );
    res.json(rows);
  });

  router.post('/:id/materiais/:rawMaterialCode/lancamentos', requireAuth, requireEdit(tabContagemMobile), async (req, res) => {
    await assertContagemAberta(req.params.id);
    const valor = Number((req.body || {}).valor);
    if (Number.isNaN(valor)) return res.status(400).json({ error: 'Valor inválido.' });
    const { rows: mat } = await db.query(`SELECT code FROM ${RAW_MATERIALS} WHERE code = $1`, [req.params.rawMaterialCode]);
    if (!mat.length) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO ${CONTAGEM_LANCAMENTOS} (id, contagem_id, tipo, raw_material_code, valor, criado_por) VALUES ($1, $2, 'PESO', $3, $4, $5)`, [id, req.params.id, req.params.rawMaterialCode, valor, req.user.username]);
    const { rows: sumRows } = await db.query(`SELECT COALESCE(SUM(valor), 0) AS total FROM ${CONTAGEM_LANCAMENTOS} WHERE contagem_id = $1 AND tipo = 'PESO' AND raw_material_code = $2`, [req.params.id, req.params.rawMaterialCode]);
    res.status(201).json({ id, totalPeso: sumRows[0].total });
  });

  router.delete('/:id/materiais/:rawMaterialCode/lancamentos/:lancamentoId', requireAuth, requireEdit(tabContagemMobile), async (req, res) => {
    await assertContagemAberta(req.params.id);
    await db.query(`DELETE FROM ${CONTAGEM_LANCAMENTOS} WHERE id = $1 AND contagem_id = $2 AND tipo = 'PESO' AND raw_material_code = $3`, [req.params.lancamentoId, req.params.id, req.params.rawMaterialCode]);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------- Lançamentos UN
  router.get('/:id/produtos/:productCode/lancamentos', requireAuth, viewContagem, async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, valor, criado_por AS "criadoPor", criado_em AS "criadoEm" FROM ${CONTAGEM_LANCAMENTOS} WHERE contagem_id = $1 AND tipo = 'UN' AND product_code = $2 ORDER BY criado_em`,
      [req.params.id, req.params.productCode]
    );
    res.json(rows);
  });

  router.post('/:id/produtos/:productCode/lancamentos', requireAuth, requireEdit(tabContagemMobile), async (req, res) => {
    await assertContagemAberta(req.params.id);
    const valor = Number((req.body || {}).valor);
    if (Number.isNaN(valor)) return res.status(400).json({ error: 'Valor inválido.' });
    const { rows: prod } = await db.query(`SELECT code FROM ${PRODUCTS} WHERE code = $1`, [req.params.productCode]);
    if (!prod.length) return res.status(404).json({ error: 'Produto não encontrado.' });
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO ${CONTAGEM_LANCAMENTOS} (id, contagem_id, tipo, product_code, valor, criado_por) VALUES ($1, $2, 'UN', $3, $4, $5)`, [id, req.params.id, req.params.productCode, valor, req.user.username]);
    const { rows: sumRows } = await db.query(`SELECT COALESCE(SUM(valor), 0) AS total FROM ${CONTAGEM_LANCAMENTOS} WHERE contagem_id = $1 AND tipo = 'UN' AND product_code = $2`, [req.params.id, req.params.productCode]);
    res.status(201).json({ id, totalPecas: sumRows[0].total });
  });

  router.delete('/:id/produtos/:productCode/lancamentos/:lancamentoId', requireAuth, requireEdit(tabContagemMobile), async (req, res) => {
    await assertContagemAberta(req.params.id);
    await db.query(`DELETE FROM ${CONTAGEM_LANCAMENTOS} WHERE id = $1 AND contagem_id = $2 AND tipo = 'UN' AND product_code = $3`, [req.params.lancamentoId, req.params.id, req.params.productCode]);
    res.json({ ok: true });
  });

  // -------------------------------------------------------- Peças produzidas
  router.get('/:id/pecas-produzidas', requireAuth, viewContagem, async (req, res) => {
    const { rows } = await db.query(`SELECT product_code AS "productCode", quantidade FROM ${CONTAGEM_PECAS} WHERE contagem_id = $1`, [req.params.id]);
    res.json(rows);
  });

  router.put('/:id/pecas-produzidas/:productCode', requireAuth, requireEdit(tabMateriaPrima), async (req, res) => {
    await assertContagemAberta(req.params.id);
    const value = Number((req.body || {}).quantidade);
    if (Number.isNaN(value)) return res.status(400).json({ error: 'Quantidade inválida.' });
    const { rows: prod } = await db.query(`SELECT code FROM ${PRODUCTS} WHERE code = $1`, [req.params.productCode]);
    if (!prod.length) return res.status(404).json({ error: 'Produto não encontrado.' });
    await db.query(
      `INSERT INTO ${CONTAGEM_PECAS} (contagem_id, product_code, quantidade, updated_at, updated_by) VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (contagem_id, product_code) DO UPDATE SET quantidade = $3, updated_at = now(), updated_by = $4`,
      [req.params.id, req.params.productCode, value, req.user.username]
    );
    res.json({ ok: true });
  });

  router.get('/:id/summary', requireAuth, viewContagem, async (req, res) => {
    const itens = await getRawMaterialSummary(req.params.id);
    res.json({ itens });
  });

  // ------------------------------------------------------------- Explosão
  router.get('/:id/blends', requireAuth, viewContagem, async (req, res) => {
    res.json(await loadBlendsForContagem(req.params.id));
  });

  router.put('/:id/blends/:blendId/estados/:estado', requireAuth, requireEdit(tabExplosao), async (req, res) => {
    await assertContagemAberta(req.params.id);
    const estado = req.params.estado.toUpperCase();
    if (!ESTADOS_FORNECEDOR_PADRAO.includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });
    const value = Number((req.body || {}).quantidade);
    if (Number.isNaN(value)) return res.status(400).json({ error: 'Quantidade inválida.' });
    const { rows: blend } = await db.query(`SELECT id FROM ${BLENDS} WHERE id = $1`, [req.params.blendId]);
    if (!blend.length) return res.status(404).json({ error: 'Blend não encontrado.' });
    await db.query(
      `INSERT INTO ${CONTAGEM_BLEND_QTY} (contagem_id, blend_id, estado, quantidade, updated_at, updated_by) VALUES ($1, $2, $3, $4, now(), $5)
       ON CONFLICT (contagem_id, blend_id, estado) DO UPDATE SET quantidade = $4, updated_at = now(), updated_by = $5`,
      [req.params.id, req.params.blendId, estado, value, req.user.username]
    );
    res.json({ ok: true });
  });

  // ------------------------------------------------------------- Exportação
  router.get('/:id/export', requireAuth, viewContagem, async (req, res) => {
    const { rows: contagemRows } = await db.query(`SELECT titulo, data::text AS data FROM ${CONTAGENS} WHERE id = $1`, [req.params.id]);
    if (!contagemRows.length) return res.status(404).json({ error: 'Contagem não encontrada.' });

    const [itens, rawMaterialsRes, productsRes, productMaterialsRes, pecasProduzidas, blends] = await Promise.all([
      loadItens(req.params.id),
      db.query(`SELECT code, nome, unidade, tipo FROM ${RAW_MATERIALS} ORDER BY code`),
      db.query(`SELECT code, nome FROM ${PRODUCTS} ORDER BY code`),
      db.query(`SELECT product_code AS "productCode", raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario" FROM ${PRODUCT_MATERIALS}`),
      getPecasProduzidas(req.params.id),
      loadBlendsForContagem(req.params.id),
    ]);

    const [ano, mes, dia] = contagemRows[0].data.split('-');
    const dataFormatada = `${dia}.${mes}`;

    const wb = buildSupplierWorkbook({
      supplierLabel: label,
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
    res.setHeader('Content-Disposition', `attachment; filename="${label.toUpperCase()}_${contagemRows[0].titulo.replace(/[^a-z0-9]/gi, '_')}.xlsx"`);
    res.send(buffer);
  });

  return router;
}

function createSupplierRouters(supplier) {
  return {
    rawMaterials: createRawMaterialsRouter(supplier),
    products: createProductsRouter(supplier),
    productMaterials: createProductMaterialsRouter(supplier),
    blends: createBlendsRouter(supplier),
    contagens: createContagensRouter(supplier),
  };
}

module.exports = { createSupplierRouters };
