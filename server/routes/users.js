const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireView, requireEdit } = require('../auth');
const { ROLES } = require('../constants');

const router = express.Router();

router.get('/', requireAuth, requireView('usuarios'), async (req, res) => {
  const { rows } = await db.query('SELECT id, username, name, role, created_at FROM users ORDER BY name');
  res.json(rows);
});

router.post('/', requireAuth, requireEdit('usuarios'), async (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: 'Preencha usuário, senha, nome e papel.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'A senha precisa ter no mínimo 8 caracteres.' });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: 'Papel inválido.' });
  }
  const { rows: existing } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.length) {
    return res.status(409).json({ error: 'Já existe um usuário com esse login.' });
  }
  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  await db.query(
    'INSERT INTO users (id, username, password_hash, name, role) VALUES ($1, $2, $3, $4, $5)',
    [id, username, hash, name, role]
  );
  res.status(201).json({ id, username, name, role });
});

router.put('/:id', requireAuth, requireEdit('usuarios'), async (req, res) => {
  const { name, role, password } = req.body || {};
  if (role && !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Papel inválido.' });
  }
  const fields = [];
  const params = [];
  let i = 1;
  if (name) { fields.push(`name = $${i++}`); params.push(name); }
  if (role) { fields.push(`role = $${i++}`); params.push(role); }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'A senha precisa ter no mínimo 8 caracteres.' });
    fields.push(`password_hash = $${i++}`);
    params.push(bcrypt.hashSync(password, 10));
  }
  if (!fields.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  params.push(req.params.id);
  await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, params);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireEdit('usuarios'), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Você não pode excluir seu próprio usuário.' });
  }
  await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
