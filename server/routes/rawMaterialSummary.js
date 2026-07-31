const express = require('express');
const { requireAuth, blockPending } = require('../auth');
const { getRawMaterialSummary } = require('../materiaPrimaProduzida');
const { ESTADOS } = require('../constants');

const router = express.Router();

router.get('/', requireAuth, blockPending, async (req, res) => {
  const itens = await getRawMaterialSummary();
  res.json({ estados: ESTADOS, itens });
});

module.exports = router;
