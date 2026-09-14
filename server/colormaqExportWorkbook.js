// Monta o XLSX exportado da Contagem da Colormaq — uma aba, no espírito da
// planilha de referência (COLORMAQ.xlsx: uma aba por data, com a grade de
// produto/receita, a área de mistura reciclada, e os totais por matéria-
// prima), com fórmulas de Excel de verdade, mesmo padrão de
// server/export-workbook.js (a Mondial): toda fórmula carrega também o
// valor já calculado em cache, porque uma fórmula sem valor em cache já foi
// observado sumindo/virando erro na releitura pelo SheetJS (ver histórico
// desse arquivo na Mondial).
const XLSX = require('xlsx');
const { ESTADOS_COLORMAQ } = require('./constants');
const { percentualMasterbatch } = require('./colormaqCalc');

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
function setFormula(ws, r, c, formula, cachedValue, fmt) {
  const addr = cellRef(r, c);
  const isText = typeof cachedValue === 'string';
  const cell = { t: isText ? 'str' : 'n', f: formula, v: isText ? cachedValue : Number(cachedValue) || 0 };
  if (fmt) cell.z = fmt;
  ws[addr] = cell;
  return addr;
}

function buildContagemSheet({ dataFormatada, products, productMaterials, pecasProduzidas, blends, materialByCode }) {
  const ws = {};
  let r = 0;
  let maxCol = 9;

  setText(ws, r, 0, 'COLORMAQ — CONTAGEM DE INVENTÁRIO');
  setText(ws, r, 8, dataFormatada);
  r += 2;

  const bomByProduct = new Map();
  for (const pm of productMaterials) {
    if (!bomByProduct.has(pm.productCode)) bomByProduct.set(pm.productCode, []);
    bomByProduct.get(pm.productCode).push(pm);
  }
  const pecasByProduct = new Map(pecasProduzidas.map((p) => [p.productCode, Number(p.quantidade) || 0]));

  const headerRow = r;
  ['CÓDIGO', 'PRODUTO', 'RESINA', 'CONSUMO RESINA', 'MASTERBATCH', 'CONSUMO MASTERBATCH', 'SOMA (G+M)', 'PEÇAS PRODUZIDAS', 'CONSUMO TOTAL RESINA', 'CONSUMO TOTAL MASTERBATCH'].forEach(
    (h, idx) => setText(ws, headerRow, idx, h)
  );
  r += 1;

  // Referências de célula por (produto, matéria-prima) e por matéria-prima —
  // usadas depois pra montar as fórmulas de reciclagem e do resumo final.
  const consumoCellByProductMaterial = new Map(); // "product|material" -> {addr, papel}
  const consumoCellsByMaterial = new Map(); // material -> [addr,...]

  for (const p of products) {
    const bom = bomByProduct.get(p.code) || [];
    const resina = bom.find((m) => (materialByCode.get(m.rawMaterialCode) || {}).tipo === 'RESINA');
    const masterbatch = bom.find((m) => (materialByCode.get(m.rawMaterialCode) || {}).tipo === 'MASTERBATCH');
    const pecas = pecasByProduct.get(p.code) || 0;

    setText(ws, r, 0, p.code);
    setText(ws, r, 1, p.nome);
    let dAddr;
    let fAddr;
    if (resina) {
      const mat = materialByCode.get(resina.rawMaterialCode);
      setText(ws, r, 2, mat ? `${mat.nome} (${resina.rawMaterialCode})` : resina.rawMaterialCode);
      dAddr = setNum(ws, r, 3, resina.consumoUnitario, NUM_FMT);
    }
    if (masterbatch) {
      const mat = materialByCode.get(masterbatch.rawMaterialCode);
      setText(ws, r, 4, mat ? `${mat.nome} (${masterbatch.rawMaterialCode})` : masterbatch.rawMaterialCode);
      fAddr = setNum(ws, r, 5, masterbatch.consumoUnitario, NUM_FMT);
    }
    if (dAddr || fAddr) {
      const soma = (resina ? Number(resina.consumoUnitario) || 0 : 0) + (masterbatch ? Number(masterbatch.consumoUnitario) || 0 : 0);
      setFormula(ws, r, 6, `${dAddr || 0}+${fAddr || 0}`, soma, NUM_FMT);
    }
    const hAddr = setNum(ws, r, 7, pecas, INT_FMT);
    if (resina) {
      const total = (Number(resina.consumoUnitario) || 0) * pecas;
      const addr = setFormula(ws, r, 8, `${dAddr}*${hAddr}`, total, NUM_FMT);
      consumoCellByProductMaterial.set(`${p.code}|${resina.rawMaterialCode}`, addr);
      if (!consumoCellsByMaterial.has(resina.rawMaterialCode)) consumoCellsByMaterial.set(resina.rawMaterialCode, []);
      consumoCellsByMaterial.get(resina.rawMaterialCode).push(addr);
    }
    if (masterbatch) {
      const total = (Number(masterbatch.consumoUnitario) || 0) * pecas;
      const addr = setFormula(ws, r, 9, `${fAddr}*${hAddr}`, total, NUM_FMT);
      consumoCellByProductMaterial.set(`${p.code}|${masterbatch.rawMaterialCode}`, addr);
      if (!consumoCellsByMaterial.has(masterbatch.rawMaterialCode)) consumoCellsByMaterial.set(masterbatch.rawMaterialCode, []);
      consumoCellsByMaterial.get(masterbatch.rawMaterialCode).push(addr);
    }
    r += 1;
  }
  r += 1;

  // -------------------------------------------------------------- Mistura/reciclagem
  const blendHeaderRow = r;
  ['BLEND', 'ESTADO', 'QUANTIDADE RECICLADA', '% MASTERBATCH', 'MASTERBATCH RECICLADO', 'RESINA RECICLADA'].forEach((h, idx) => setText(ws, blendHeaderRow, idx, h));
  r += 1;

  const recicladoCellsByMaterial = new Map();
  for (const blend of blends) {
    const resinaComp = blend.components.find((c) => c.papel === 'RESINA');
    const masterbatchComp = blend.components.find((c) => c.papel === 'MASTERBATCH');
    if (!resinaComp || !masterbatchComp) continue;

    // O mesmo masterbatch pode aparecer em mais de um blend (ex: usado com
    // duas resinas diferentes) — por isso não dá pra somar todas as células
    // daquela matéria-prima; só as dos produtos que usam ESSA dupla
    // resina+masterbatch específica (mesmo filtro de server/colormaqCalc.js,
    // percentualMasterbatch, pra fórmula e valor em cache baterem sempre).
    const produtosDoBlend = products.filter((p) => {
      const bom = bomByProduct.get(p.code) || [];
      const codes = bom.map((m) => m.rawMaterialCode);
      return codes.includes(resinaComp.rawMaterialCode) && codes.includes(masterbatchComp.rawMaterialCode);
    });
    const masterCellsOfBlend = produtosDoBlend
      .map((p) => consumoCellByProductMaterial.get(`${p.code}|${masterbatchComp.rawMaterialCode}`))
      .filter(Boolean);
    const resinaCellsOfBlend = produtosDoBlend
      .map((p) => consumoCellByProductMaterial.get(`${p.code}|${resinaComp.rawMaterialCode}`))
      .filter(Boolean);
    const pctCache = percentualMasterbatch({ blend, productMaterials, pecasProduzidas });
    const pctFormula = masterCellsOfBlend.length && resinaCellsOfBlend.length
      ? `SUM(${masterCellsOfBlend.join(',')})/(SUM(${masterCellsOfBlend.join(',')})+SUM(${resinaCellsOfBlend.join(',')}))`
      : String(pctCache);

    for (const estado of ESTADOS_COLORMAQ) {
      const quantidade = Number((blend.estados || {})[estado]) || 0;
      setText(ws, r, 0, blend.nome);
      setText(ws, r, 1, estado);
      const qAddr = setNum(ws, r, 2, quantidade, INT_FMT);
      const pctAddr = setFormula(ws, r, 3, pctFormula, pctCache, PCT_FMT);
      const masterAddr = setFormula(ws, r, 4, `${qAddr}*${pctAddr}`, quantidade * pctCache, NUM_FMT);
      const resinaAddr = setFormula(ws, r, 5, `${qAddr}-${masterAddr}`, quantidade - quantidade * pctCache, NUM_FMT);
      if (!recicladoCellsByMaterial.has(masterbatchComp.rawMaterialCode)) recicladoCellsByMaterial.set(masterbatchComp.rawMaterialCode, []);
      recicladoCellsByMaterial.get(masterbatchComp.rawMaterialCode).push(masterAddr);
      if (!recicladoCellsByMaterial.has(resinaComp.rawMaterialCode)) recicladoCellsByMaterial.set(resinaComp.rawMaterialCode, []);
      recicladoCellsByMaterial.get(resinaComp.rawMaterialCode).push(resinaAddr);
      r += 1;
    }
  }
  r += 1;

  // -------------------------------------------------------------- Resumo por matéria-prima
  const summaryHeaderRow = r;
  ['CÓDIGO', 'MATÉRIA-PRIMA', 'CONSUMIDO (peças)', 'RECICLADO (mistura)', 'TOTAL', 'UND'].forEach((h, idx) => setText(ws, summaryHeaderRow, idx, h));
  r += 1;

  const materialSummaryRow = new Map();
  for (const [code, mat] of materialByCode) {
    setText(ws, r, 0, code);
    setText(ws, r, 1, mat.nome);
    const consumoCells = consumoCellsByMaterial.get(code) || [];
    const consumoTotal = consumoCells.reduce((sum, addr) => sum + (Number(ws[addr].v) || 0), 0);
    if (consumoCells.length) setFormula(ws, r, 2, `SUM(${consumoCells.join(',')})`, consumoTotal, NUM_FMT);
    else setNum(ws, r, 2, 0);

    const recicladoCells = recicladoCellsByMaterial.get(code) || [];
    const recicladoTotal = recicladoCells.reduce((sum, addr) => sum + (Number(ws[addr].v) || 0), 0);
    if (recicladoCells.length) setFormula(ws, r, 3, `SUM(${recicladoCells.join(',')})`, recicladoTotal, NUM_FMT);
    else setNum(ws, r, 3, 0);

    setFormula(ws, r, 4, `C${r + 1}+D${r + 1}`, consumoTotal + recicladoTotal, NUM_FMT);
    setText(ws, r, 5, mat.unidade);
    materialSummaryRow.set(code, r);
    r += 1;
  }
  r += 1;

  const maxRow = r - 1;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(maxRow, 0), c: maxCol } });
  ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 26 }, { wch: 14 }, { wch: 26 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  return { ws, materialSummaryRow, nextRow: r };
}

