const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireEdit, blockPending } = require('../auth');

const router = express.Router();

// Substitui a lista de matérias-primas (BOM) do produto por completo — nunca
// editada linha a linha direto, sempre "tudo ou nada" numa transação.
async function replaceMaterials(productCode, materials) {
  await db.withTransaction(async (client) => {
    await client.query('DELETE FROM product_materials WHERE product_code = $1', [productCode]);
    for (const m of materials || []) {
      if (!m || !m.rawMaterialCode) continue;
      await client.query(
        `INSERT INTO product_materials (id, product_code, raw_material_code, consumo_unitario)
         VALUES ($1, $2, $3, $4)`,
        [crypto.randomUUID(), productCode, m.rawMaterialCode, Number(m.consumoUnitario) || 0]
      );
    }
  });
}

router.get('/', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query('SELECT code, nome FROM products ORDER BY code');
  res.json(rows);
});

router.get('/:code', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query('SELECT code, nome FROM products WHERE code = $1', [req.params.code]);
  if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado.' });
  const { rows: materials } = await db.query(
    'SELECT raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario" FROM product_materials WHERE product_code = $1',
    [req.params.code]
  );
  res.json({ ...rows[0], materials });
});

router.post('/', requireAuth, requireEdit('cadastros'), async (req, res) => {
  const { code, nome, materials } = req.body || {};
  if (!code || !nome) return res.status(400).json({ error: 'Informe código e nome.' });
  const { rows: existing } = await db.query('SELECT code FROM products WHERE code = $1', [code]);
  if (existing.length) return res.status(409).json({ error: 'Já existe um produto com esse código.' });
  await db.query('INSERT INTO products (code, nome) VALUES ($1, $2)', [code, nome]);
  await replaceMaterials(code, materials);
  res.status(201).json({ code, nome });
});

router.put('/:code', requireAuth, requireEdit('cadastros'), async (req, res) => {
  const { code, nome, materials } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Informe o nome.' });
  const newCode = code || req.params.code;
  if (newCode !== req.params.code) {
    const { rows: existing } = await db.query('SELECT code FROM products WHERE code = $1', [newCode]);
    if (existing.length) return res.status(409).json({ error: 'Já existe um produto com esse código.' });
  }
  const { rowCount } = await db.query('UPDATE products SET code = $1, nome = $2 WHERE code = $3', [newCode, nome, req.params.code]);
  if (!rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
  await replaceMaterials(newCode, materials);
  res.json({ ok: true, code: newCode });
});

router.delete('/:code', requireAuth, requireEdit('cadastros'), async (req, res) => {
  await db.query('DELETE FROM products WHERE code = $1', [req.params.code]);
  res.json({ ok: true });
});

module.exports = router;
