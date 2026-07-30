export const NAV_ITEMS = [
  { id: 'cadastros', label: 'Cadastros' },
  { id: 'explosao', label: 'Explosão' },
  { id: 'materia_prima_produzida', label: 'Matéria-Prima Produzida' },
  { id: 'contagem', label: 'Relatório de Contagem' },
  { id: 'contagem_mobile', label: 'Contagem (celular)' },
  { id: 'usuarios', label: 'Usuários' },
  { id: 'permissoes', label: 'Permissões' },
];

export const ESTADOS = ['BORRA', 'MISTURA', 'GALHO', 'PECA', 'VARREDURA', 'MOIDO', 'SUCATA', 'MAQUINA'];
export const ESTADO_LABELS = {
  BORRA: 'Borra',
  MISTURA: 'Mistura',
  GALHO: 'Galho',
  PECA: 'Peça',
  VARREDURA: 'Varredura',
  MOIDO: 'Moído',
  SUCATA: 'Sucata',
  MAQUINA: 'Máquina',
};

export const UNIDADES = ['KG', 'UN', 'ML', 'PÇ'];
export const ROLES = ['admin', 'estoque', 'contagem'];
export const ROLE_LABELS = { admin: 'Administrador', estoque: 'Estoque', contagem: 'Contagem', pendente: 'Pendente' };

export function condicaoTone(condicao) {
  if (condicao === 'VENDA') return 'danger';
  if (condicao === 'AJUSTE DE SAÍDA') return 'warning';
  if (condicao === 'AJUSTE DE ENTRADA') return 'success';
  return 'default';
}

export function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

export function formatPercent(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return (Number(n) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}
