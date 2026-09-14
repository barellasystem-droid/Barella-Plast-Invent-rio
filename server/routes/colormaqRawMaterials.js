// Cadastro de matéria-prima da Colormaq — mesmo padrão de
// server/routes/rawMaterials.js (a Mondial), tabela própria
// (colormaq_raw_materials), sem nenhuma relação com a tabela da Mondial.
// "tipo" (RESINA/MASTERBATCH) é o que permite ao cadastro de produto
// derivar o blend sozinho — ver server/routes/colormaqProducts.js.
const express = require('express');
const db = require('../db');
const { requireAuth, requireEdit, blockPending } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query('SELECT code, nome, unidade, tipo FROM colormaq_raw_materials ORDER BY code');
  res.json(rows);
});

router.get('/:code', requireAuth, blockPending, async (req, res) => {
  const { rows } = await db.query('SELECT code, nome, unidade, tipo FROM colormaq_raw_materials WHERE code = $1', [req.params.code]);
  if (!rows.length) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
  res.json(rows[0]);
});

router.post('/bulk', requireAuth, requireEdit('colormaq_cadastros'), async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Nenhum item informado.' });
  }
  const created = [];
  const skipped = [];
  for (const item of items) {
    if (!item || !item.code || !item.nome) continue;
    const { rows: existing } = await db.query('SELECT code FROM colormaq_raw_materials WHERE code = $1', [item.code]);
    if (existing.length) { skipped.push(item.code); continue; }
    await db.query(
      'INSERT INTO colormaq_raw_materials (code, nome, unidade, tipo) VALUES ($1, $2, $3, $4)',
      [item.code, item.nome, item.unidade || 'KG', item.tipo || null]
    );
    created.push(item.code);
  }
  res.status(201).json({ created, skipped });
});

router.post('/', requireAuth, requireEdit('colormaq_cadastros'), async (req, res) => {
  const { code, nome, unidade, tipo } = req.body || {};
  if (!code || !nome) return res.status(400).json({ error: 'Informe código e nome.' });
  if (tipo && !['RESINA', 'MASTERBATCH'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
  const { rows: existing } = await db.query('SELECT code FROM colormaq_raw_materials WHERE code = $1', [code]);
  if (existing.length) return res.status(409).json({ error: 'Já existe uma matéria-prima com esse código.' });
  await db.query(
    'INSERT INTO colormaq_raw_materials (code, nome, unidade, tipo) VALUES ($1, $2, $3, $4)',
    [code, nome, unidade || 'KG', tipo || null]
  );
  res.status(201).json({ code, nome, unidade: unidade || 'KG', tipo: tipo || null });
});

router.put('/:code', requireAuth, requireEdit('colormaq_cadastros'), async (req, res) => {
  const { code, nome, unidade, tipo } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Informe o nome.' });
  if (tipo && !['RESINA', 'MASTERBATCH'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
  const newCode = code || req.params.code;
  if (newCode !== req.params.code) {
    const { rows: existing } = await db.query('SELECT code FROM colormaq_raw_materials WHERE code = $1', [newCode]);
    if (existing.length) return res.status(409).json({ error: 'Já existe uma matéria-prima com esse código.' });
  }
  const { rowCount } = await db.query(
    'UPDATE colormaq_raw_materials SET code = $1, nome = $2, unidade = $3, tipo = $4 WHERE code = $5',
    [newCode, nome, unidade || 'KG', tipo || null, req.params.code]
  );
  if (!rowCount) return res.status(404).json({ error: 'Matéria-prima não encontrada.' });
  res.json({ ok: true, code: newCode });
});

router.delete('/:code', requireAuth, requireEdit('colormaq_cadastros'), async (req, res) => {
  await db.query('DELETE FROM colormaq_raw_materials WHERE code = $1', [req.params.code]);
  res.json({ ok: true });
});

module.exports = router;
