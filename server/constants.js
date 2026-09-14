// Papéis de usuário. 'pendente' fica reservado para uma eventual tela de
// auto-cadastro no futuro (ex: acesso do fornecedor) — hoje ninguém tem esse
// papel a menos que seja criado manualmente.
const ROLES = ['admin', 'estoque', 'contagem', 'pendente'];

// Abas do sistema — identificador único usado tanto no menu do frontend
// (web/src/constants.js) quanto no controle de permissões do backend. As
// abas "colormaq_*" são as mesmas telas da Mondial, só que para o segundo
// fornecedor (ver server/db.js, seção COLORMAQ) — identificador próprio para
// não colidir permissão/rota com as abas da Mondial, mesmo a tela exibindo
// o mesmo nome ("Contagem") nas duas.
const TABS = [
  'cadastros',
  'explosao',
  'materia_prima_produzida',
  'contagem',
  'contagem_mobile',
  'usuarios',
  'permissoes',
  'colormaq_cadastros',
  'colormaq_explosao',
  'colormaq_materia_prima_produzida',
  'colormaq_contagem',
  'colormaq_contagem_mobile',
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
  colormaq_cadastros: { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] },
  colormaq_explosao: { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] },
  colormaq_materia_prima_produzida: { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] },
  colormaq_contagem: { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] },
  colormaq_contagem_mobile: { view: ['admin', 'estoque', 'contagem'], edit: ['admin', 'estoque', 'contagem'] },
};

// Estados no formato exato da aba EXPLOSÃO da planilha original (7 linhas
// fixas por bloco) — usado só pelo importador (server/import-from-xlsx.js)
// para achar as linhas de cada mistura. Não mexer sem revisar o parser.
const ESTADOS_PLANILHA = ['BORRA', 'MISTURA', 'GALHO', 'VARREDURA', 'MOIDO', 'SUCATA', 'MAQUINA'];

// Estados usados pelo sistema (tela Explosão, cálculo de matéria-prima
// produzida) — inclui "Peça" (quanto do lote de uma mistura vira peça boa,
// não só refugo/reciclo). A planilha original tinha essa coluna na tabela de
// resumo mas nunca chegou a preencher via Explosão, por isso não faz parte
// de ESTADOS_PLANILHA.
const ESTADOS = ['BORRA', 'MISTURA', 'GALHO', 'PECA', 'VARREDURA', 'MOIDO', 'SUCATA', 'MAQUINA'];

// Estados da mistura na Colormaq — só os 2 que a planilha de referência
// (COLORMAQ.xlsx) usa, confirmado com o cliente (ver server/colormaqCalc.js).
const ESTADOS_COLORMAQ = ['MISTURA', 'MOIDO'];

module.exports = { ROLES, TABS, DEFAULT_PERMISSIONS, ESTADOS, ESTADOS_PLANILHA, ESTADOS_COLORMAQ };
