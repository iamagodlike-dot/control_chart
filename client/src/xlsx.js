// Минимальный писатель файлов Excel (.xlsx) — БЕЗ внешних библиотек.
//
// Зачем свой: .xlsx — это обычный zip с несколькими XML внутри. Ради одной кнопки
// «скачать в Excel» тянуть в бандл SheetJS/exceljs (сотни килобайт) не хочется, а
// CSV не умеет ни заголовков, ни объединённых ячеек, ни денежного формата — открытый
// в Excel документ выглядел бы как каша. Поэтому здесь: свой zip (без сжатия, метод
// "store" — документы крошечные) + ручная сборка OOXML.
//
// Что поддерживаем осознанно: несколько листов, ширины колонок, объединённые ячейки,
// высоту строк, набор именованных стилей (ниже) и ДВА типа значений — число и текст.
// Формул, картинок и графиков нет: в наших документах они не нужны.
//
// Формат вызова:
//   sheetsToXlsx([{ name: 'Заказ-наряд', cols: [{ w: 5 }, …], rows, merges: ['A1:G1'] }])
//   rows  — массив строк; строка = массив ячеек ИЛИ { cells: [...], h: 30 }
//   cell  — null | 'текст' | 12345 | { v, s: 'имя-стиля' }
// Возвращает Uint8Array — готовое содержимое .xlsx.

// ===== Стили =====
// Имя стиля → индекс в cellXfs (порядок ниже в STYLES_XML менять только вместе).
export const STYLE = {
  text: 0,       // обычный текст
  bold: 1,       // жирный
  title: 2,      // заголовок документа (14, жирный)
  sub: 3,        // мелкий серый (реквизиты, подписи под линиями)
  th: 4,         // шапка таблицы (жирный, заливка, рамка, по центру)
  td: 5,         // ячейка таблицы (рамка, перенос по словам)
  tdc: 6,        // ячейка таблицы по центру (кол-во, ед.)
  money: 7,      // деньги в таблице (рамка, формат «1 234,00 ₽», вправо)
  moneyBold: 8,  // деньги жирным (итоги в таблице)
  total: 9,      // итоговая сумма без рамки (жирная, вправо)
  wrap: 10,      // длинный текст с переносом (гарантия, согласие)
  label: 11,     // подпись поля («Гос. номер»)
  sect: 12,      // строка-раздел («Перечень работ»)
  right: 13,     // текст, прижатый вправо (подписи к итогам)
};

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const STYLES_XML = `${XML_HEAD}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00&quot; ₽&quot;"/></numFmts>
<fonts count="5">
<font><sz val="11"/><color rgb="FF111111"/><name val="Calibri"/><family val="2"/><charset val="204"/></font>
<font><b/><sz val="11"/><color rgb="FF111111"/><name val="Calibri"/><family val="2"/><charset val="204"/></font>
<font><b/><sz val="14"/><color rgb="FF111111"/><name val="Calibri"/><family val="2"/><charset val="204"/></font>
<font><sz val="9"/><color rgb="FF767676"/><name val="Calibri"/><family val="2"/><charset val="204"/></font>
<font><b/><sz val="11"/><color rgb="FF1F2A33"/><name val="Calibri"/><family val="2"/><charset val="204"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE6E9EC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F4F6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB4B4B4"/></left><right style="thin"><color rgb="FFB4B4B4"/></right><top style="thin"><color rgb="FFB4B4B4"/></top><bottom style="thin"><color rgb="FFB4B4B4"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ===== XML =====
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Excel не открывает файл с управляющими символами внутри <t> — вычищаем.
    // eslint-disable-next-line no-control-regex -- ровно эти символы и ловим
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// 0 → A, 25 → Z, 26 → AA …
export function colName(i) {
  let n = Math.max(0, Math.floor(i));
  let s = '';
  for (;;) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}

// Имя листа: Excel запрещает : \ / ? * [ ] и длину > 31.
export function safeSheetName(name, fallback = 'Лист1') {
  const s = String(name || '').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31);
  return s || fallback;
}

function cellXml(ref, cell) {
  if (cell === null || cell === undefined || cell === '') return '';
  const isObj = typeof cell === 'object';
  const v = isObj ? cell.v : cell;
  const s = isObj && cell.s ? (STYLE[cell.s] ?? STYLE.text) : STYLE.text;
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  }
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(sheet) {
  const rows = sheet.rows || [];
  const cols = (sheet.cols || [])
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c && c.w ? c.w : 12}" customWidth="1"/>`)
    .join('');
  const body = rows.map((row, ri) => {
    const cells = Array.isArray(row) ? row : (row.cells || []);
    const h = !Array.isArray(row) && row.h ? ` ht="${row.h}" customHeight="1"` : '';
    const xml = cells.map((cell, ci) => cellXml(`${colName(ci)}${ri + 1}`, cell)).join('');
    return `<row r="${ri + 1}"${h}>${xml}</row>`;
  }).join('');
  const merges = (sheet.merges || []).filter(Boolean);
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  const lastCol = colName(Math.max(0, (sheet.cols || []).length - 1));
  return `${XML_HEAD}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastCol}${Math.max(1, rows.length)}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${body}</sheetData>
${mergeXml}
<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

// ===== ZIP (без сжатия) =====
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(bytes) {
  const t = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ t[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function dosStamp(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  };
}

// files: [{ name, data: Uint8Array }] → Uint8Array с zip-архивом.
export function zipStore(files, now = new Date()) {
  const enc = new TextEncoder();
  const { date, time } = dosStamp(now);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // имена файлов в UTF-8
    lv.setUint16(8, 0, true);      // метод 0 = без сжатия
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    parts.push(local, f.data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length + f.data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...central, end];
  const total = all.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// ===== Сборка книги =====
export function sheetsToXlsx(sheets, now = new Date()) {
  const enc = new TextEncoder();
  const list = (sheets || []).map((s, i) => ({ ...s, name: safeSheetName(s.name, `Лист${i + 1}`) }));
  if (!list.length) list.push({ name: 'Лист1', rows: [], cols: [] });

  const contentTypes = `${XML_HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${list.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `${XML_HEAD}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${list.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`;

  const wbRels = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${list.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const files = [
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    { name: 'xl/styles.xml', data: enc.encode(STYLES_XML) },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s)) })),
  ];
  return zipStore(files, now);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Имя файла без запрещённых в файловой системе символов.
export function safeFileName(name) {
  return String(name || 'Документ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Отдать книгу пользователю как загрузку (только браузер).
export function downloadXlsx(sheets, fileName) {
  const bytes = sheetsToXlsx(sheets);
  const blob = new Blob([bytes], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFileName(fileName)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Освобождаем ссылку не сразу: Safari отменяет скачивание, если revoke
  // случается раньше, чем браузер успел забрать данные.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
