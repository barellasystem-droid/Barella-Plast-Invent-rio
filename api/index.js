// Entrypoint serverless da Vercel: mesmo Express app usado localmente
// (server/app.js), sem servir estático e sem app.listen — a Vercel serve
// web/dist diretamente e invoca este arquivo a cada request, em vez de rodar
// um processo contínuo.
module.exports = require('../server/app');
