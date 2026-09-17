// Funções puras de cálculo dos fornecedores genéricos (Colormaq, Cadence,
// Inplast, Amvox — ver server/suppliers.js) — sem dependência de banco,
// mesmo espírito de server/calc.js (que também é reaproveitado daqui para a
// Divergência/Condição, ver computeDivergence). Réplica do que a planilha
// original de referência (COLORMAQ.xlsx) calcula por aba/data: para cada
// matéria-prima, quanto foi consumido pelas peças produzidas (via receita
// do produto) mais o que veio de mistura/moído reciclado, repartido entre
// resina e masterbatch. Mesma função pra todos os fornecedores desse
// molde — nada aqui é específico de um fornecedor.
const { ESTADOS_FORNECEDOR_PADRAO } = require('./constants');

// Quanto de cada matéria-prima foi consumido pelas peças produzidas nessa
// contagem — réplica de X=G*U / Y=M*U da planilha, somado por matéria-prima
// (réplica de AP9=X7+X9+X14+... — soma todo produto que usa aquela
// matéria-prima, não só um).
function computeConsumoPorMaterial({ productMaterials, pecasProduzidas }) {
  const pecasByProduct = new Map(pecasProduzidas.map((p) => [p.productCode, Number(p.quantidade) || 0]));
  const consumo = new Map(); // rawMaterialCode -> total consumido
  for (const pm of productMaterials) {
    const pecas = pecasByProduct.get(pm.productCode) || 0;
    if (!pecas) continue;
    const atual = consumo.get(pm.rawMaterialCode) || 0;
    consumo.set(pm.rawMaterialCode, atual + pecas * (Number(pm.consumoUnitario) || 0));
  }
  return consumo;
}

// Percentual do masterbatch dentro de um blend (resina+masterbatch), nessa
// contagem: média ponderada pelas peças produzidas dos produtos daquele
// blend (M_i*pecas_i / (G_i+M_i)*pecas_i) — sempre derivado do
// consumo_unitario já cadastrado no produto (G e M da planilha), nunca
// guardado separado, para não ficar dessincronizado se a receita do produto
// mudar (pedido do cliente: editável no cadastro do produto, não um campo à
// parte). Sem produção no período para esse blend, cai para a média simples
// dos percentuais registrados (sem peso de peças), só para não deixar sem
// definição.
function percentualMasterbatch({ blend, productMaterials, pecasProduzidas }) {
  const resina = blend.components.find((c) => c.papel === 'RESINA');
  const masterbatch = blend.components.find((c) => c.papel === 'MASTERBATCH');
  if (!resina || !masterbatch) return 0;

  const pecasByProduct = new Map(pecasProduzidas.map((p) => [p.productCode, Number(p.quantidade) || 0]));
  const consumoByProductMaterial = new Map(); // "product|material" -> consumoUnitario
  for (const pm of productMaterials) consumoByProductMaterial.set(`${pm.productCode}|${pm.rawMaterialCode}`, Number(pm.consumoUnitario) || 0);

  // Produtos que usam exatamente essa dupla resina+masterbatch.
  const produtosDoBlend = [...new Set(productMaterials.filter((pm) => pm.rawMaterialCode === resina.rawMaterialCode).map((pm) => pm.productCode))].filter(
    (code) => consumoByProductMaterial.has(`${code}|${masterbatch.rawMaterialCode}`)
  );
  if (!produtosDoBlend.length) return 0;

  let pesoTotal = 0;
  let masterbatchPonderado = 0;
  let somaRatiosSimples = 0;
  for (const code of produtosDoBlend) {
    const g = consumoByProductMaterial.get(`${code}|${resina.rawMaterialCode}`) || 0;
    const m = consumoByProductMaterial.get(`${code}|${masterbatch.rawMaterialCode}`) || 0;
    const ratio = g + m > 0 ? m / (g + m) : 0;
    somaRatiosSimples += ratio;
    const pecas = pecasByProduct.get(code) || 0;
    const peso = (g + m) * pecas;
    pesoTotal += peso;
    masterbatchPonderado += m * pecas;
  }
  if (pesoTotal > 0) return masterbatchPonderado / pesoTotal;
  return somaRatiosSimples / produtosDoBlend.length;
}

// Réplica do bloco de total por matéria-prima da planilha (colunas
// AE/AH/AK/AP/AS): consumo pelas peças produzidas + repartição da mistura
// reciclada de cada blend em que a matéria-prima participa (como resina ou
// como masterbatch).
function computeRawMaterialSummary({ rawMaterials, productMaterials, pecasProduzidas, blends, blendQuantities }) {
  const consumoPorMaterial = computeConsumoPorMaterial({ productMaterials, pecasProduzidas });
  const quantidadeByBlendEstado = new Map(); // `${blendId}|${estado}` -> quantidade
  for (const q of blendQuantities) quantidadeByBlendEstado.set(`${q.blendId}|${q.estado}`, Number(q.quantidade) || 0);

  const summary = new Map();
  for (const m of rawMaterials) {
    summary.set(m.code, { code: m.code, nome: m.nome, unidade: m.unidade, consumido: consumoPorMaterial.get(m.code) || 0, reciclado: 0, total: 0 });
  }

  for (const blend of blends) {
    const resina = blend.components.find((c) => c.papel === 'RESINA');
    const masterbatch = blend.components.find((c) => c.papel === 'MASTERBATCH');
    if (!resina || !masterbatch) continue;
    const pctMasterbatch = percentualMasterbatch({ blend, productMaterials, pecasProduzidas });

    for (const estado of ESTADOS_FORNECEDOR_PADRAO) {
      const quantidade = quantidadeByBlendEstado.get(`${blend.id}|${estado}`) || 0;
      if (!quantidade) continue;
      const parteMasterbatch = quantidade * pctMasterbatch;
      const parteResina = quantidade - parteMasterbatch;
      const rowResina = summary.get(resina.rawMaterialCode);
      const rowMasterbatch = summary.get(masterbatch.rawMaterialCode);
      if (rowResina) rowResina.reciclado += parteResina;
      if (rowMasterbatch) rowMasterbatch.reciclado += parteMasterbatch;
    }
  }

  return Array.from(summary.values()).map((row) => ({ ...row, total: row.consumido + row.reciclado }));
}

module.exports = { computeConsumoPorMaterial, percentualMasterbatch, computeRawMaterialSummary };
