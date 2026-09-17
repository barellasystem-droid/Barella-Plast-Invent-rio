// Espelha server/suppliers.js — mesma lista, mesmas chaves. Usado por
// web/src/api.js (monta api.colormaq/api.cadence/...), web/src/constants.js
// (monta NAV_ITEMS/NAV_GROUPS) e web/src/SupplierApp.jsx (monta as 5 telas
// por fornecedor). Mondial não está aqui — ela continua com tela/rota
// próprias em web/src/App.jsx.
export const SUPPLIERS = [
  { key: 'colormaq', label: 'Colormaq' },
  { key: 'cadence', label: 'Cadence' },
  { key: 'inplast', label: 'Inplast' },
  { key: 'amvox', label: 'Amvox' },
];
