// Importa o catálogo (matéria-prima + produto + receita) da Colormaq a
// partir da planilha de referência (COLORMAQ.xlsx: uma aba por data de
// contagem). Usa sempre a última aba (data mais recente) como catálogo
// atual — confirmado com o cliente que só o cadastro de hoje importa, não o
// histórico das contagens já feitas (ver server/db.js e a conversa que
// definiu esse escopo).
//
// Uso: node server/colormaq-import-from-xlsx.js [caminho-do-arquivo]
// Sem DATABASE_URL: só mostra o que seria importado (dry run). Com
// DATABASE_URL: grava no banco.
//
// Convenção da planilha (ver reconhecimento manual, célula a célula, feito
// antes de escrever este parser):
//   - Cada linha com valor na coluna B é um produto: "<nome> <código>" (os
//     últimos 6+ dígitos são o código; produtos sem código embutido ficam
//     com um código sintético, avisado no relatório).
//   - Coluna C = matéria-prima resina ("<nome> <código>"), coluna G = seu
//     consumo unitário. Coluna I = matéria-prima masterbatch, coluna M = seu
//     consumo unitário. Uma linha "par" (ex: lado esquerdo/direito da mesma
//     peça) pode não repetir C/I — nesse caso herda a última matéria-prima
//     vista (mesmo material, consumo unitário próprio).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const XLSX = require('xlsx');

function splitNomeCodigo(raw) {
  if (!raw) return { nome: '', codigo: null };
  const s = String(raw).trim().replace(/\s+/g, ' ');
  const m = s.match(/^(.*?)\s*(\d{6,})$/);
  if (m) return { nome: m[1].trim(), codigo: m[2] };
  return { nome: s, codigo: null };
}

function parseWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellFormula: false });
  const sheetNames = wb.SheetNames.filter((n) => n.toLowerCase() !== 'planilha2');
  const latestSheetName = sheetNames[sheetNames.length - 1];
  const ws = wb.Sheets[latestSheetName];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const v = (r, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    return cell ? cell.v : undefined;
  };

  const rawMaterials = new Map(); // codigo -> {codigo, nome, tipo}
  const products = new Map(); // codigo -> {codigo, nome}
  const productMaterials = []; // {productCode, rawMaterialCode, consumoUnitario}
  const warnings = [];
  let syntheticCount = 0;

  let lastResina = null; // {codigo, nome}
  let lastMasterbatch = null;

  for (let r = 0; r <= range.e.r; r++) {
    const bRaw = v(r, 1); // B
    if (!bRaw) continue;

    const { nome: nomeResinaRaw, codigo: codResina } = splitNomeCodigo(v(r, 2)); // C
    const { nome: nomeMasterRaw, codigo: codMaster } = splitNomeCodigo(v(r, 8)); // I
    if (codResina) {
      lastResina = { codigo: codResina, nome: nomeResinaRaw };
      if (!rawMaterials.has(codResina)) rawMaterials.set(codResina, { codigo: codResina, nome: nomeResinaRaw, tipo: 'RESINA' });
    }
    if (codMaster) {
      lastMasterbatch = { codigo: codMaster, nome: nomeMasterRaw };
      if (!rawMaterials.has(codMaster)) rawMaterials.set(codMaster, { codigo: codMaster, nome: nomeMasterRaw, tipo: 'MASTERBATCH' });
    }

    let { nome: nomeProduto, codigo: codProduto } = splitNomeCodigo(bRaw);
    if (!codProduto) {
      syntheticCount += 1;
      codProduto = `AUTO-${syntheticCount}`;
      warnings.push(`Linha ${r + 1}: produto "${nomeProduto}" não tem código na planilha — gerado código temporário ${codProduto}. Confira/edite no cadastro.`);
    }
    if (products.has(codProduto)) {
      warnings.push(`Linha ${r + 1}: código de produto ${codProduto} já usado por outra linha ("${products.get(codProduto).nome}") — verifique duplicidade.`);
    }
    products.set(codProduto, { codigo: codProduto, nome: nomeProduto });

    const g = v(r, 6); // G — consumo unitário resina
    const m = v(r, 12); // M — consumo unitário masterbatch
    if (lastResina && typeof g === 'number') {
      productMaterials.push({ productCode: codProduto, rawMaterialCode: lastResina.codigo, consumoUnitario: g });
    }
    if (lastMasterbatch && typeof m === 'number') {
      productMaterials.push({ productCode: codProduto, rawMaterialCode: lastMasterbatch.codigo, consumoUnitario: m });
    }
    if (!lastResina && !lastMasterbatch) {
      warnings.push(`Linha ${r + 1}: produto "${nomeProduto}" (${codProduto}) sem nenhuma matéria-prima identificada até esse ponto da planilha — receita ficará vazia, cadastre manualmente.`);
    }
  }

  return {
    sheetUsada: latestSheetName,
    rawMaterials: Array.from(rawMaterials.values()),
    products: Array.from(products.values()),
    productMaterials,
    warnings,
  };
}

