import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const SERVICES_HEADER_RE = /наименован.*работ/i;
const PARTS_HEADER_RE = /расходн.*материал/i;
const STOP_RE = /^итого|^рекомендации|^скидка|^всего по|^предоплата|^доплата/i;

const NUMERIC_RE = /^-?\d[\d\s]*(?:[.,]\d+)?$/;
const UNIT_RE = /^(шт\.?|к-?т\.?|компл\.?|м\.?|кг\.?|л\.?|пара|пар)$/i;
const CODE_RE = /^(?=.*\d)(?=.*[A-Za-zА-Яа-я])[A-Za-zА-Яа-я0-9-]{5,}$/;

function toNumber(token) {
  return parseFloat(token.replace(/\s/g, '').replace(',', '.'));
}

async function extractLines(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const byY = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2; // bucket close y-values together
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(item);
    }
    const ys = [...byY.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const items = byY.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
      const text = items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
  }
  return lines;
}

function parseRow(line, { withUnit }) {
  const m = line.match(/^(\d{1,4})\s+(.*)$/);
  if (!m) return null;
  const tokens = m[2].trim().split(/\s+/);
  if (tokens.length < 2) return null;

  const trailing = [];
  while (tokens.length && NUMERIC_RE.test(tokens[tokens.length - 1]) && trailing.length < 3) {
    trailing.unshift(tokens.pop());
  }
  if (trailing.length < 1) return null;

  let unit = null;
  if (withUnit && tokens.length && UNIT_RE.test(tokens[tokens.length - 1])) {
    unit = tokens.pop();
  }

  let qty = null;
  if (tokens.length && trailing.length <= 2 && NUMERIC_RE.test(tokens[tokens.length - 1])) {
    qty = toNumber(tokens.pop());
  }

  let code = null;
  if (tokens.length && CODE_RE.test(tokens[0])) {
    code = tokens.shift();
  }

  const name = tokens.join(' ').trim();
  if (!name) return null;

  let price, total;
  if (qty !== null && trailing.length === 2) {
    [price, total] = trailing.map(toNumber);
  } else if (qty === null && trailing.length === 3) {
    [qty, price, total] = trailing.map(toNumber);
  } else if (qty === null && trailing.length === 2) {
    [qty, price] = trailing.map(toNumber);
    total = qty * price;
  } else if (trailing.length === 1) {
    price = toNumber(trailing[0]);
    qty = qty ?? 1;
    total = qty * price;
  } else {
    return null;
  }

  return { code, name, qty, unit, price, total };
}

function extractSection(lines, headerRe, { withUnit }) {
  const startIdx = lines.findIndex((l) => headerRe.test(l));
  if (startIdx === -1) return [];
  const rows = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (STOP_RE.test(line) || SERVICES_HEADER_RE.test(line) || PARTS_HEADER_RE.test(line)) break;
    const row = parseRow(line, { withUnit });
    if (row) rows.push(row);
  }
  return rows;
}

export async function parseAudatexPdf(file) {
  const lines = await extractLines(file);
  const services = extractSection(lines, SERVICES_HEADER_RE, { withUnit: false })
    .map(({ name, qty, price }) => ({ name, qty, price }));
  const parts = extractSection(lines, PARTS_HEADER_RE, { withUnit: true })
    .map(({ code, name, qty, unit, price }) => ({ code, name, qty, unit: unit || 'шт.', price }));
  return { services, parts };
}
