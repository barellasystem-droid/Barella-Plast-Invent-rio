// Monta o XLSX exportado da Contagem replicando a estrutura da planilha
// original (INVENTÁRIO BARELLA) — 4 abas: PLANILHA MESTRE, EXPLOSÃO,
// RELATÓRIO DE CONTAGEM e Plan1 — com fórmulas de Excel de verdade (não só
// valores já calculados), para atender a exigência do cliente de auditoria
// ("prestação de contas"). Toda célula de fórmula também carrega o valor já
// calculado (mesma conta de server/calc.js, que é a fonte da tela do
// sistema) como cache: abre já mostrando o número certo em qualquer leitor
// (Excel recalcula sozinho ao abrir por causa do fullCalcOnLoad; um simples
// preview que não recalcula formula também mostra o valor certo).
//
// Diferença deliberada em relação à planilha original: lá, "SALDO DO
// INVENTÁRIO" era a fórmula ='PLANILHA MESTRE'!O126 com ajustes manuais
// digitados por cima a cada contagem (números que só faziam sentido para
// aquela apuração específica, ex: -400.9416). Aqui o Saldo do Inventário
// continua sendo o valor oficial da contagem (pesagem física somada ao que
// já está em processo/mistura, calculado em server/calc.js — o mesmo número
// que a tela do sistema mostra), mas escrito como fórmula que soma esse
// valor ao total recalculado ao vivo em PLANILHA MESTRE, preservando a mesma
// cadeia de cálculo auditável sem depender de ajustes manuais não
// rastreáveis. B/G (Descrição/Unidade) viravam PROCV para um arquivo externo
// que não existe mais ("BASE DIVERGÊNCIA"); aqui apontam para a aba Plan1,
// que faz parte do próprio arquivo.
const XLSX = require('xlsx');
const { ESTADOS } = require('./constants');
const { computeRawMaterialSummary } = require('./calc');

const NUM_FMT = '#,##0.000000';
const INT_FMT = '#,##0.###';
const PCT_FMT = '0.00%';

function cellRef(r, c) {
  return XLSX.utils.encode_cell({ r, c });
}

function setText(ws, r, c, value) {
  if (value === undefined || value === null || value === '') return null;
  const addr = cellRef(r, c);
  ws[addr] = { t: 's', v: String(value) };
  return addr;
}

function setNum(ws, r, c, value, fmt) {
  const addr = cellRef(r, c);
  ws[addr] = { t: 'n', v: Number(value) || 0 };
  if (fmt) ws[addr].z = fmt;
  return addr;
}

// Fórmula com valor já calculado em cache (cachedValue), pra nunca depender
// só do recálculo automático do Excel — se cachedType não vier, infere 'n'
// para número e 'str' para texto.
function setFormula(ws, r, c, formula, cachedValue, fmt) {
  const addr = cellRef(r, c);
  const isText = typeof cachedValue === 'string';
  const cell = { t: isText ? 'str' : 'n', f: formula, v: isText ? cachedValue : Number(cachedValue) || 0 };
  if (fmt) cell.z = fmt;
  ws[addr] = cell;
  return addr;
}

