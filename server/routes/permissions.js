const express = require('express');
const db = require('../db');
const { requireAuth, requireView, requireEdit } = require('../auth');
const { TABS, ROLES } = require('../constants');

const router = express.Router();

router.get('/', requireAuth, requireView('permissoes'), async (req, res) => {
  const { rows } = await db.query('SELECT tab_id, role, can_view, can_edit FROM permissions');
  const matrix = {};
  for (const tab of TABS) {
    matrix[tab] = { view: [], edit: [] };
  }
  for (const row of rows) {
    if (!matrix[row.tab_id]) continue;
    if (row.can_view) matrix[row.tab_id].view.push(row.role);
    if (row.can_edit) matrix[row.tab_id].edit.push(row.role);
  }
  res.json({ tabs: TABS, roles: ROLES, matrix });
});

router.put('/', requireAuth, requireEdit('permissoes'), async (req, res) => {
  const { tabId, role, canView, canEdit } = req.body || {};
  if (!TABS.includes(tabId) || !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Aba ou papel inválido.' });
  }
  // Editar sempre implica em ver — evita ficar num estado inconsistente
  // (permissão de edição sem permissão de visualização) via chamada direta à API.
  const view = canEdit ? true : !!canView;
  await db.query(
    `INSERT INTO permissions (tab_id, role, can_view, can_edit)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tab_id, role) DO UPDATE SET can_view = $3, can_edit = $4`,
    [tabId, role, view ? 1 : 0, canEdit ? 1 : 0]
  );
  res.json({ ok: true });
});

module.exports = router;
