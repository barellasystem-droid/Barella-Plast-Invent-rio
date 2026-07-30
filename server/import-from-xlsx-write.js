// Grava no banco os dados já extraídos por parseWorkbook() (server/import-from-xlsx.js).
// Separado do parser para o parser poder ser testado sozinho, sem precisar de
// DATABASE_URL nem tocar no banco (ver validate no final daquele arquivo).
const crypto = require('crypto');
const db = require('./db');

module.exports = async function writeImport(data) {
  await db.ready;

  for (const m of data.rawMaterials) {
    await db.query(
      `INSERT INTO raw_materials (code, nome, unidade) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET nome = $2, unidade = $3`,
      [m.code, m.nome, m.unidade || 'KG']
    );
  }

  for (const p of data.products) {
    await db.query(
      `INSERT INTO products (code, nome) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET nome = $2`,
      [p.code, p.nome]
    );
  }

  await db.withTransaction(async (client) => {
    for (const p of data.products) {
      await client.query('DELETE FROM product_materials WHERE product_code = $1', [p.code]);
    }
    for (const pm of data.productMaterials) {
      await client.query(
        `INSERT INTO product_materials (id, product_code, raw_material_code, consumo_unitario)
         VALUES ($1, $2, $3, $4)`,
        [crypto.randomUUID(), pm.productCode, pm.rawMaterialCode, pm.consumoUnitario]
      );
    }
  });

  for (const s of data.productStock) {
    await db.query(
      `INSERT INTO product_stock (product_code, quantidade) VALUES ($1, $2)
       ON CONFLICT (product_code) DO UPDATE SET quantidade = $2, updated_at = now()`,
      [s.productCode, s.quantidade]
    );
  }

  for (const v of data.virginStock) {
    await db.query(
      `INSERT INTO raw_material_virgin_stock (raw_material_code, quantidade) VALUES ($1, $2)
       ON CONFLICT (raw_material_code) DO UPDATE SET quantidade = $2, updated_at = now()`,
      [v.rawMaterialCode, v.quantidade]
    );
  }

  for (const b of data.blends) {
    const id = crypto.randomUUID();
    await db.query('INSERT INTO blends (id, nome) VALUES ($1, $2)', [id, b.nome]);
    let ordem = 0;
    for (const c of b.components) {
      await db.query(
        `INSERT INTO blend_components (id, blend_id, raw_material_code, percentual, ordem) VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), id, c.rawMaterialCode, c.percentual, ordem]
      );
      ordem += 1;
    }
    for (const [estado, quantidade] of Object.entries(b.estados)) {
      await db.query(
        `INSERT INTO blend_state_quantities (blend_id, estado, quantidade) VALUES ($1, $2, $3)
         ON CONFLICT (blend_id, estado) DO UPDATE SET quantidade = $3`,
        [id, estado, quantidade]
      );
    }
  }
};
