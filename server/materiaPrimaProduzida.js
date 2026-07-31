// Cálculo de "quanto de cada matéria-prima já está produzida" (estoque de
// produto x BOM, virgem, e os estados da Explosão) — extraído em módulo
// próprio porque server/routes/contagens.js usa exatamente a mesma conta
// (é o "materiaPrimaProduzida" somado ao Saldo do Inventário). Sempre
// calculado para UMA contagem específica: estoque de produto, estoque virgem
// e quantidade por estado da mistura são um snapshot por contagem (ver
// server/db.js), não um valor global único.
const db = require('./db');
const { computeRawMaterialSummary } = require('./calc');

async function getRawMaterialSummary(contagemId) {
  const [rawMaterials, productMaterials, productStock, virginStock, blendsRes, componentsRes, statesRes] = await Promise.all([
    db.query('SELECT code, nome, unidade FROM raw_materials'),
    db.query('SELECT product_code AS "productCode", raw_material_code AS "rawMaterialCode", consumo_unitario AS "consumoUnitario" FROM product_materials'),
    db.query('SELECT product_code AS "productCode", quantidade FROM contagem_product_stock WHERE contagem_id = $1', [contagemId]),
    db.query('SELECT raw_material_code AS "rawMaterialCode", quantidade FROM contagem_virgin_stock WHERE contagem_id = $1', [contagemId]),
    db.query('SELECT id FROM blends'),
    db.query('SELECT blend_id AS "blendId", raw_material_code AS "rawMaterialCode", percentual, ordem FROM blend_components ORDER BY blend_id, ordem'),
    db.query('SELECT blend_id AS "blendId", estado, quantidade FROM contagem_blend_state_quantities WHERE contagem_id = $1', [contagemId]),
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

  return computeRawMaterialSummary({
    rawMaterials: rawMaterials.rows,
    productMaterials: productMaterials.rows,
    productStock: productStock.rows,
    virginStock: virginStock.rows,
    blends,
  });
}

module.exports = { getRawMaterialSummary };
