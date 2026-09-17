// Lista dos fornecedores "genéricos" do sistema — todos seguindo o mesmo
// modelo criado pra Colormaq (produto com receita de resina+masterbatch,
// só 2 estados de mistura — Mistura/Moído —, contagem física em KG
// (matéria-prima) ou UN (produto, alimenta a Explosão)). Mondial não está
// nessa lista: ela tem schema/rotas/telas próprias, mais antigas e com um
// modelo diferente (BOM com N matérias-primas, 8 estados de mistura,
// blend_components com percentual/ordem) — ver server/db.js e
// server/routes/contagens.js.
//
// Adicionar um fornecedor novo nesse molde = adicionar uma linha aqui.
// "key" vira o prefixo de tabela (`${key}_raw_materials` etc.), o prefixo
// de rota (`/api/${key}/...`) e o prefixo de tab_id de permissão
// (`${key}_cadastros` etc.) — precisa ser minúsculo, sem espaço/acento,
// estável (nunca mudar depois de já ter dado deploy, senão os dados
// existentes ficam "órfãos" de tabelas com o nome antigo).
const SUPPLIERS = [
  { key: 'colormaq', label: 'Colormaq' },
  { key: 'cadence', label: 'Cadence' },
  { key: 'inplast', label: 'Inplast' },
  { key: 'amvox', label: 'Amvox' },
];

module.exports = { SUPPLIERS };
