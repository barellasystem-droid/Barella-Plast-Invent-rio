// Cadastro de produto da Colormaq — mesmo padrão de server/routes/products.js
// (a Mondial: produto + BOM substituído por completo a cada save), mas aqui
// salvar a receita (resina + masterbatch) também cria/reaproveita sozinho o
// "blend" correspondente (colormaq_blends) — é dali que a tela Explosão
// aprende quais duplas resina+masterbatch existem, sem precisar de uma tela
// separada só pra cadastrar blend na mão (ver syncBlend()).
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireEdit, blockPending } = require('../auth');

const router = express.Router();

async function replaceMaterials(client, productCode, materials) {
  await client.query('DELETE FROM colormaq_product_materials WHERE product_code = $1', [productCode]);
  for (const m of materials || []) {
    if (!m || !m.rawMaterialCode) continue;
    await client.query(
      `INSERT INTO colormaq_product_materials (id, product_code, raw_material_code, consumo_unitario)
       VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), productCode, m.rawMaterialCode, Number(m.consumoUnitario) || 0]
    );
  }
}

// Se a receita do produto tem exatamente uma matéria-prima tipo RESINA e uma
// tipo MASTERBATCH, garante que existe um colormaq_blends com essa dupla
// (reaproveita se já existir — procurado pelos dois componentes, não pelo
// nome, que pode ter sido editado). Não mexe em blend nenhum se a receita
// não tiver essa combinação (ex: produto com só 1 matéria-prima, ou 2 do
// mesmo tipo) — Explosão simplesmente não vai ter um blend pra esse produto,
// o resto do cadastro continua funcionando normal.
async function syncBlend(client, materials) {
  if (!materials || materials.length < 2) return;
  const { rows: tipos } = await client.query(
    `SELECT code, tipo FROM colormaq_raw_materials WHERE code = ANY($1::text[])`,
    [materials.map((m) => m.rawMaterialCode)]
  );
  const tipoByCode = new Map(tipos.map((t) => [t.code, t.tipo]));
  const resinas = materials.filter((m) => tipoByCode.get(m.rawMaterialCode) === 'RESINA');
  const masterbatches = materials.filter((m) => tipoByCode.get(m.rawMaterialCode) === 'MASTERBATCH');
  if (resinas.length !== 1 || masterbatches.length !== 1) return;
  const resinaCode = resinas[0].rawMaterialCode;
  const masterbatchCode = masterbatches[0].rawMaterialCode;

  const { rows: existing } = await client.query(
    `SELECT b.id FROM colormaq_blends b
     JOIN colormaq_blend_components r ON r.blend_id = b.id AND r.papel = 'RESINA' AND r.raw_material_code = $1
     JOIN colormaq_blend_components m ON m.blend_id = b.id AND m.papel = 'MASTERBATCH' AND m.raw_material_code = $2`,
    [resinaCode, masterbatchCode]
  );
  if (existing.length) return;

  const { rows: nomes } = await client.query(
    `SELECT code, nome FROM colormaq_raw_materials WHERE code = ANY($1::text[])`,
    [[resinaCode, masterbatchCode]]
  );
  const nomeByCode = new Map(nomes.map((n) => [n.code, n.nome]));
  const blendId = crypto.randomUUID();
  await client.query(
    'INSERT INTO colormaq_blends (id, nome) VALUES ($1, $2)',
    [blendId, `${nomeByCode.get(resinaCode) || resinaCode} + ${nomeByCode.get(masterbatchCode) || masterbatchCode}`]
  );
  await client.query(
    `INSERT INTO colormaq_blend_components (id, blend_id, raw_material_code, papel) VALUES
     ($1, $2, $3, 'RESINA'), ($4, $2, $5, 'MASTERBATCH')`,
    [crypto.randomUUID(), blendId, resinaCode, crypto.randomUUID(), masterbatchCode]
  );
}

router.get('/', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query('SELECT code, nome FROM colormaq_products ORDER BY code');
  res.json(rows);
});

router.get('/:code', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query('SELECT code, nome FROM colormaq_products WHERE code = $1', [req.params.code]);
  if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado.' });
  const { rows: materials } = await db.query(
    'SELECT raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario" FROM colormaq_product_materials WHERE product_code = $1',
    [req.params.code]
  );
  res.json({ ...rows[0], materials });
});

router.post('/', requireAuth, requireEdit('colormaq_cadastros'), async (req, res) => {
  const { code, nome, materials } = req.body || {};
  if (!code || !nome) return res.status(400).json({ error: 'Informe código e nome.' });
  const { rows: existing } = await db.query('SELECT code FROM colormaq_products WHERE code = $1', [code]);
  if (existing.length) return res.status(409).json({ error: 'Já existe um produto com esse código.' });
  await db.withTransaction(async (client) => {
    await client.query('INSERT INTO colormaq_products (code, nome) VALUES ($1, $2)', [code, nome]);
    await replaceMaterials(client, code, materials);
    await syncBlend(client, materials);
  });
  res.status(201).json({ code, nome });
});

router.put('/:code', requireAuth, requireEdit('colormaq_cadastros'), async (req, res) => {
  const { code, nome, materials } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Informe o nome.' });
  const newCode = code || req.params.code;
  if (newCode !== req.params.code) {
    const { rows: existing } = await db.query('SELECT code FROM colormaq_products WHERE code = $1', [newCode]);
    if (existing.length) return res.status(409).json({ error: 'Já existe um produto com esse código.' });
  }
  const { rowCount } = await db.query('UPDATE colormaq_products SET code = $1, nome = $2 WHERE code = $3', [newCode, nome, req.params.code]);
  if (!rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
  await db.withTransaction(async (client) => {
    await replaceMaterials(client, newCode, materials);
    await syncBlend(client, materials);
  });
  res.json({ ok: true, code: newCode });
});

router.delete('/:code', requireAuth, requireEdit('colormaq_cadastros'), async (req, res) => {
  await db.query('DELETE FROM colormaq_products WHERE code = $1', [req.params.code]);
  res.json({ ok: true });
});

module.exports = router;
