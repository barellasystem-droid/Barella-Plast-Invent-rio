const express = require('express');
const db = require('../db');
const { requireAuth, requireEdit, blockPending } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query(
    'SELECT product_code AS "productCode", quantidade FROM product_stock'
  );
  res.json(rows);
});

router.put('/:productCode', requireAuth, requireEdit('materia_prima_produzida'), async (req, res) => {
  const { quantidade } = req.body || {};
  const value = Number(quantidade);
  if (Number.isNaN(value)) return res.status(400).json({ error: 'Quantidade inválida.' });
  const { rows: prod } = await db.query('SELECT code FROM products WHERE code = $1', [req.params.productCode]);
  if (!prod.length) return res.status(404).json({ error: 'Produto não encontrado.' });
  await db.query(
    `INSERT INTO product_stock (product_code, quantidade, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (product_code) DO UPDATE SET quantidade = $2, updated_at = now(), updated_by = $3`,
    [req.params.productCode, value, req.user.username]
  );
  res.json({ ok: true });
});

module.exports = router;
