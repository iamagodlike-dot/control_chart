// Разбор выгрузки «Заказ-наряды» из Splus (splus.ru) в объекты заказов нашего
// формата (готовые к записи в коллекцию jobs). Чистый модуль без Firebase/DOM —
// чтобы его можно было прогонять в тестах (Node) и переиспользовать в UI импорта.
//
// Ожидаемые столбцы файла Splus:
//   id_num, date_start2, contractor_name, contractor_auto_name,
//   all_sum, paid_sum, status, comment

// Короткие «маркеры» известных страховых. Ищутся как подстрока в имени
// плательщика (регистронезависимо) — устойчивее, чем сравнение полных названий,
// т.к. в Splus встречаются варианты: САО "ВСК", СПАО «Ингосстрах», РЕСО-Гарантия.
export const INSURER_HINTS = [
  'ВСК', 'РЕСО', 'Ингосстрах', 'СОГАЗ', 'АльфаСтрахование', 'Росгосстрах',
  'Ренессанс', 'Согласие', 'Зетта', 'Энергогарант', 'Гайде', 'Югория',
  'Тинькофф Страхование', 'Совкомбанк Страхование', 'Сбербанк страхование',
  'Макс ', 'МАКС ', // с пробелом, чтобы не ловить слова вроде «максимум»
];

// --- CSV-разборщик (RFC-4180): кавычки, экранирование "", запятые и переводы
// строк внутри кавычек. Возвращает массив строк, каждая — массив ячеек.
export function parseCsv(text) {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // убрать BOM
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // экранированная кавычка
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* пропускаем */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// «Geely CITYRAY (A468AO224)» -> { car_model: 'Geely CITYRAY', plate_number: 'A468AO224' }
// Последняя группа в скобках считается госномером; без скобок — всё это модель.
export function parseCarString(raw) {
  const s = (raw || '').trim();
  if (!s) return { car_model: '', plate_number: '' };
  const m = s.match(/^(.*)\(([^()]*)\)\s*$/);
  if (m && m[2].trim()) return { car_model: m[1].trim(), plate_number: m[2].trim() };
  return { car_model: s, plate_number: '' };
}

// «06.07.2026 (10:42)» -> метка времени (мс, локальное время). null, если не разобрать.
export function parseSplusDate(raw) {
  const m = (raw || '').match(/(\d{2})\.(\d{2})\.(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '0', mi = '0'] = m;
  const d = new Date(+yyyy, +mm - 1, +dd, +hh, +mi);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function isInsurer(name) {
  const n = (name || '').toLowerCase();
  return INSURER_HINTS.some((h) => n.includes(h.toLowerCase().trim()));
}

// 202500 -> «202 500», 14633.6 -> «14 633,6», 0/пусто -> «».
export function formatMoney(v) {
  const num = Number(v);
  if (!Number.isFinite(num) || num === 0) return '';
  const [int, frac] = String(num).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac ? `${grouped},${frac}` : grouped;
}

const REQUIRED_COLS = ['id_num', 'date_start2', 'contractor_name', 'contractor_auto_name'];

/**
 * Разбирает текст CSV-выгрузки Splus в список заказов.
 * @returns {{ orders: Array, warnings: string[], header: string[] }}
 *   orders[i].job — объект для записи в jobs (order_number, car_model, plate_number,
 *   client_name, notes, created_at, [insurer_name], payment_type, imported_from).
 *   Остальные поля orders[i] (с префиксом _) — только для предпросмотра, не пишутся.
 */
export function mapSplusOrders(text, opts = {}) {
  const now = opts.now || Date.now();
  const rows = parseCsv(text);
  if (!rows.length) return { orders: [], warnings: ['Файл пустой'], header: [] };

  const header = rows[0].map((h) => h.trim());
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  const warnings = [];
  for (const col of REQUIRED_COLS) {
    if (!(col in idx)) warnings.push(`Не найден столбец «${col}» — это точно выгрузка «Заказ-наряды» из Splus?`);
  }

  const orders = [];
  const seen = new Set();
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells || cells.every((c) => (c || '').trim() === '')) continue; // пустая строка
    const get = (name) => (idx[name] != null ? (cells[idx[name]] ?? '') : '');

    const order_number = get('id_num').trim();
    if (!order_number) continue;
    if (seen.has(order_number)) { warnings.push(`Дубль номера ${order_number} внутри файла — вторая запись пропущена`); continue; }
    seen.add(order_number);

    const { car_model, plate_number } = parseCarString(get('contractor_auto_name'));
    const contractor = get('contractor_name').trim();
    const insurer = isInsurer(contractor);
    // Дата — обязательна: список заказов сортируется по created_at, и запись без
    // неё не попадёт в общий список. Если не разобрать — ставим «сейчас».
    const created_at = parseSplusDate(get('date_start2')) ?? now;

    // Заметки = комментарий из Splus + справочная строка с суммой (в финансы НЕ идёт).
    const comment = get('comment').replace(/\r/g, '').trim();
    const sumStr = formatMoney(get('all_sum'));
    const paidStr = formatMoney(get('paid_sum'));
    const noteLines = [];
    if (comment) noteLines.push(comment);
    if (sumStr) noteLines.push(`Сумма по Splus: ${sumStr} ₽${paidStr ? ` (оплачено ${paidStr} ₽)` : ''}`);

    const job = {
      order_number,
      car_model,
      plate_number,
      client_name: contractor,
      notes: noteLines.join('\n'),
      created_at,
      payment_type: insurer ? 'insurance' : 'cash',
      imported_from: 'splus', // метка партии — по ней импорт легко найти и откатить
    };
    if (insurer) job.insurer_name = contractor;

    orders.push({
      job,
      _row: r + 1,
      _status: get('status').trim(),
      _all_sum: get('all_sum').trim(),
      _date: get('date_start2').trim(),
      _insurer: insurer,
    });
  }

  return { orders, warnings, header };
}
