import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

function toNum(s) {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[\s*]/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

// Extract lines from PDF, splitting each line into left text and rightmost column (price)
async function extractLines(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    // Price (СТОИМ) column starts at ~75% of page width in standard Audatex layout
    // (verified: prices at X≈472-488 on 612pt page, threshold 459 correctly separates them)
    const priceX = vp.width * 0.75;
    const content = await page.getTextContent();

    const byY = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ str: item.str, x: item.transform[4] });
    }

    const ys = [...byY.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const items = byY.get(y).sort((a, b) => a.x - b.x);
      const left = items.filter(i => i.x < priceX).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      const right = items.filter(i => i.x >= priceX).map(i => i.str).join('').replace(/\s/g, '').trim();
      const full = items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (full) lines.push({ full, left, right });
    }
  }
  return lines;
}

// Detect Audatex section from a cleaned (no-whitespace) line
function detectSection(clean) {
  if (clean.startsWith('ЗАПЧАСТИ')) return 'parts';
  if (clean.startsWith('СТОИМОСТЬРАБОТ')) return 'services';
  if (clean.startsWith('ОКРАСКА')) return 'paint';
  if (clean.startsWith('ПРОЧЕЕ')) return 'other';
  return null;
}

// Parts row (ЗАПЧАСТИ): "1481 ДВЕРЬ П Л *A2127205300"  |  right: "153018*"
function parsePartsRow({ left, right }) {
  const price = toNum(right);
  if (!price) return null;

  const m = left.match(/^(\d{4})\s+(.+)$/);
  if (!m) return null;

  const tokens = m[2].trim().split(/\s+/);
  // Code: alphanumeric token with at least one letter (e.g. A2127205300, *A0007271300)
  let code = '';
  const codeRe = /^\*?[A-Za-z0-9]*[A-Za-z][A-Za-z0-9-]{3,}$/;
  if (tokens.length && codeRe.test(tokens[tokens.length - 1])) {
    code = tokens.pop().replace(/^\*/, '');
  }

  const name = tokens.join(' ').trim();
  if (!name) return null;
  return { code, name, qty: 1, unit: 'шт.', price };
}

// Services row: "54-1011 01 ПРОВЕСТИ КРАТКИЙ ТЕСТ 1 3"  |  right: "250"
// Also handles 4-digit codes: "0745 ОБЛИЦОВКА КРЫЛА П Л С/У 1 6*"
const OPCODE_RE = /^(\d{2}-\d{4}\s+\d{2}|\d{4})\s+/;
const NUM_TAIL_RE = /^\d+\*?$/;

function parseServicesRow({ left, right }) {
  const price = toNum(right);
  if (!price) return null;

  const m = left.match(OPCODE_RE);
  if (!m) return null;

  const tokens = left.slice(m[0].length).trim().split(/\s+/);
  // Strip trailing КЛ and РП columns (pure numbers left of the price column)
  while (tokens.length > 1 && NUM_TAIL_RE.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  const name = tokens.join(' ').trim();
  if (!name) return null;
  return { name, qty: 1, price };
}

export async function parseAudatexPdf(file) {
  const lines = await extractLines(file);
  const services = [];
  const parts = [];
  let section = null;

  for (const line of lines) {
    const clean = line.full.replace(/\s+/g, '').toUpperCase();

    // Skip separator lines and system stamps
    if (/^-{10,}/.test(line.full)) continue;
    if (clean.includes('СИСТЕМАAUDATEX')) continue;

    // Stop at final summary or control sheet (they don't contain billable rows)
    if (clean.startsWith('ОКОНЧАТЕЛЬНАЯКАЛЬКУЛЯЦИЯ') || clean.startsWith('КОНТРОЛЬНЫЙЛИСТ')) break;

    // Detect section header
    const detected = detectSection(clean);
    if (detected) { section = detected; continue; }

    if (section === 'parts') {
      const row = parsePartsRow(line);
      if (row) parts.push(row);
    } else if (section === 'services' || section === 'paint') {
      const row = parseServicesRow(line);
      if (row) services.push(row);
    } else if (section === 'other') {
      // ПРОЧЕЕ (kits, adhesives, etc.) → treat as parts
      const row = parsePartsRow(line);
      if (row) parts.push(row);
    }
  }

  return { services, parts };
}
