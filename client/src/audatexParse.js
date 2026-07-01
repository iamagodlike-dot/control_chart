import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Audatex "РЕМОНТ-КАЛЬКУЛЯЦИЯ" is a strictly columnar report. We split each line
// into columns by the X position of every text token (fractions of page width,
// measured from real Audatex PDFs on 612pt pages), which is far more reliable
// than guessing with regexes — every article (even all-digit ones) lands in its
// own column.
//
// Columns (fraction of page width):
//   [0        .. F_NAME)   код/поз. (УПР № or КОД ОПЕР.) — ignored for output
//   [F_NAME   .. F_ART)    НАЗВАНИЕ (parts) / description (works)
//   [F_ART    .. F_PPRICE) № ДЕТАЛИ (article) — parts only
//   [F_RP     .. F_WPRICE) РП (labor units) — works only, excluded from name
//   [F_PPRICE/F_WPRICE ..) СТОИМ (price), right-aligned
const F_NAME = 0.26;
const F_ART = 0.482;
const F_PPRICE = 0.72;
const F_RP = 0.716;
const F_WPRICE = 0.77;

function toNum(s) {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[^0-9.,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function clean(s) {
  return s.replace(/\s+/g, '').toUpperCase();
}

// Extract every page's lines as arrays of { x, str } tokens sorted left-to-right.
async function extractLines(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const width = page.getViewport({ scale: 1 }).width;
    const content = await page.getTextContent();
    const byY = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = Math.round(item.transform[5] / 2) * 2;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ x, str: item.str });
    }
    const ys = [...byY.keys()].sort((a, b) => b - a); // top → bottom
    for (const y of ys) {
      lines.push({ width, tokens: byY.get(y).sort((a, b) => a.x - b.x) });
    }
  }
  return lines;
}

function join(tokens, lo, hi) {
  return tokens.filter((t) => t.x >= lo && t.x < hi).map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
}

// Rightmost price token at/after startX. Prices are integer RUR with an optional
// trailing marker (* = user data, U = recalculated). Tokens containing a dot are
// skipped so dates like "15.06.2026" are never mistaken for a price.
function priceAt(tokens, startX) {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.x < startX) continue;
    if (t.str.includes('.')) continue;
    const v = toNum(t.str);
    if (v > 0) return v;
  }
  return 0;
}

// In the final calculation, amounts are right-aligned and split into thousand
// groups as separate tokens (e.g. "33" + "789-" = 33789). Join the digits of all
// right-side tokens into one integer.
function sumRight(tokens, width) {
  const minX = 0.6 * width;
  let digits = '';
  for (const t of tokens) {
    if (t.x < minX) continue;
    if (t.str.includes('.')) continue; // skip dates / percentages like 13.00%
    digits += t.str.replace(/[^0-9]/g, '');
  }
  return digits ? parseInt(digits, 10) : 0;
}

export async function parseAudatexPdf(file) {
  const lines = await extractLines(file);
  const services = [];
  const parts = [];
  const vehicle = {};
  const meta = {};
  let section = null;

  for (const { width, tokens } of lines) {
    const nameX = F_NAME * width;
    const artX = F_ART * width;
    const pPriceX = F_PPRICE * width;
    const rpX = F_RP * width;
    const wPriceX = F_WPRICE * width;

    const text = tokens.map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
    const c = clean(text);

    // ---- Vehicle / document header (appears before the item sections) ----
    if (!vehicle.car_model && c.includes('ПРОИЗВОД')) {
      const m = text.match(/ПРОИЗВОД\s+(.+?)\s*\(/);
      if (m) vehicle.car_model = m[1].trim();
    }
    if (c.startsWith('КУЗОВ')) {
      let m = text.match(/КУЗОВ\s*№\s*(\S+)/);
      if (m) vehicle.vin = m[1];
      m = text.match(/ГОС\.?\s*№\s*(\S+)/);
      if (m) vehicle.plate = m[1];
    }
    if (c.startsWith('ПРОБЕГ')) {
      const m = text.match(/ПРОБЕГ\s+(\d+)/);
      if (m) vehicle.mileage = m[1];
    }
    if (!meta.date && section === null) {
      const m = text.match(/\b(\d{2}\.\d{2}\.\d{4})\b/);
      if (m) meta.date = m[1];
    }
    if (!meta.number && c.includes('ДЕЛА')) {
      const m = text.match(/ДЕЛА\s+(\S+)/);
      if (m) meta.number = m[1];
    }

    // ---- Section boundaries ----
    if (c.startsWith('КОНТРОЛЬНЫЙЛИСТ')) break;
    // Итоговая калькуляция: switch to summary mode to pull the remaining
    // calculations (скидка, лакокрасочные материалы, итог) — not item rows.
    if (c.startsWith('ОКОНЧАТЕЛЬНАЯКАЛЬКУЛЯЦИЯ')) { section = 'summary'; continue; }
    // Page-header line ("РЕМОНТ-КАЛЬКУЛЯЦИЯ № ... дата") repeats atop every page —
    // reset the section so it's never parsed as a data row on continuation pages.
    if (c.includes('КАЛЬКУЛЯЦИЯ')) { section = null; continue; }
    if (/^-{6,}/.test(text) || c.includes('СИСТЕМАAUDATEX')) continue;
    if (section !== 'summary') {
      if (c.startsWith('ЗАПЧАСТИ')) { section = 'parts'; continue; }
      if (c.startsWith('СТОИМОСТЬРАБОТ')) { section = 'works'; continue; }
      if (c.startsWith('ОКРАСКА')) { section = 'works'; continue; }
      if (c.startsWith('ПРОЧЕЕ')) { section = 'other'; continue; }
    }

    // ---- Rows (a valid row must have a numeric price in its price column) ----
    if (section === 'parts') {
      const price = priceAt(tokens, pPriceX);
      if (price <= 0) continue;
      const name = join(tokens, nameX, artX);
      let code = join(tokens, artX, pPriceX).replace(/\s+/g, '').replace(/^\*/, '');
      if (/^KN/i.test(code)) code = ''; // KN = "без № запчасти" placeholder, not a real article
      if (!name) continue;
      parts.push({ code, name, qty: 1, unit: 'шт.', price });
    } else if (section === 'works') {
      const price = priceAt(tokens, wPriceX);
      if (price <= 0) continue;
      const name = join(tokens, nameX, rpX);
      if (!name) continue;
      services.push({ name, qty: 1, price });
    } else if (section === 'other') {
      const price = priceAt(tokens, pPriceX);
      if (price <= 0) continue;
      const name = join(tokens, nameX, pPriceX);
      if (!name) continue;
      parts.push({ code: '', name, qty: 1, unit: 'шт.', price });
    } else if (section === 'summary') {
      if (c.startsWith('СКИДКА')) {
        const d = sumRight(tokens, width);
        if (d > 0) meta.discount = d;
      } else if (c.startsWith('ЛАКОКРАСОЧН')) {
        const price = sumRight(tokens, width);
        if (price > 0) parts.push({ code: '', name: 'Лакокрасочные материалы', qty: 1, unit: 'компл.', price });
      } else if (c.startsWith('СТОИМОСТЬРЕМОНТА')) {
        const tot = sumRight(tokens, width);
        if (tot > 0) meta.repair_total = tot;
      }
    }
  }

  return { services, parts, vehicle, meta };
}