// Réplica dos blocos de mistura da aba EXPLOSÃO: para cada mistura, 8 linhas
// de estado (a mesma lista usada pela tela Explosão, incluindo Peça — a
// planilha original reservava a coluna mas nunca chegou a preencher) e uma
// coluna por componente. O componente sem percentual (ordem mais alta) fica
// com o que sobrar depois dos outros — mesma regra de server/calc.js
// (computeRawMaterialSummary), calculada aqui em paralelo à fórmula pra virar
// o valor em cache de cada célula.
function buildExplosao({ blends, materialByCode }) {
  const ws = {};
  let r = 0;
  let maxCol = 1;
  const materialEstadoCells = {};

  function addRef(code, estado, ref) {
    if (!materialEstadoCells[code]) materialEstadoCells[code] = {};
    if (!materialEstadoCells[code][estado]) materialEstadoCells[code][estado] = [];
    materialEstadoCells[code][estado].push(ref);
  }

  setText(ws, r, 0, 'PLANILHA MESTRE (EXPLOSÃO)');
  r += 2;

  for (const blend of blends) {
    const components = [...(blend.components || [])].sort((a, b) => a.ordem - b.ordem);
    if (!components.length) continue;

    setText(ws, r, 0, blend.nome);
    r += 1;

    const headerRow = r;
    setText(ws, headerRow, 0, 'ESTADO');
    setText(ws, headerRow, 1, 'QUANTIDADE');
    components.forEach((comp, idx) => {
      const mat = materialByCode.get(comp.rawMaterialCode);
      setText(ws, headerRow, 2 + idx, mat ? `${mat.nome} (${comp.rawMaterialCode})` : comp.rawMaterialCode);
    });
    maxCol = Math.max(maxCol, 2 + components.length - 1);
    r += 1;

    const stateFirstRow = r;
    const qtyByEstado = blend.estados || {};
    ESTADOS.forEach((estado) => {
      setText(ws, r, 0, estado);
      const qtyAddr = cellRef(r, 1);
      const total = Number(qtyByEstado[estado]) || 0;
      if (total) setNum(ws, r, 1, total, INT_FMT);

      // Mesma regra de server/calc.js (computeRawMaterialSummary): um
      // componente sem percentual OU o último da lista fica com o que sobrar
      // até aquele ponto (não necessariamente o total). "remainingTerms"
      // acumula, em ordem, a célula de cada componente já processado — igual
      // ao "remaining -= qty" do JS, só que como cadeia de subtração; e
      // "remaining" (número) segue em paralelo pra virar o valor em cache.
      const remainingTerms = [qtyAddr];
      let remaining = total;
      components.forEach((comp, idx) => {
        const isLast = idx === components.length - 1;
        const col = 2 + idx;
        const addr = cellRef(r, col);
        let qty;
        if (comp.percentual == null || isLast) {
          qty = remaining;
          setFormula(ws, r, col, remainingTerms.join('-'), qty, NUM_FMT);
        } else {
          const pct = Math.round((Number(comp.percentual) || 0) * 1e6) / 1e6;
          qty = total * pct;
          setFormula(ws, r, col, `${qtyAddr}*${pct}`, qty, NUM_FMT);
        }
        remaining -= qty;
        remainingTerms.push(addr);
        // Referência com o nome da aba: essas células serão somadas a partir
        // de PLANILHA MESTRE, uma aba diferente — sem o prefixo "EXPLOSÃO!" a
        // fórmula lá acabaria apontando pra própria célula dela mesma.
        addRef(comp.rawMaterialCode, estado, `EXPLOSÃO!${addr}`);
      });
      r += 1;
    });
    const stateLastRow = r - 1;

    setText(ws, r, 0, 'TOTAL');
    const totalQty = ESTADOS.reduce((sum, e) => sum + (Number(qtyByEstado[e]) || 0), 0);
    setFormula(ws, r, 1, `SUM(B${stateFirstRow + 1}:B${stateLastRow + 1})`, totalQty, INT_FMT);
    components.forEach((comp, idx) => {
      const col = 2 + idx;
      const colLetter = XLSX.utils.encode_col(col);
      // Soma dos valores em cache das linhas de estado dessa coluna — mesmo
      // total que a fórmula SUM vai recalcular.
      let colTotal = 0;
      for (let rr = stateFirstRow; rr <= stateLastRow; rr++) {
        const cell = ws[cellRef(rr, col)];
        if (cell) colTotal += Number(cell.v) || 0;
      }
      setFormula(ws, r, col, `SUM(${colLetter}${stateFirstRow + 1}:${colLetter}${stateLastRow + 1})`, colTotal, NUM_FMT);
    });
    r += 2;
  }

  const maxRow = Math.max(r - 1, 0);
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }];
  return { ws, materialEstadoCells };
}