async function writeToDb(parsed) {
  const db = require('./db');
  await db.ready;
  await db.withTransaction(async (client) => {
    for (const m of parsed.rawMaterials) {
      await client.query(
        `INSERT INTO colormaq_raw_materials (code, nome, unidade, tipo) VALUES ($1, $2, 'KG', $3)
         ON CONFLICT (code) DO UPDATE SET nome = $2, tipo = $3`,
        [m.codigo, m.nome, m.tipo]
      );
    }
    for (const p of parsed.products) {
      await client.query(
        `INSERT INTO colormaq_products (code, nome) VALUES ($1, $2) ON CONFLICT (code) DO UPDATE SET nome = $2`,
        [p.codigo, p.nome]
      );
    }
    for (const code of new Set(parsed.productMaterials.map((pm) => pm.productCode))) {
      await client.query('DELETE FROM colormaq_product_materials WHERE product_code = $1', [code]);
    }
    for (const pm of parsed.productMaterials) {
      await client.query(
        `INSERT INTO colormaq_product_materials (id, product_code, raw_material_code, consumo_unitario) VALUES ($1, $2, $3, $4)`,
        [crypto.randomUUID(), pm.productCode, pm.rawMaterialCode, pm.consumoUnitario]
      );
    }

    // Deriva os blends (dupla resina+masterbatch) — mesma lógica de
    // server/routes/colormaqProducts.js, syncBlend, aplicada em lote aqui
    // pra já sair com os blends prontos assim que a importação terminar.
    const byProduct = new Map();
    for (const pm of parsed.productMaterials) {
      if (!byProduct.has(pm.productCode)) byProduct.set(pm.productCode, []);
      byProduct.get(pm.productCode).push(pm.rawMaterialCode);
    }
    const tipoByCode = new Map(parsed.rawMaterials.map((m) => [m.codigo, m.tipo]));
    const nomeByCode = new Map(parsed.rawMaterials.map((m) => [m.codigo, m.nome]));
    const pares = new Set();
    for (const codes of byProduct.values()) {
      const resina = codes.find((c) => tipoByCode.get(c) === 'RESINA');
      const masterbatch = codes.find((c) => tipoByCode.get(c) === 'MASTERBATCH');
      if (resina && masterbatch) pares.add(`${resina}|${masterbatch}`);
    }
    for (const par of pares) {
      const [resinaCode, masterbatchCode] = par.split('|');
      const { rows: existing } = await client.query(
        `SELECT b.id FROM colormaq_blends b
         JOIN colormaq_blend_components r ON r.blend_id = b.id AND r.papel = 'RESINA' AND r.raw_material_code = $1
         JOIN colormaq_blend_components m ON m.blend_id = b.id AND m.papel = 'MASTERBATCH' AND m.raw_material_code = $2`,
        [resinaCode, masterbatchCode]
      );
      if (existing.length) continue;
      const blendId = crypto.randomUUID();
      await client.query('INSERT INTO colormaq_blends (id, nome) VALUES ($1, $2)', [
        blendId,
        `${nomeByCode.get(resinaCode) || resinaCode} + ${nomeByCode.get(masterbatchCode) || masterbatchCode}`,
      ]);
      await client.query(
        `INSERT INTO colormaq_blend_components (id, blend_id, raw_material_code, papel) VALUES ($1, $2, $3, 'RESINA'), ($4, $2, $5, 'MASTERBATCH')`,
        [crypto.randomUUID(), blendId, resinaCode, crypto.randomUUID(), masterbatchCode]
      );
    }
  });
}

async function main() {
  const filePath = process.argv[2] || path.join(__dirname, '..', 'COLORMAQ.xlsx');
  if (!fs.existsSync(filePath)) {
    console.error('Arquivo não encontrado:', filePath);
    process.exit(1);
  }
  const parsed = parseWorkbook(filePath);
  console.log(`Aba usada como catálogo atual: "${parsed.sheetUsada}"`);
  console.log(`Matérias-primas: ${parsed.rawMaterials.length}`);
  parsed.rawMaterials.forEach((m) => console.log(`  ${m.codigo} — ${m.nome} (${m.tipo})`));
  console.log(`Produtos: ${parsed.products.length}`);
  parsed.products.forEach((p) => console.log(`  ${p.codigo} — ${p.nome}`));
  console.log(`Itens de receita (produto x matéria-prima): ${parsed.productMaterials.length}`);
  if (parsed.warnings.length) {
    console.log(`\nAvisos (${parsed.warnings.length}):`);
    parsed.warnings.forEach((w) => console.log('  - ' + w));
  }

  if (!process.env.DATABASE_URL) {
    console.log('\nDATABASE_URL não definida — nada foi gravado (dry run). Defina a variável e rode de novo para gravar.');
    return;
  }
  await writeToDb(parsed);
  console.log('\nDados gravados no banco.');
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Falha na importação:', err);
    process.exit(1);
  });
}

module.exports = { parseWorkbook };
