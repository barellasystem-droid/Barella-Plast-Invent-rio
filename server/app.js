require('express-async-errors');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const db = require('./db');
const { SUPPLIERS } = require('./suppliers');
const { createSupplierRouters } = require('./supplierRoutes');

const app = express();

// Necessário na Vercel (e atrás de qualquer proxy reverso) para o
// express-rate-limit enxergar o IP real do cliente via X-Forwarded-For.
app.set('trust proxy', 1);

app.use(helmet());

// O frontend é servido do mesmo domínio da API tanto local/LAN quanto na
// Vercel, então CORS aberto não é necessário por padrão — ALLOWED_ORIGIN é
// só uma válvula de escape caso algum outro site precise chamar essa API.
if (process.env.ALLOWED_ORIGIN) {
  const origins = process.env.ALLOWED_ORIGIN.split(',').map((o) => o.trim());
  app.use(cors({ origin: origins }));
}

app.use(express.json());

// Cold start em serverless pode correr com o CREATE TABLE IF NOT EXISTS do
// db.js — toda rota espera essa promise antes de tocar no banco.
app.use(async (req, res, next) => {
  await db.ready;
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/users', require('./routes/users'));
app.use('/api/raw-materials', require('./routes/rawMaterials'));
app.use('/api/products', require('./routes/products'));
app.use('/api/product-materials', require('./routes/productMaterials'));
app.use('/api/blends', require('./routes/blends'));
app.use('/api/contagens', require('./routes/contagens'));

// Fornecedores genéricos (Colormaq, Cadence, Inplast, Amvox — ver
// server/suppliers.js), schema e rotas totalmente à parte (ver
// server/db.js). Nada acima desta linha foi alterado para eles entrarem.
// Adicionar um fornecedor novo desse molde = só adicionar uma linha em
// server/suppliers.js, sem tocar aqui.
for (const supplier of SUPPLIERS) {
  const routers = createSupplierRouters(supplier);
  app.use(`/api/${supplier.key}/raw-materials`, routers.rawMaterials);
  app.use(`/api/${supplier.key}/products`, routers.products);
  app.use(`/api/${supplier.key}/product-materials`, routers.productMaterials);
  app.use(`/api/${supplier.key}/blends`, routers.blends);
  app.use(`/api/${supplier.key}/contagens`, routers.contagens);
}

// Handler final de erro — sempre responde JSON (o frontend não sabe parsear
// a página HTML de erro padrão do Express).
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Erro interno do servidor.' });
});

module.exports = app;