// Réplica da grade de estrutura de componentes (BOM) + a tabela de resumo de
// matéria-prima ("linha 125" da planilha original). Os valores em cache de
// QUANTIDADE/estados/TOTAL vêm de computeRawMaterialSummary — a mesma função
// de server/calc.js usada pela tela "Matéria-Prima Produzida" — enquanto a
// fórmula (SUMPRODUCT / SUM de células da EXPLOSÃO) é o que fica visível e
// recalculável para quem abrir o arquivo.
function buildPlanilhaMestre({ products, productMaterials, productStock, rawMaterials, virginStock, blends, materialEstadoCells }) {
  const ws = {};
  let r = 0;
  let maxCol = 2;

  setText(ws, r, 0, 'PLANILHA MESTRE — INVENTÁRIO BARELLA');
  r += 2;
  setText(ws, r, 0, 'ESTRUTURA DE COMPONENTES (BOM)');
  r += 1;

  const bomByProduct = new Map();
  for (const pm of productMaterials) {
    if (!bomByProduct.has(pm.productCode)) bomByProduct.set(pm.productCode, new Map());
    bomByProduct.get(pm.productCode).set(pm.rawMaterialCode, pm.consumoUnitario);
  }
  const bomMaterialCodes = [...new Set(productMaterials.map((pm) => pm.rawMaterialCode))].sort();
  const materialByCode = new Map(rawMaterials.map((m) => [m.code, m]));
  const materialColIndex = new Map(bomMaterialCodes.map((code, idx) => [code, 3 + idx]));

  const headerRow = r;
  setText(ws, headerRow, 0, 'CÓDIGO');
  setText(ws, headerRow, 1, 'PRODUTO');
  setText(ws, headerRow, 2, 'QUANTIDADE');
  bomMaterialCodes.forEach((code, idx) => {
    const mat = materialByCode.get(code);
    setText(ws, headerRow, 3 + idx, mat ? `${mat.nome} (${code})` : code);
  });
  maxCol = Math.max(maxCol, 3 + bomMaterialCodes.length - 1);
  r += 1;

  const stockByProduct = new Map(productStock.map((p) => [p.productCode, p.quantidade]));
  const productFirstRow = r;
  for (const p of products) {
    setText(ws, r, 0, p.code);
    setText(ws, r, 1, p.nome);
    const qty = stockByProduct.get(p.code);
    if (qty) setNum(ws, r, 2, qty, INT_FMT);
    const bom = bomByProduct.get(p.code);
    if (bom) {
      for (const [matCode, consumo] of bom) {
        const col = materialColIndex.get(matCode);
        setNum(ws, r, col, consumo, NUM_FMT);
      }
    }
    r += 1;
  }
  const productLastRow = r - 1;
  r += 1;

  const summaryHeaderRow = r;
  const summaryHeaders = ['CÓDIGO', 'PRODUTO', 'QUANTIDADE', 'QUANT. VIRGEM', ...ESTADOS, 'TOTAL', 'UND'];
  summaryHeaders.forEach((h, idx) => setText(ws, summaryHeaderRow, idx, h));
  maxCol = Math.max(maxCol, summaryHeaders.length - 1);
  r += 1;

  const virginByMaterial = new Map(virginStock.map((v) => [v.rawMaterialCode, v.quantidade]));
  const summaryByCode = new Map(
    computeRawMaterialSummary({ rawMaterials, productMaterials, productStock, virginStock, blends }).map((row) => [row.code, row])
  );
  const materialSummaryRow = new Map();
  const totalCol = 4 + ESTADOS.length;

  for (const m of rawMaterials) {
    const cached = summaryByCode.get(m.code) || { quantidade: 0, total: 0 };
    setText(ws, r, 0, m.code);
    setText(ws, r, 1, m.nome);

    const bomCol = materialColIndex.get(m.code);
    if (bomCol !== undefined && productLastRow >= productFirstRow) {
      const matColLetter = XLSX.utils.encode_col(bomCol);
      setFormula(
        ws,
        r,
        2,
        `SUMPRODUCT($C$${productFirstRow + 1}:$C$${productLastRow + 1},${matColLetter}$${productFirstRow + 1}:${matColLetter}$${productLastRow + 1})`,
        cached.quantidade,
        NUM_FMT
      );
    } else {
      setNum(ws, r, 2, 0);
    }

    setNum(ws, r, 3, virginByMaterial.get(m.code) || 0, INT_FMT);

    ESTADOS.forEach((estado, idx) => {
      const col = 4 + idx;
      const refs = (materialEstadoCells[m.code] && materialEstadoCells[m.code][estado]) || [];
      if (refs.length) {
        setFormula(ws, r, col, `SUM(${refs.join(',')})`, cached[estado] || 0, NUM_FMT);
      } else {
        setNum(ws, r, col, 0);
      }
    });

    const startLetter = 'C';
    const endLetter = XLSX.utils.encode_col(totalCol - 1);
    setFormula(ws, r, totalCol, `SUM(${startLetter}${r + 1}:${endLetter}${r + 1})`, cached.total, NUM_FMT);
    setText(ws, r, totalCol + 1, m.unidade);

    materialSummaryRow.set(m.code, r);
    r += 1;
  }
  maxCol = Math.max(maxCol, totalCol + 1);
  const maxRow = r - 1;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
  ws['!cols'] = [{ wch: 14 }, { wch: 34 }];
  return { ws, materialSummaryRow, totalColLetter: XLSX.utils.encode_col(totalCol) };
}

