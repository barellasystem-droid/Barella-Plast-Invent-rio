const express = require('express');
const db = require('../db');
const { requireAuth, blockPending } = require('../auth');
const { computeRawMaterialSummary } = require('../calc');
const { ESTADOS } = require('../constants');

const router = express.Router();

router.get('/', requireAuth, blockPending, async (req, res) => {
  const [rawMaterials, productMaterials, productStock, virginStock, blendsRes, componentsRes, statesRes] = await Promise.all([
    db.query('SELECT code, nome, unidade FROM raw_materials'),
    db.query('SELECT product_code AS "productCode", raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario" FROM product_materials'),
    db.query('SELECT product_code AS "productCode", quantidade FROM product_stock'),
    db.query('SELECT raw_material_code AS "rawMaterialCode", quantidade FROM raw_material_virgin_stock'),
    db.query('SELECT id FROM blends'),
    db.query('SELECT blend_id AS "blendId", raw_material_code AS "rawMaterialCode", percentual, ordem FROM blend_components ORDER BY blend_id, ordem'),
    db.query('SELECT blend_id AS "blendId", estado, quantidade FROM blend_state_quantities'),
  ]);

  const statesByBlend = {};
  for (const s of statesRes.rows) {
    (statesByBlend[s.blendId] = statesByBlend[s.blendId] || {})[s.estado] = s.quantidade;
  }
  const componentsByBlend = {};
  for (const c of componentsRes.rows) {
    (componentsByBlend[c.blendId] = componentsByBlend[c.blendId] || []).push(c);
  }
  const blends = blendsRes.rows.map((b) => ({
    ...b,
    components: componentsByBlend[b.id] || [],
    estados: statesByBlend[b.id] || {},
  }));

  const summary = computeRawMaterialSummary({
    rawMaterials: rawMaterials.rows,
    productMaterials: productMaterials.rows,
    productStock: productStock.rows,
    virginStock: virginStock.rows,
    blends,
  });

  res.json({ estados: ESTADOS, itens: summary });
});

module.exports = router;
