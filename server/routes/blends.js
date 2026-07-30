const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireEdit, blockPending } = require('../auth');
const { ESTADOS } = require('../constants');

const router = express.Router();

// Substitui a lista de componentes da mistura por completo (mesmo padrão
// "tudo ou nada" de products.js/replaceMaterials) — a ordem em que chegam no
// array define a ordem de retirada (ver server/calc.js).
async function replaceComponents(client, blendId, components) {
  await client.query('DELETE FROM blend_components WHERE blend_id = $1', [blendId]);
  let ordem = 0;
  for (const c of components || []) {
    if (!c || !c.rawMaterialCode) continue;
    const isLast = ordem === (components.length - 1);
    await client.query(
      `INSERT INTO blend_components (id, blend_id, raw_material_code, percentual, ordem)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), blendId, c.rawMaterialCode, isLast ? null : Number(c.percentual) || 0, ordem]
    );
    ordem += 1;
  }
}

router.get('/', requireAuth, blockPending, async (req, res) => {
  const { rows: blends } = await db.query('SELECT id, nome FROM blends ORDER BY nome');
  const { rows: components } = await db.query(
    `SELECT id, blend_id AS "blendId", raw_material_code AS "rawMaterialCode", percentual, ordem
     FROM blend_components ORDER BY blend_id, ordem`
  );
  const { rows: states } = await db.query(
    'SELECT blend_id AS "blendId", estado, quantidade FROM blend_state_quantities'
  );
  const componentsByBlend = {};
  for (const c of components) (componentsByBlend[c.blendId] = componentsByBlend[c.blendId] || []).push(c);
  const statesByBlend = {};
  for (const s of states) (statesByBlend[s.blendId] = statesByBlend[s.blendId] || {})[s.estado] = s.quantidade;

  res.json(
    blends.map((b) => ({
      ...b,
      components: componentsByBlend[b.id] || [],
      estados: ESTADOS.reduce((acc, e) => {
        acc[e] = (statesByBlend[b.id] || {})[e] || 0;
        return acc;
      }, {}),
    }))
  );
});

router.post('/', requireAuth, requireEdit('explosao'), async (req, res) => {
  const { nome, components } = req.body || {};
  if (!nome || !Array.isArray(components) || !components.length) {
    return res.status(400).json({ error: 'Informe o nome e ao menos um componente.' });
  }
  const id = crypto.randomUUID();
  await db.withTransaction(async (client) => {
    await client.query('INSERT INTO blends (id, nome) VALUES ($1, $2)', [id, nome]);
    await replaceComponents(client, id, components);
  });
  res.status(201).json({ id });
});

router.put('/:id', requireAuth, requireEdit('explosao'), async (req, res) => {
  const { nome, components } = req.body || {};
  if (!nome || !Array.isArray(components) || !components.length) {
    return res.status(400).json({ error: 'Informe o nome e ao menos um componente.' });
  }
  const { rowCount } = await db.query('UPDATE blends SET nome = $1 WHERE id = $2', [nome, req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Mistura não encontrada.' });
  await db.withTransaction((client) => replaceComponents(client, req.params.id, components));
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireEdit('explosao'), async (req, res) => {
  await db.query('DELETE FROM blends WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

router.put('/:id/estados/:estado', requireAuth, requireEdit('explosao'), async (req, res) => {
  const estado = req.params.estado.toUpperCase();
  if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });
  const value = Number((req.body || {}).quantidade);
  if (Number.isNaN(value)) return res.status(400).json({ error: 'Quantidade inválida.' });
  const { rows: blend } = await db.query('SELECT id FROM blends WHERE id = $1', [req.params.id]);
  if (!blend.length) return res.status(404).json({ error: 'Mistura não encontrada.' });
  await db.query(
    `INSERT INTO blend_state_quantities (blend_id, estado, quantidade, updated_at, updated_by)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (blend_id, estado) DO UPDATE SET quantidade = $3, updated_at = now(), updated_by = $4`,
    [req.params.id, estado, value, req.user.username]
  );
  res.json({ ok: true });
});

module.exports = router;