// Réplica de Plan1: dicionário código → descrição/unidade, usado como fonte
// dos PROCV da aba Relatório de Contagem (no lugar do arquivo externo morto
// '[1]BASE DIVERGÊNCIA' da planilha original).
function buildPlan1({ rawMaterials }) {
  const ws = {};
  setText(ws, 0, 0, 'CÓDIGO');
  setText(ws, 0, 1, 'DESCRIÇÃO');
  setText(ws, 0, 2, 'UNIDADE');
  rawMaterials.forEach((m, idx) => {
    const r = idx + 1;
    setText(ws, r, 0, m.code);
    setText(ws, r, 1, m.nome);
    setText(ws, r, 2, m.unidade);
  });
  const maxRow = rawMaterials.length;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: 2 } });
  ws['!cols'] = [{ wch: 12 }, { wch: 34 }, { wch: 10 }];
  return ws;
}

// Réplica da aba RELATÓRIO DE CONTAGEM — mesmo layout/cabeçalho que o export
// atual já usava, mas C..I viram fórmula: Divergência/%/Condição recalculam
// se alguém editar Saldo do Sistema/Inventário/Notas em Trânsito no Excel,
// igual server/calc.js (computeDivergence). Os valores em cache de cada
// fórmula são os campos que `itens` já traz prontos de loadItens() — o mesmo
// número que a tela do sistema mostra agora.
function buildRelatorio({ itens, dataFormatada, plan1LastRow, masterSummaryRow, masterTotalColLetter, planilhaMestreSheetName, plan1SheetName }) {
  const ws = {};
  const headers = [
    'CÓDIGO', 'DESCRIÇÃO', 'SALDO DO SISTEMA', 'SALDO DO INVENTÁRIO', 'NOTAS EM TRÂNSITO',
    'DIVERGÊNCIA', 'UNIDADE DE REFERÊNCIA', 'DIVERGÊNCIA PORCENTAGEM - %', 'CONDIÇÃO', 'OBSERVAÇÃO',
  ];

  setText(ws, 0, 0, 'RELATÓRIO DE CONTAGEM DE INVENTÁRIO - BARELLA');
  setText(ws, 0, 7, dataFormatada);

  const headerRow = 2;
  headers.forEach((h, idx) => setText(ws, headerRow, idx, h));

  const firstDataRow = headerRow + 1;
  itens.forEach((item, idx) => {
    const r = firstDataRow + idx;
    const rn = r + 1;
    setText(ws, r, 0, item.rawMaterialCode);
    setFormula(ws, r, 1, `IFERROR(VLOOKUP(A${rn},${plan1SheetName}!$A$2:$C$${plan1LastRow},2,0),"")`, item.nome || '');
    setNum(ws, r, 2, item.saldoSistema, NUM_FMT);

    const masterRow = masterSummaryRow.get(item.rawMaterialCode);
    const physicalCount = Math.round(((Number(item.contagemFisica) || 0) + (Number(item.contagemQuantidade) || 0)) * 1e6) / 1e6;
    if (masterRow !== undefined) {
      const masterRef = `${planilhaMestreSheetName}!${masterTotalColLetter}${masterRow + 1}`;
      const formulaD = physicalCount ? `${masterRef}+${physicalCount}` : masterRef;
      setFormula(ws, r, 3, formulaD, item.saldoInventario, NUM_FMT);
    } else {
      setNum(ws, r, 3, item.saldoInventario, NUM_FMT);
    }

    setNum(ws, r, 4, item.notasTransito, NUM_FMT);
    setFormula(ws, r, 5, `D${rn}+E${rn}-C${rn}`, item.divergencia, NUM_FMT);
    setFormula(ws, r, 6, `IFERROR(VLOOKUP(A${rn},${plan1SheetName}!$A$2:$C$${plan1LastRow},3,0),"")`, item.unidade || '');
    const percentualCache = item.divergenciaPercentual == null ? '100%' : Number(item.divergenciaPercentual);
    setFormula(ws, r, 7, `IF(OR(C${rn}=0,ISBLANK(C${rn})),"100%",F${rn}/C${rn})`, percentualCache, PCT_FMT);
    setFormula(
      ws,
      r,
      8,
      `IF(C${rn}=0,"SEM REFERÊNCIA",IF(H${rn}<-2%,"VENDA",IF(H${rn}<0%,"AJUSTE DE SAÍDA",IF(H${rn}>0,"AJUSTE DE ENTRADA","SEM DIFERENÇA"))))`,
      item.condicao || ''
    );
    setText(ws, r, 9, item.observacao || '');
  });

  const lastDataRow = firstDataRow + itens.length - 1;
  const signatureRow = lastDataRow + 2;
  setText(ws, signatureRow, 1, 'MONDIAL - GESTÃO DE TERCEIROS');
  setText(ws, signatureRow, 5, 'COORD. ADMINISTRATIVO FORNECEDOR');

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: signatureRow, c: 5 }, e: { r: signatureRow, c: 9 } },
  ];
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: signatureRow, c: 9 } });
  ws['!cols'] = [
    { wch: 12 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 24 },
  ];
  return ws;
}

