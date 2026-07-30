const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('../db');
const { signToken, requireAuth } = require('../auth');
const { TABS } = require('../constants');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

router.post('/register', loginLimiter, async (req, res) => {
  const { username, password, name, email, phone } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Preencha nome, usuário e senha.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'A senha precisa ter no mínimo 8 caracteres.' });
  }
  const { rows: existing } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.length) {
    return res.status(409).json({ error: 'Já existe um usuário com esse login.' });
  }
  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(password, 10);
  // Entra sempre com papel 'pendente' — só um administrador consegue liberar
  // o acesso de verdade, trocando o papel em Usuários (ver server/routes/users.js).
  await db.query(
    'INSERT INTO users (id, username, password_hash, name, role, email, phone) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, username, hash, name, 'pendente', email || null, phone || null]
  );
  res.status(201).json({ ok: true });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  }
  const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT tab_id, can_view, can_edit FROM permissions WHERE role = $1', [req.user.role]);
  const permissions = {};
  for (const tab of TABS) permissions[tab] = { view: false, edit: false };
  for (const row of rows) {
    permissions[row.tab_id] = { view: !!row.can_view, edit: !!row.can_edit };
  }
  res.json({ user: req.user, permissions });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'A nova senha precisa ter no mínimo 8 caracteres.' });
  }
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(401).json({ error: 'Senha atual incorreta.' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
  res.json({ ok: true });
});

module.exports = router;
