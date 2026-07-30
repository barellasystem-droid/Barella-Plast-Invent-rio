// Funções puras de cálculo — sem dependência de banco — para poderem ser
// testadas isoladamente (ver server/import-from-xlsx.js, que valida os
// resultados contra os totais da planilha original antes de confiar nos dados
// importados) e reaproveitadas tanto pela rota /api/raw-material-summary
// quanto pela rota /api/contagens (Divergência/Condição).
const { ESTADOS } = require('./constants');

// Réplica da tabela "linha 125+" da Planilha Mestre: para cada matéria-prima,
// quanto já está "produzido" — embutido em produto em estoque (quantidade),
// em resina virgem separada (virgem), e em cada estado físico de mistura
// (Borra/Mistura/Galho/Varredura/Moído/Sucata/Máquina), vindo da Explosão.
function computeRawMaterialSummary({ rawMaterials, productMaterials, productStock, virginStock, blends }) {
  const stockByProduct = new Map(productStock.map((p) => [p.productCode, Number(p.quantidade) || 0]));
  const virginByMaterial = new Map(virginStock.map((v) => [v.rawMaterialCode, Number(v.quantidade) || 0]));

  const summary = new Map();
  for (const m of rawMaterials) {
    const row = { code: m.code, nome: m.nome, unidade: m.unidade, quantidade: 0, virgem: virginByMaterial.get(m.code) || 0 };
    for (const e of ESTADOS) row[e] = 0;
    summary.set(m.code, row);
  }

  // Quantidade = Σ (estoque do produto × consumo unitário) — a mesma soma da
  // fórmula C126 = C5*D5+C6*D6+... da planilha original.
  for (const pm of productMaterials) {
    const row = summary.get(pm.rawMaterialCode);
    if (!row) continue;
    const estoqueProduto = stockByProduct.get(pm.productCode) || 0;
    row.quantidade += estoqueProduto * (Number(pm.consumoUnitario) || 0);
  }

  // Estados: cada mistura reparte sua quantidade lançada entre os componentes
  // — cada percentual é uma fração do TOTAL da mistura naquele estado (não do
  // que sobrou), replicando o padrão predominante da planilha original (ex:
  // EXPLOSÃO!E5=C5*1.5%, D5=C5-E5; ou O63=N63-P63-Q63 com P63=N63*2% e
  // Q63=N63*7%, ambos fração do total N63). O último componente (percentual
  // nulo) fica com o que sobrar. Observação: numa única mistura minoritária
  // da planilha original (PEBD+PPVS+MASTER, linha 50-59) o master é dosado em
  // cascata sobre o restante após o PEBD, não sobre o total — a diferença
  // numérica disso é pequena (~0,15% do total daquela mistura) e foi aceita
  // como simplificação.
  for (const blend of blends) {
    const components = [...(blend.components || [])].sort((a, b) => a.ordem - b.ordem);
    for (const estado of ESTADOS) {
      const total = Number((blend.estados || {})[estado]) || 0;
      if (!total) continue;
      let remaining = total;
      components.forEach((comp, idx) => {
        const isLast = idx === components.length - 1;
        const qty = comp.percentual == null || isLast ? remaining : total * Number(comp.percentual);
        remaining -= qty;
        const row = summary.get(comp.rawMaterialCode);
        if (row) row[estado] += qty;
      });
    }
  }

  return Array.from(summary.values()).map((row) => {
    const total = row.quantidade + row.virgem + ESTADOS.reduce((sum, e) => sum + row[e], 0);
    return { ...row, total };
  });
}

// Réplica das fórmulas da aba RELATÓRIO DE CONTAGEM:
// F = D+E-C (Divergência = Inventário + Trânsito - Sistema)
// H = C=0 ? "100%" : F/C
// I = H<-2% ? VENDA : H<0% ? AJUSTE DE SAÍDA : H>0 ? AJUSTE DE ENTRADA : SEM DIFERENÇA
function computeDivergence(saldoSistema, saldoInventario, notasTransito) {
  const sistema = Number(saldoSistema) || 0;
  const inventario = Number(saldoInventario) || 0;
  const transito = Number(notasTransito) || 0;
  // Arredonda antes de comparar contra zero: somas de ponto flutuante (ex:
  // 747.953 - 747.953000000...1) podem sobrar um resíduo de ~1e-13 que não é
  // uma divergência real, e sem isso um item exatamente batido apareceria
  // como "AJUSTE DE ENTRADA" em vez de "SEM DIFERENÇA".
  const divergenciaBruta = inventario + transito - sistema;
  const divergencia = Math.abs(divergenciaBruta) < 1e-6 ? 0 : divergenciaBruta;
  const percentual = sistema === 0 ? null : divergencia / sistema;
  let condicao;
  if (sistema === 0) {
    // A planilha original mostra o texto "100%" quando o Saldo do Sistema é
    // zero/vazio, e por uma peculiaridade do Excel (texto > número em
    // comparação) isso acaba caindo em "AJUSTE DE ENTRADA". Aqui preferimos
    // deixar isso explícito em vez de herdar esse acidente de fórmula.
    condicao = 'SEM REFERÊNCIA';
  } else if (percentual < -0.02) {
    condicao = 'VENDA';
  } else if (percentual < 0) {
    condicao = 'AJUSTE DE SAÍDA';
  } else if (percentual > 0) {
    condicao = 'AJUSTE DE ENTRADA';
  } else {
    condicao = 'SEM DIFERENÇA';
  }
  return { divergencia, percentual, condicao };
}

module.exports = { computeRawMaterialSummary, computeDivergence };
