// Cálculo de "quanto de cada matéria-prima já está produzida" (estoque de
// produto x BOM, virgem, e os estados da Explosão) — extraído em módulo
// próprio porque server/routes/rawMaterialSummary.js (tela Matéria-Prima
// Produzida) e server/routes/contagens.js (Saldo do Inventário do Relatório
// de Contagem, que soma esse total junto com o que foi contado no celular)
// usam exatamente a mesma conta.
const db = require('./db');
const { computeRawMaterialSummary } = require('./calc');

async function getRawMaterialSummary() {
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

  return computeRawMaterialSummary({
    rawMaterials: rawMaterials.rows,
    productMaterials: productMaterials.rows,
    productStock: productStock.rows,
    virginStock: virginStock.rows,
    blends,
  });
}

module.exports = { getRawMaterialSummary };
