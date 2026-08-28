// "group" reúne as abas específicas do padrão de inventário de uma marca sob
// um item pai retrátil na barra lateral (ex: "Mondial") — permite que outras
// marcas, com abas próprias, entrem depois sem misturar tudo numa lista só.
// Usuários e Permissões ficam fora de qualquer grupo por serem
// administrativas, compartilhadas entre todas as marcas.
export const NAV_ITEMS = [
  { id: 'cadastros', label: 'Cadastros', group: 'mondial' },
  { id: 'explosao', label: 'Explosão', group: 'mondial' },
  { id: 'materia_prima_produzida', label: 'Matéria Prima Processada', group: 'mondial' },
  { id: 'contagem', label: 'Relatório de Contagem', group: 'mondial' },
  { id: 'contagem_mobile', label: 'Contagem', group: 'mondial' },
  { id: 'usuarios', label: 'Usuários' },
  { id: 'permissoes', label: 'Permissões' },
];

export const NAV_GROUPS = { mondial: 'Mondial' };

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

// FECHADA existe só na contagem "Dados importados da planilha" criada pela
// migração automática (server/db.js) — trata como Finalizada na exibição.
export const STATUS_LABELS = { ABERTA: 'Em Contagem', FINALIZADA: 'Finalizada', FECHADA: 'Finalizada' };
export function statusTone(status) {
  return status === 'FINALIZADA' || status === 'FECHADA' ? 'success' : 'default';
}

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

// "data" vem do backend como "AAAA-MM-DD" (coluna DATE) — monta a data local
// direto dos números em vez de usar `new Date(string)`, que interpretaria
// como meia-noite UTC e poderia mostrar o dia errado dependendo do fuso do
// navegador.
export function formatDate(isoDate) {
  if (!isoDate) return '-';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function hojeBrasilia() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
