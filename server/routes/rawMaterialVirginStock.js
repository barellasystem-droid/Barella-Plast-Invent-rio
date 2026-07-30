const express = require('express');
const db = require('../db');
const { requireAuth, requireEdit, blockPending } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query(
    'SELECT raw_material_code AS "rawMaterialCode", quantidade FROM raw_material_virgin_stock'
  );
  res.json(rows);
});

router.put('/:rawMaterialCode', requireAuth, requireEdit('materia_prima_produzida'), async (req, res) => {
  const { quantidade } = req.body || {};
  const value = Number(quantidade);
  if (Number.isNaN(value)) return res.status(400).json({ error: 'Quantidade inválida.' });
  const { rows: mat } = await db.query('SELECT code FROM raw_materials WHERE code = $1', [req.params.rawMaterialCode]);
  if (!mat.length) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
  await db.query(
    `INSERT INTO raw_material_virgin_stock (raw_material_code, quantidade, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (raw_material_code) DO UPDATE SET quantidade = $2, updated_at = now(), updated_by = $3`,
    [req.params.rawMaterialCode, value, req.user.username]
  );
  res.json({ ok: true });
});

module.exports = router;
