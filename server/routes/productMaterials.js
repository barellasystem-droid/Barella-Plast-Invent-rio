const express = require('express');
const db = require('../db');
const { requireAuth, blockPending } = require('../auth');

const router = express.Router();

// Somente leitura — a lista completa é usada por outras telas (Matéria-Prima
// Produzida) para montar o BOM inteiro de uma vez. Edição só acontece via
// PUT/POST em /api/products (replace-all), nunca aqui.
router.get('/', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query(
    `SELECT product_code AS "productCode", raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario"
     FROM product_materials`
  );
  res.json(rows);
});

module.exports = router;