function buildRelatorioSection(ws, startRow, { itens, materialSummaryRow }) {
  let r = startRow;
  setText(ws, r, 0, 'RELATÓRIO DE CONTAGEM — SALDO POR MATÉRIA-PRIMA');
  r += 1;
  const headerRow = r;
  ['CÓDIGO', 'MATÉRIA-PRIMA', 'SALDO DO SISTEMA', 'PESO CONTADO', 'PROCESSADO (peças+reciclo)', 'SALDO DO INVENTÁRIO', 'NOTAS EM TRÂNSITO', 'DIVERGÊNCIA', 'DIVERGÊNCIA %', 'CONDIÇÃO', 'OBSERVAÇÃO'].forEach(
    (h, idx) => setText(ws, headerRow, idx, h)
  );
  r += 1;

  itens.forEach((item) => {
    const rn = r + 1;
    setText(ws, r, 0, item.rawMaterialCode);
    setText(ws, r, 1, item.nome);
    setNum(ws, r, 2, item.saldoSistema, NUM_FMT);
    const pesoAddr = setNum(ws, r, 3, item.contagemFisica, NUM_FMT);
    const summaryRow = materialSummaryRow.get(item.rawMaterialCode);
    let processadoAddr;
    if (summaryRow !== undefined) {
      processadoAddr = setFormula(ws, r, 4, `E${summaryRow + 1}`, item.materiaPrimaProcessada, NUM_FMT);
    } else {
      processadoAddr = setNum(ws, r, 4, item.materiaPrimaProcessada, NUM_FMT);
    }
    setFormula(ws, r, 5, `D${rn}+E${rn}`, item.saldoInventario, NUM_FMT);
    setNum(ws, r, 6, item.notasTransito, NUM_FMT);
    setFormula(ws, r, 7, `F${rn}+G${rn}-C${rn}`, item.divergencia, NUM_FMT);
    const pctCache = item.divergenciaPercentual == null ? '100%' : Number(item.divergenciaPercentual);
    setFormula(ws, r, 8, `IF(OR(C${rn}=0,ISBLANK(C${rn})),"100%",H${rn}/C${rn})`, pctCache, PCT_FMT);
    setFormula(
      ws,
      r,
      9,
      `IF(C${rn}=0,"SEM REFERÊNCIA",IF(I${rn}<-2%,"VENDA",IF(I${rn}<0%,"AJUSTE DE SAÍDA",IF(I${rn}>0,"AJUSTE DE ENTRADA","SEM DIFERENÇA"))))`,
      item.condicao || ''
    );
    setText(ws, r, 10, item.observacao || '');
    r += 1;
  });
  ws['!cols'] = (ws['!cols'] || []).concat([{ wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 18 }]).slice(0, 11);
  return r;
}

function buildColormaqWorkbook({ dataFormatada, itens, rawMaterials, products, productMaterials, pecasProduzidas, blends }) {
  const materialByCode = new Map(rawMaterials.map((m) => [m.code, m]));
  const { ws, materialSummaryRow, nextRow } = buildContagemSheet({ dataFormatada, products, productMaterials, pecasProduzidas, blends, materialByCode });
  const lastRow = buildRelatorioSection(ws, nextRow, { itens, materialSummaryRow });

  const currentRange = XLSX.utils.decode_range(ws['!ref']);
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(currentRange.e.r, lastRow), c: Math.max(currentRange.e.c, 10) } });

  const wb = XLSX.utils.book_new();
  wb.Workbook = { CalcPr: { fullCalcOnLoad: true } };
  XLSX.utils.book_append_sheet(wb, ws, 'CONTAGEM');
  return wb;
}

module.exports = { buildColormaqWorkbook };
