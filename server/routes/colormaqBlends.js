// Blends da Colormaq (dupla resina+masterbatch) — diferente da Mondial, aqui
// não tem tela própria de cadastro: um blend é criado sozinho quando um
// produto com essa combinação é salvo (ver colormaqProducts.js, syncBlend).
// Essa rota só lista, pra tela Explosão mostrar os blends que existem hoje.
const express = require('express');
const db = require('../db');
const { requireAuth, blockPending } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, blockPending, async (req, res) => {
  const { rows: blends } = await db.query('SELECT id, nome FROM colormaq_blends ORDER BY nome');
  const { rows: components } = await db.query(
    `SELECT id, blend_id AS "blendId", raw_material_code AS "rawMaterialCode", papel
     FROM colormaq_blend_components ORDER BY blend_id, papel`
  );
  const componentsByBlend = {};
  for (const c of components) (componentsByBlend[c.blendId] = componentsByBlend[c.blendId] || []).push(c);
  res.json(blends.map((b) => ({ ...b, components: componentsByBlend[b.id] || [] })));
});

module.exports = router;
