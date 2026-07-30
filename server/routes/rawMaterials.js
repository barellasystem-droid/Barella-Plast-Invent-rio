const express = require('express');
const db = require('../db');
const { requireAuth, requireEdit, blockPending } = require('../auth');

const router = express.Router();

// Leitura liberada para qualquer usuário autenticado (não só quem tem acesso
// à aba "cadastros") — outras telas (explosão, contagem, matéria-prima
// produzida) precisam poder buscar/listar matérias-primas mesmo sem
// permissão para editar o cadastro em si.
router.get('/', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query('SELECT code, nome, unidade FROM raw_materials ORDER BY code');
  res.json(rows);
});

router.get('/:code', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query('SELECT code, nome, unidade FROM raw_materials WHERE code = $1', [req.params.code]);
  if (!rows.length) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
  res.json(rows[0]);
});

router.post('/', requireAuth, requireEdit('cadastros'), async (req, res) => {
  const { code, nome, unidade } = req.body || {};
  if (!code || !nome) return res.status(400).json({ error: 'Informe código e nome.' });
  const { rows: existing } = await db.query('SELECT code FROM raw_materials WHERE code = $1', [code]);
  if (existing.length) return res.status(409).json({ error: 'Já existe uma matéria-prima com esse código.' });
  await db.query(
    'INSERT INTO raw_materials (code, nome, unidade) VALUES ($1, $2, $3)',
    [code, nome, unidade || 'KG']
  );
  res.status(201).json({ code, nome, unidade: unidade || 'KG' });
});

router.put('/:code', requireAuth, requireEdit('cadastros'), async (req, res) => {
  const { nome, unidade } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Informe o nome.' });
  const { rowCount } = await db.query(
    'UPDATE raw_materials SET nome = $1, unidade = $2 WHERE code = $3',
    [nome, unidade || 'KG', req.params.code]
  );
  if (!rowCount) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
  res.json({ ok: true });
});

router.delete('/:code', requireAuth, requireEdit('cadastros'), async (req, res) => {
  await db.query('DELETE FROM raw_materials WHERE code = $1', [req.params.code]);
  res.json({ ok: true });
});

module.exports = router;
