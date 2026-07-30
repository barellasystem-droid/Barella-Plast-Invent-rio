// Lê a planilha original (INVENTÁRIO Ba.xlsx) e monta as estruturas para
// popular o banco na primeira vez: matérias-primas, produtos, BOM (consumo
// por unidade), misturas da Explosão (com percentuais) e estoque virgem.
//
// A parte mais delicada é mapear cada coluna da aba EXPLOSÃO para o código de
// matéria-prima correto. Em vez de tentar adivinhar pelo nome da coluna
// (pouco confiável — nomes livres, abreviados, repetidos), usamos como fonte
// da verdade as próprias fórmulas de soma da 'PLANILHA MESTRE' linha 125+
// (ex: E126 = EXPLOSÃO!D5+EXPLOSÃO!I5+...) — elas já dizem, célula por
// célula, a qual matéria-prima e a qual estado cada célula da Explosão
// pertence. Ver validateAgainstSheet() no final, que confere o total
// recalculado contra o valor já salvo na própria planilha antes de
// confiarmos no resultado.
//
// A tabela da linha 125+ não é a lista completa de matérias-primas — ela só
// cobre os itens que passam por Explosão (plástico/mistura). Itens simples
// (parafuso, etiqueta, etc.) só aparecem no BOM dos produtos e, às vezes, na
// aba "Plan1" (um extrato tipo SAP: código, descrição, saldo). Por isso o
// índice de matérias-primas final é a união dessas fontes, mais qualquer
// código novo encontrado só no cabeçalho da Planilha Mestre ou nos
// subcabeçalhos da Explosão.
const path = require('path');
const XLSX = require('xlsx');
const { ESTADOS_PLANILHA } = require('./constants');
const { computeRawMaterialSummary } = require('./calc');

const CODE_RE = /\d{3,4}-\d{2,3}[A-Za-z]{0,3}/;

function colLetter(c) {
  return XLSX.utils.encode_col(c);
}
function cellAddr(r, c) {
  return XLSX.utils.encode_cell({ r, c });
}
function normalizeText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .trim();
}
function slugCode(s) {
  return 'AUTO-' + normalizeText(s).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30).toUpperCase();
}

