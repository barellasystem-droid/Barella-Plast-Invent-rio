const { SUPPLIERS } = require('./suppliers');

// Papéis de usuário. 'pendente' fica reservado para uma eventual tela de
// auto-cadastro no futuro (ex: acesso do fornecedor) — hoje ninguém tem esse
// papel a menos que seja criado manualmente.
const ROLES = ['admin', 'estoque', 'contagem', 'pendente'];

// Abas do sistema — identificador único usado tanto no menu do frontend
// (web/src/constants.js) quanto no controle de permissões do backend. As
// abas "<fornecedor>_*" são as mesmas 5 telas para cada fornecedor genérico
// (Colormaq, Cadence, Inplast, Amvox — ver server/suppliers.js e
// server/db.js) — identificador próprio por fornecedor para não colidir
// permissão/rota entre eles nem com a Mondial, mesmo a tela exibindo o
// mesmo nome ("Contagem") em todos.
const SUPPLIER_TAB_SUFFIXES = ['cadastros', 'explosao', 'materia_prima_produzida', 'contagem', 'contagem_mobile'];

const TABS = [
  'cadastros',
  'explosao',
  'materia_prima_produzida',
  'contagem',
  'contagem_mobile',
  'usuarios',
  'permissoes',
  ...SUPPLIERS.flatMap((s) => SUPPLIER_TAB_SUFFIXES.map((suffix) => `${s.key}_${suffix}`)),
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
for (const s of SUPPLIERS) {
  DEFAULT_PERMISSIONS[`${s.key}_cadastros`] = { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] };
  DEFAULT_PERMISSIONS[`${s.key}_explosao`] = { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] };
  DEFAULT_PERMISSIONS[`${s.key}_materia_prima_produzida`] = { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] };
  DEFAULT_PERMISSIONS[`${s.key}_contagem`] = { view: ['admin', 'estoque'], edit: ['admin', 'estoque'] };
  DEFAULT_PERMISSIONS[`${s.key}_contagem_mobile`] = { view: ['admin', 'estoque', 'contagem'], edit: ['admin', 'estoque', 'contagem'] };
}

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

// Estados da mistura no modelo dos fornecedores genéricos (Colormaq,
// Cadence, Inplast, Amvox) — só os 2 que a planilha de referência original
// da Colormaq (COLORMAQ.xlsx) usa, confirmado com o cliente e replicado
// como molde padrão pros fornecedores seguintes (ver server/supplierCalc.js).
const ESTADOS_FORNECEDOR_PADRAO = ['MISTURA', 'MOIDO'];

module.exports = { ROLES, TABS, DEFAULT_PERMISSIONS, ESTADOS, ESTADOS_PLANILHA, ESTADOS_FORNECEDOR_PADRAO };
