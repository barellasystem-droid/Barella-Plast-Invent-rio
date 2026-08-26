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

// Cadastro em lote — usado pela tela de importação da Contagem, quando o
// arquivo do fornecedor traz vários códigos que ainda não existem no
// cadastro. Não tem nenhuma implicação fiscal (é só cadastro de matéria-
// prima), por isso pode entrar tudo de uma vez com código e nome exatamente
// como vieram no arquivo, sem precisar abrir um a um.
router.post('/bulk', requireAuth, requireEdit('cadastros'), async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Nenhum item informado.' });
  }
  const created = [];
  const skipped = [];
  for (const item of items) {
    if (!item || !item.code || !item.nome) continue;
    const { rows: existing } = await db.query('SELECT code FROM raw_materials WHERE code = $1', [item.code]);
    if (existing.length) { skipped.push(item.code); continue; }
    await db.query(
      'INSERT INTO raw_materials (code, nome, unidade) VALUES ($1, $2, $3)',
      [item.code, item.nome, item.unidade || 'KG']
    );
    created.push(item.code);
  }
  res.status(201).json({ created, skipped });
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
  const { code, nome, unidade } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Informe o nome.' });
  const newCode = code || req.params.code;
  if (newCode !== req.params.code) {
    const { rows: existing } = await db.query('SELECT code FROM raw_materials WHERE code = $1', [newCode]);
    if (existing.length) return res.status(409).json({ error: 'Já existe uma matéria-prima com esse código.' });
  }
  const { rowCount } = await db.query(
    'UPDATE raw_materials SET code = $1, nome = $2, unidade = $3 WHERE code = $4',
    [newCode, nome, unidade || 'KG', req.params.code]
  );
  if (!rowCount) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
  res.json({ ok: true, code: newCode });
});

router.delete('/:code', requireAuth, requireEdit('cadastros'), async (req, res) => {
  await db.query('DELETE FROM raw_materials WHERE code = $1', [req.params.code]);
  res.json({ ok: true });
});

module.exports = router;