function buildContagemWorkbook({ dataFormatada, itens, rawMaterials, products, productMaterials, productStock, virginStock, blends }) {
  const materialByCode = new Map(rawMaterials.map((m) => [m.code, m]));
  const { ws: explosaoWs, materialEstadoCells } = buildExplosao({ blends, materialByCode });
  const { ws: mestreWs, materialSummaryRow, totalColLetter } = buildPlanilhaMestre({
    products, productMaterials, productStock, rawMaterials, virginStock, blends, materialEstadoCells,
  });
  const plan1Ws = buildPlan1({ rawMaterials });
  const plan1LastRow = rawMaterials.length + 1;

  const relatorioWs = buildRelatorio({
    itens,
    dataFormatada,
    plan1LastRow,
    masterSummaryRow: materialSummaryRow,
    masterTotalColLetter: totalColLetter,
    planilhaMestreSheetName: 'PLANILHA MESTRE',
    plan1SheetName: 'Plan1',
  });

  const wb = XLSX.utils.book_new();
  // Toda célula de fórmula já carrega o valor calculado (ver setFormula) —
  // isso só garante que o Excel refaça a conta sozinho se algo for editado.
  wb.Workbook = { CalcPr: { fullCalcOnLoad: true } };
  XLSX.utils.book_append_sheet(wb, mestreWs, 'PLANILHA MESTRE');
  XLSX.utils.book_append_sheet(wb, explosaoWs, 'EXPLOSÃO');
  XLSX.utils.book_append_sheet(wb, relatorioWs, 'RELATÓRIO DE CONTAGEM');
  XLSX.utils.book_append_sheet(wb, plan1Ws, 'Plan1');
  return wb;
}

module.exports = { buildContagemWorkbook };
