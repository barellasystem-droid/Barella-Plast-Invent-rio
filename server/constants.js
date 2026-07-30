// Papéis de usuário. 'pendente' fica reservado para uma eventual tela de
// auto-cadastro no futuro (ex: acesso do fornecedor) — hoje ninguém tem esse
// papel a menos que seja criado manualmente.
const ROLES = ['admin', 'estoque', 'contagem', 'pendente'];

// Abas do sistema — identificador único usado tanto no menu do frontend
// (web/src/constants.js) quanto no controle de permissões do backend.
const TABS = [
  'cadastros',
  'explosao',
  'materia_prima_produzida',
  'contagem',
  'contagem_mobile',
  'usuarios',
  'permissoes',
];

// Usado só por server/seed.js para popular a tabela `permissions` na primeira
// vez (ON CONFLICT DO NOTHING — não sobrescreve permissões já editadas pelo
// admin em instalações existentes).
const DEFAULT_PERMISSIONS = {
  cadastros: { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] },
  explosao: { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] },
  materia_prima_produzida: { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] },
  contagem: { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] },
  contagem_mobile: { view: ['admin', 'estoque', 'contagem'], edit: ['admin', 'estoque', 'contagem'] },
  usuarios: { view: ['admin'], edit: ['admin'] },
  permissoes: { view: ['admin'], edit: ['admin'] },
};

const ESTADOS = ['BORRA', 'MISTURA', 'GALHO', 'VARREDURA', 'MOIDO', 'SUCATA', 'MAQUINA'];

module.exports = { ROLES, TABS, DEFAULT_PERMISSIONS, ESTADOS };
