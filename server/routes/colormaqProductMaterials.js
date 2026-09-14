// Mesmo padrão de server/routes/productMaterials.js (a Mondial) — só
// leitura, tabela própria (colormaq_product_materials). Edição via PUT/POST
// em /api/colormaq/products (replace-all), nunca aqui.
const express = require('express');
const db = require('../db');
const { requireAuth, blockPending } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query(
    `SELECT product_code AS "productCode", raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario"
     FROM colormaq_product_materials`
  );
  res.json(rows);
});

module.exports = router;