function readSheet(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Aba "${name}" não encontrada no arquivo.`);
  return ws;
}
function cellValue(ws, r, c) {
  const cd = ws[cellAddr(r, c)];
  return cd ? cd.v : undefined;
}
function cellFormula(ws, r, c) {
  const cd = ws[cellAddr(r, c)];
  return cd ? cd.f : undefined;
}

// ---- Índice de matérias-primas: começa pela tabela da linha 125+ da
// Planilha Mestre (tem unidade), completa com a aba Plan1 (tem mais códigos,
// sem unidade), e aceita novos códigos/sintéticos sob demanda via resolve(). ----
function buildMaterialIndex(mestreWs, plan1Ws) {
  const byCode = new Map(); // code -> {code, nome, unidade, row?}
  const byNormalizedName = new Map(); // normalized nome -> code

  function add(code, nome, unidade) {
    code = String(code).trim();
    if (!code) return;
    if (!byCode.has(code)) {
      byCode.set(code, { code, nome: String(nome || code).trim(), unidade: unidade || null });
    } else if (unidade && !byCode.get(code).unidade) {
      byCode.get(code).unidade = unidade;
    }
    const n = normalizeText(nome);
    if (n && !byNormalizedName.has(n)) byNormalizedName.set(n, code);
  }

  // 1) tabela linha 125+ (autoritativa para unidade)
  const range = XLSX.utils.decode_range(mestreWs['!ref']);
  let lowerHeaderRow = -1;
  for (let r = 0; r <= range.e.r; r++) {
    if (
      normalizeText(cellValue(mestreWs, r, 0)) === 'codigo' &&
      normalizeText(cellValue(mestreWs, r, 1)) === 'produto' &&
      normalizeText(cellValue(mestreWs, r, 2)) === 'quantidade'
    ) {
      lowerHeaderRow = r;
      break;
    }
  }
  if (lowerHeaderRow === -1) throw new Error('Não encontrei o cabeçalho da tabela de matéria-prima (linha 125+).');
  const lowerRowByCode = new Map();
  for (let r = lowerHeaderRow + 1; r <= range.e.r; r++) {
    const code = cellValue(mestreWs, r, 0);
    if (!code || !String(code).trim()) continue;
    const nome = cellValue(mestreWs, r, 1);
    const unidade = String(cellValue(mestreWs, r, 15) || 'KG').trim().toUpperCase();
    add(code, nome, unidade);
    lowerRowByCode.set(String(code).trim(), r);
  }

  // 2) Plan1 (extrato tipo SAP: Material, Texto breve material, Utilização livre)
  if (plan1Ws) {
    const range1 = XLSX.utils.decode_range(plan1Ws['!ref']);
    for (let r = 1; r <= range1.e.r; r++) {
      const code = cellValue(plan1Ws, r, 0);
      if (!code || !String(code).trim()) continue;
      add(code, cellValue(plan1Ws, r, 1), null);
    }
  }

  function resolveByCodeOrName(text) {
    const m = String(text || '').match(CODE_RE);
    if (m) {
      const code = m[0];
      if (!byCode.has(code)) {
        const nome = String(text).replace(code, '').replace(/[\-–—]+/g, ' ').replace(/\s+/g, ' ').trim() || code;
        add(code, nome, null);
      }
      return { code, matched: 'codigo' };
    }
    const norm = normalizeText(text);
    if (norm) {
      if (byNormalizedName.has(norm)) return { code: byNormalizedName.get(norm), matched: 'nome-exato' };
      for (const [name, code] of byNormalizedName) {
        if (name.length > 3 && (name.includes(norm) || norm.includes(name))) {
          return { code, matched: 'nome-parcial' };
        }
      }
    }
    const synthetic = slugCode(text || 'sem-nome');
    add(synthetic, text, null);
    return { code: synthetic, matched: 'sintetico' };
  }

  return { byCode, lowerHeaderRow, lowerRowByCode, resolveByCodeOrName };
}

// ---- Produtos + BOM: tabela das linhas 5-124 (acima da tabela de matéria-prima) ----
function parseProductsAndBom(ws, materialIndex) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  let headerRow = -1;
  for (let r = 0; r <= 10; r++) {
    if (normalizeText(cellValue(ws, r, 0)) === 'codigo' && normalizeText(cellValue(ws, r, 1)) === 'produto') {
      headerRow = r;
      break;
    }
  }
  if (headerRow === -1) throw new Error('Não encontrei o cabeçalho da tabela de produtos.');

  let lastCol = 3;
  for (let c = 3; c < 500; c++) {
    const h = cellValue(ws, headerRow, c);
    if (h === undefined || h === null || String(h).trim() === '') break;
    lastCol = c;
  }

  const colToCode = {};
  const resolutionNotes = [];
  for (let c = 3; c <= lastCol; c++) {
    const header = String(cellValue(ws, headerRow, c) || '');
    const { code, matched } = materialIndex.resolveByCodeOrName(header);
    colToCode[c] = code;
    if (matched !== 'codigo') resolutionNotes.push(`Coluna ${colLetter(c)} da Planilha Mestre ("${header}") -> ${code} (via ${matched}).`);
  }

  let lastProductRow = headerRow;
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    if (
      normalizeText(cellValue(ws, r, 0)) === 'codigo' &&
      normalizeText(cellValue(ws, r, 1)) === 'produto' &&
      normalizeText(cellValue(ws, r, 2)) === 'quantidade'
    ) break;
    lastProductRow = r;
  }

  const products = [];
  const productStock = [];
  const productMaterials = [];
  for (let r = headerRow + 1; r <= lastProductRow; r++) {
    const code = cellValue(ws, r, 0);
    const nome = cellValue(ws, r, 1);
    if (!code || !String(code).trim()) continue;
    const productCode = String(code).trim();
    products.push({ code: productCode, nome: String(nome || productCode).trim() });
    const estoque = Number(cellValue(ws, r, 2)) || 0;
    if (estoque) productStock.push({ productCode, quantidade: estoque });
    for (const [c, materialCode] of Object.entries(colToCode)) {
      const consumo = Number(cellValue(ws, r, Number(c)));
      if (consumo) productMaterials.push({ productCode, rawMaterialCode: materialCode, consumoUnitario: consumo });
    }
  }

  return { products, productStock, productMaterials, resolutionNotes };
}

// ---- Estoque virgem: coluna D da tabela de matéria-prima (linha 125+) ----
function parseVirginStock(ws, materialIndex) {
  const virginStock = [];
  for (const [code, row] of materialIndex.lowerRowByCode) {
    const v = Number(cellValue(ws, row, 3)); // coluna D
    if (v) virginStock.push({ rawMaterialCode: code, quantidade: v });
  }
  return virginStock;
}

// ---- Mapa "verdade": célula da Explosão -> {code, estado}, a partir das
// próprias fórmulas de soma da tabela de matéria-prima (linha 125+) ----
function parseExplosaoCellMap(ws, materialIndex) {
  const cellMap = {};
  const lowerCols = { BORRA: 4, MISTURA: 5, GALHO: 6, VARREDURA: 9, MOIDO: 11, SUCATA: 12, MAQUINA: 13 }; // E,F,G,J,L,M,N
  for (const [code, row] of materialIndex.lowerRowByCode) {
    for (const [estado, col] of Object.entries(lowerCols)) {
      const f = cellFormula(ws, row, col);
      if (!f) continue;
      const refs = f.match(/EXPLOSÃO!([A-Z]+\d+)/g) || [];
      for (const ref of refs) {
        cellMap[ref.replace('EXPLOSÃO!', '')] = { code, estado };
      }
    }
  }
  return cellMap;
}

// ---- Blocos da aba EXPLOSÃO: cada "ESTADO" encontrado marca o topo de um bloco ----
function parseBlends(ws, explosaoCellMap, materialIndex) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const anchors = [];
  for (let r = 0; r <= range.e.r; r++) {
    for (let c = 0; c <= range.e.c; c++) {
      if (normalizeText(cellValue(ws, r, c)) === 'estado') anchors.push({ row: r, col: c });
    }
  }

  const warnings = [];
  const blends = [];

  for (const anchor of anchors) {
    const { row: headerRow, col: estadoCol } = anchor;
    const qtyCol = estadoCol + 1;

    const sameRow = anchors.filter((a) => a.row === headerRow && a.col > estadoCol).sort((a, b) => a.col - b.col);
    const rightLimit = sameRow.length ? sameRow[0].col : Math.min(estadoCol + 8, range.e.c + 1);

    // só considera coluna como componente real se tiver texto no subcabeçalho
    // (colunas vazias entre um bloco e o próximo são só espaçamento).
    const componentCols = [];
    for (let c = qtyCol + 1; c < rightLimit; c++) {
      const label = cellValue(ws, headerRow, c);
      if (label !== undefined && label !== null && String(label).trim() !== '') componentCols.push(c);
    }
    if (!componentCols.length) continue;

    const stateRows = {};
    let mismatch = false;
    for (let i = 0; i < ESTADOS_PLANILHA.length; i++) {
      const r = headerRow + 1 + i;
      const label = normalizeText(cellValue(ws, r, estadoCol)).replace(/í/g, 'i').replace(/á/g, 'a');
      const expected = ESTADOS_PLANILHA[i].toLowerCase();
      if (label && label !== expected) { mismatch = true; break; }
      stateRows[ESTADOS_PLANILHA[i]] = r;
    }
    if (mismatch) continue;

    const titulo = String(cellValue(ws, headerRow - 1, estadoCol) || cellValue(ws, headerRow - 1, estadoCol - 1) || `Mistura ${blends.length + 1}`).trim();

    const components = [];
    for (const c of componentCols) {
      let code = null;
      for (const estado of ESTADOS_PLANILHA) {
        const addr = cellAddr(stateRows[estado], c);
        if (explosaoCellMap[addr]) { code = explosaoCellMap[addr].code; break; }
      }
      let matched = 'verdade';
      if (!code) {
        const label = cellValue(ws, headerRow, c);
        const resolved = materialIndex.resolveByCodeOrName(label);
        code = resolved.code;
        matched = resolved.matched;
        warnings.push(`Bloco "${titulo}" (${cellAddr(headerRow, estadoCol)}), coluna ${colLetter(c)} ("${label}"): matéria-prima não confirmada pelas fórmulas da Planilha Mestre — resolvida por ${matched} para ${code}. Confira.`);
      }

      let percentual = null;
      for (const estado of ESTADOS_PLANILHA) {
        const f = cellFormula(ws, stateRows[estado], c);
        if (!f) continue;
        const m = f.match(/^[A-Z]+\d+\*([\d.]+)%$/);
        if (m) { percentual = Number(m[1]) / 100; break; }
      }
      components.push({ rawMaterialCode: code, percentual });
    }
    if (!components.length) continue;

    if (!components.some((c) => c.percentual == null)) {
      components[components.length - 1].percentual = null;
    }
    components.sort((a, b) => (a.percentual == null ? 1 : 0) - (b.percentual == null ? 1 : 0));

    const estados = {};
    for (const estado of ESTADOS_PLANILHA) {
      const v = Number(cellValue(ws, stateRows[estado], qtyCol));
      if (v) estados[estado] = v;
    }

    blends.push({ nome: titulo, components, estados });
  }

  return { blends, warnings };
}

function parseWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellFormula: true });
  const mestre = readSheet(wb, 'PLANILHA MESTRE');
  const explosao = readSheet(wb, 'EXPLOSÃO');
  const plan1 = wb.Sheets['Plan1'];

  const materialIndex = buildMaterialIndex(mestre, plan1);
  const { products, productStock, productMaterials, resolutionNotes } = parseProductsAndBom(mestre, materialIndex);
  const virginStock = parseVirginStock(mestre, materialIndex);
  const explosaoCellMap = parseExplosaoCellMap(mestre, materialIndex);
  const { blends, warnings } = parseBlends(explosao, explosaoCellMap, materialIndex);

  return {
    rawMaterials: Array.from(materialIndex.byCode.values()).map((m) => ({ ...m, unidade: m.unidade || 'KG' })),
    products,
    productStock,
    productMaterials,
    virginStock,
    blends,
    warnings: [...warnings, ...resolutionNotes],
    lowerRowByCode: materialIndex.lowerRowByCode,
  };
}

// Confere, para cada matéria-prima QUE TEM linha na tabela linha 125+ da
// planilha original, se o Total recalculado a partir dos dados importados
// bate com o valor já salvo lá (coluna O). Itens que só existem no BOM
// (parafuso, etiqueta simples etc.) não têm Total na planilha original para
// comparar — não entram nessa checagem.
function validateAgainstSheet(filePath, data) {
  const wb = XLSX.readFile(filePath, { cellFormula: true });
  const mestre = wb.Sheets['PLANILHA MESTRE'];

  const computed = computeRawMaterialSummary({
    rawMaterials: data.rawMaterials,
    productMaterials: data.productMaterials,
    productStock: data.productStock,
    virginStock: data.virginStock,
    blends: data.blends,
  });
  const computedByCode = new Map(computed.map((c) => [c.code, c.total]));

  const diffs = [];
  for (const [code, row] of data.lowerRowByCode) {
    const expectedRaw = cellValue(mestre, row, 14); // coluna O
    if (expectedRaw === undefined || expectedRaw === null || expectedRaw === '') continue;
    const expected = Number(expectedRaw);
    const got = computedByCode.get(code) || 0;
    const diff = Math.abs(expected - got);
    const tolerancia = Math.max(0.01, Math.abs(expected) * 0.0001);
    if (diff > tolerancia) {
      const nome = data.rawMaterials.find((m) => m.code === code)?.nome || code;
      diffs.push({ code, nome, expected, got, diff });
    }
  }
  return diffs;
}

module.exports = { parseWorkbook, validateAgainstSheet };

if (require.main === module) {
  const filePath = process.argv[2] || path.join(__dirname, '..', 'INVENTÁRIO Ba.xlsx');
  console.log('Lendo', filePath);
  const data = parseWorkbook(filePath);
  console.log(`Matérias-primas: ${data.rawMaterials.length}`);
  console.log(`Produtos: ${data.products.length}`);
  console.log(`Itens de BOM (produto x matéria-prima): ${data.productMaterials.length}`);
  console.log(`Misturas (Explosão): ${data.blends.length}`);
  console.log(`Estoque virgem informado: ${data.virginStock.length}`);
  if (data.warnings.length) {
    console.log(`\nAvisos (${data.warnings.length}):`);
    data.warnings.forEach((w) => console.log(' -', w));
  }

  console.log('\nValidando totais contra a planilha original...');
  const diffs = validateAgainstSheet(filePath, data);
  if (!diffs.length) {
    console.log('OK — todos os totais recalculados batem com a planilha (dentro da tolerância).');
  } else {
    console.log(`DIVERGÊNCIAS em ${diffs.length} matéria(s)-prima(s):`);
    diffs.forEach((d) => console.log(`  ${d.code} (${d.nome}): esperado ${d.expected}, calculado ${d.got}, diff ${d.diff.toFixed(4)}`));
  }

  if (process.env.DATABASE_URL) {
    // eslint-disable-next-line global-require
    require('./import-from-xlsx-write')(data).then(() => {
      console.log('\nDados gravados no banco.');
      process.exit(0);
    }).catch((err) => {
      console.error('Falha ao gravar no banco:', err);
      process.exit(1);
    });
  } else {
    console.log('\nDATABASE_URL não definida — só validei o parser, nada foi gravado no banco.');
  }
}
