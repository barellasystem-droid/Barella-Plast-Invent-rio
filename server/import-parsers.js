// Parsers de upload do "Saldo do Sistema" — best effort. XLS/XLSX tem
// estrutura tabular confiável (lida com a lib xlsx). PDF não tem exemplo real
// do fornecedor ainda, então usa uma heurística de linha de texto; por isso
// toda importação sempre retorna uma prévia (matched/pendentes) em vez de
// gravar direto, para o usuário conferir/corrigir antes de confirmar.
const XLSX = require('xlsx');

// Aceita tanto "1.234,56" (BR) quanto "1234.56" (US/planilha exportada crua).
function parseNumber(raw) {
  if (typeof raw === 'number') return raw;
  if (raw == null) return NaN;
  let s = String(raw).trim().replace(/[^\d,.\-]/g, '');
  if (!s) return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    s = s.replace(',', '.');
  }
  return Number(s);
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const HEADER_KEYWORDS = {
  code: ['codigo', 'material', 'cod'],
  descricao: ['descricao', 'texto', 'produto', 'nome'],
  saldo: ['saldo', 'utilizacao', 'quantidade', 'estoque', 'qtd'],
};

const COMBINING_MARKS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizeHeader(h) {
  return String(h || '')
    .normalize('NFD')
    .replace(COMBINING_MARKS_RE, '')
    .toLowerCase()
    .trim();
}

function findColumn(headers, keywords) {
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeader(headers[i]);
    if (keywords.some((k) => h.includes(k))) return i;
  }
  return -1;
}

// Recebe um Buffer .xls/.xlsx. Procura a primeira linha que pareça um
// cabeçalho (código/descrição/saldo) em qualquer uma das primeiras 10 linhas
// — planilhas exportadas de SAP costumam ter algumas linhas de título antes
// da tabela de verdade (ver aba "Plan1" da planilha original, que começa
// direto na linha 1, mas por segurança procuramos mesmo assim).
function parseXlsxBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  let headerRowIndex = -1;
  let cols = null;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const codeCol = findColumn(rows[i], HEADER_KEYWORDS.code);
    const saldoCol = findColumn(rows[i], HEADER_KEYWORDS.saldo);
    if (codeCol !== -1 && saldoCol !== -1) {
      headerRowIndex = i;
      cols = { code: codeCol, descricao: findColumn(rows[i], HEADER_KEYWORDS.descricao), saldo: saldoCol };
      break;
    }
  }
  // Sem cabeçalho reconhecível: assume o layout padrão (código, descrição, saldo).
  if (headerRowIndex === -1) {
    cols = { code: 0, descricao: 1, saldo: 2 };
    headerRowIndex = 0;
  }

  const out = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const code = row[cols.code];
    if (!code || !String(code).trim()) continue;
    const saldo = parseNumber(row[cols.saldo]);
    if (Number.isNaN(saldo)) continue;
    out.push({
      code: String(code).trim(),
      descricao: cols.descricao !== -1 ? String(row[cols.descricao] || '').trim() : '',
      saldo,
    });
  }
  return out;
}

// Heurística por linha: código (token alfanumérico com traço/ponto) + texto +
// número no final. Marcamos o resultado como "baixa confiança" pro frontend
// avisar o usuário a revisar linha a linha antes de confirmar.
function parsePdfText(text) {
  const lines = text.split('\n');
  const out = [];
  const re = /^\s*([A-Za-z0-9][A-Za-z0-9\-\.\/]{2,20})\s+(.+?)\s+([\d.,]+)\s*$/;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const saldo = parseNumber(m[3]);
    if (Number.isNaN(saldo)) continue;
    out.push({ code: m[1].trim(), descricao: m[2].trim(), saldo });
  }
  return out;
}

async function parsePdfBuffer(buffer) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return parsePdfText(data.text);
}

module.exports = { parseNumber, normalizeCode, parseXlsxBuffer, parsePdfBuffer, parsePdfText };
