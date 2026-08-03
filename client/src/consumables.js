// Экран «Расходники» — склад расходных материалов по принципам 5S.
// Zero-dependency (как monitor.js / requests.js), чтобы гоняться юнит-тестами:
//   node --test src/consumables.test.js
//
// ГЛАВНОЕ РЕШЕНИЕ (утв. владельцем): гибрид ABC. Номенклатура делится флажком
// `tracked` на две группы, и это ЕДИНСТВЕННОЕ, что отличает их поведение:
//   tracked = true  → группа A: дорогое и критичное (лак, грунт, отвердитель,
//                     абразив). Считаем количество, следим за мин/макс, срок
//                     годности, каждая выдача пишется в журнал движений.
//   tracked = false → группа B/C: дешёвое и массовое (перчатки, скотч, ветошь).
//                     Количество НЕ считаем вообще — только канбан-флажок
//                     `empty`: кончилось / есть. Пересчёт раз в месяц.
// Перевод позиции из группы в группу = переключение флажка, без миграций.
//
// Модель документа коллекции `consumables`:
//   { id, name, category, unit, tracked,
//     qty,                    // остаток — только для tracked
//     min_qty, max_qty,       // точка заказа и «дозаказать до» — только для tracked
//     empty,                  // канбан-сигнал — только для !tracked
//     location,               // адрес места хранения: 'С2-B-03'
//     supplier, last_price,   // чтобы автозаявка была сразу заполненной
//     shelf_life_until,       // срок годности (ms) — для химии и ЛКМ
//     last_move_at,           // когда последний раз двигалось (мёртвые запасы)
//     red_tag,                // красный ярлык 5S: { at, by, reason } | null
//     request_id,             // открытая заявка на дозаказ — чтобы не плодить дубли
//     active }
//
// Журнал движений — отдельная коллекция `consumableMoves`:
//   { consumable_id, type: 'out'|'in'|'inventory'|'writeoff', delta, qty_after,
//     at, by, by_name, note }

export const DAY_MS = 86400000;

// Единицы измерения в справочнике. Те же, что в заявках (requests.js), плюс
// «рулон» и «лист» — иначе абразив и малярную ленту не описать честно.
export const CONSUMABLE_UNITS = ['шт', 'упак', 'л', 'кг', 'м', 'рулон', 'лист', 'компл'];

// Категории расходников кузовного сервиса. Не бухгалтерский план счетов —
// то, как эти вещи реально лежат на полках и как их ищет мастер.
export const CONSUMABLE_CATEGORIES = [
  'ЛКМ (лак, грунт, краска)',
  'Абразив',
  'Малярный расходник',
  'Химия',
  'СИЗ',
  'Крепёж и мелочёвка',
  'Прочее',
];

// Позиция «мёртвая», если не двигалась столько дней. Кандидат в красную зону
// (шаг 1 «Сортировка»). Позже вынести в «Настройки».
export const DEAD_DAYS = 90;
// За сколько дней до конца срока годности начинаем предупреждать.
export const EXPIRY_WARN_DAYS = 30;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

// ─── Состояние позиции: светофор ────────────────────────────────────────────
// 'out'  🔴 кончилось — работа встанет
// 'low'  🟡 на исходе — ниже точки заказа, пора заказывать
// 'ok'   🟢 в норме
// Канбан-позиции жёлтыми не бывают: у них всего два состояния, в этом весь смысл.
export function stockState(item) {
  if (!item) return 'ok';
  if (!item.tracked) return item.empty ? 'out' : 'ok';
  const qty = num(item.qty);
  if (qty <= 0) return 'out';
  if (qty <= num(item.min_qty)) return 'low';
  return 'ok';
}

export const STATE_META = {
  out: { label: 'кончилось', short: 'Кончилось', tone: 'out', order: 0 },
  low: { label: 'на исходе', short: 'На исходе', tone: 'low', order: 1 },
  ok: { label: 'в норме', short: 'В норме', tone: 'ok', order: 2 },
};

// ─── Дозаказ ────────────────────────────────────────────────────────────────
// Позицию надо заказывать, если она не зелёная и заявка ещё не создана.
export function needsReorder(item) {
  return stockState(item) !== 'ok' && !item?.request_id;
}

// Сколько заказать. Для учётных — добить до максимума (классический min/max),
// для канбана — одна «стандартная упаковка» (max_qty), по умолчанию 1.
// Всегда целое и не меньше единицы: заявку на «0,4 упаковки» никто не поймёт.
export function reorderQty(item) {
  if (!item) return 1;
  if (!item.tracked) return Math.max(1, Math.round(num(item.max_qty, 1)));
  const target = num(item.max_qty, num(item.min_qty) * 2 || 1);
  return Math.max(1, Math.ceil(target - num(item.qty)));
}

// Во сколько обойдётся дозаказ позиции по последней цене. 0, если цены не знаем.
export function reorderCost(item) {
  return Math.round(reorderQty(item) * num(item?.last_price));
}

// ─── Мёртвые запасы и сроки годности ────────────────────────────────────────
export function daysSinceMove(item, now = Date.now()) {
  const t = num(item?.last_move_at, 0);
  if (!t) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

// Не двигалось дольше DEAD_DAYS и ещё не помечено красным ярлыком.
export function isDead(item, now = Date.now(), limit = DEAD_DAYS) {
  const d = daysSinceMove(item, now);
  return d != null && d >= limit && !item?.red_tag;
}

// 'expired' — срок вышел, 'soon' — истекает в ближайший месяц, 'ok' — в порядке,
// null — у позиции срока годности нет (перчатки не протухают).
export function expiryState(item, now = Date.now()) {
  const t = num(item?.shelf_life_until, 0);
  if (!t) return null;
  const left = Math.floor((t - now) / DAY_MS);
  if (left < 0) return 'expired';
  if (left <= EXPIRY_WARN_DAYS) return 'soon';
  return 'ok';
}

export function daysUntilExpiry(item, now = Date.now()) {
  const t = num(item?.shelf_life_until, 0);
  if (!t) return null;
  return Math.floor((t - now) / DAY_MS);
}

// ─── Адрес хранения ─────────────────────────────────────────────────────────
// Адрес — строка вида 'С2-B-03' (стеллаж 2, полка B, ячейка 3). Для группировки
// в «Светофоре» нужен только стеллаж — первый сегмент до дефиса.
export function shelfOf(item) {
  const loc = String(item?.location || '').trim();
  if (!loc) return 'Без адреса';
  return loc.split('-')[0] || 'Без адреса';
}

// ─── Фильтры экрана ─────────────────────────────────────────────────────────
export const STOCK_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'out', label: 'Кончилось' },
  { id: 'low', label: 'На исходе' },
  { id: 'reorder', label: 'К заказу' },
  { id: 'tracked', label: 'Учётные (A)' },
  { id: 'kanban', label: 'Канбан (B/C)' },
  { id: 'dead', label: 'Не двигалось' },
  { id: 'redtag', label: 'Красная зона' },
];

export const SORTS = [
  { id: 'state', label: 'Сначала красные' },
  { id: 'name', label: 'По названию' },
  { id: 'location', label: 'По адресу' },
  { id: 'dead', label: 'Дольше всех лежит' },
];

function matchesFilter(item, filter, now) {
  const st = stockState(item);
  switch (filter) {
    case 'out': return st === 'out';
    case 'low': return st === 'low';
    case 'reorder': return st !== 'ok';
    case 'tracked': return !!item.tracked;
    case 'kanban': return !item.tracked;
    case 'dead': return isDead(item, now);
    case 'redtag': return !!item.red_tag;
    default: return true;
  }
}

function matchesQuery(item, q) {
  if (!q) return true;
  const hay = [item.name, item.category, item.location, item.supplier]
    .map((s) => String(s || '').toLowerCase()).join(' ');
  return hay.includes(q);
}

// Собрать вью-модель экрана: строки (уже с рассчитанным состоянием), счётчики
// для чипов-фильтров и сводку для шапки. Одна функция на весь экран — как
// buildMonitor: и живой экран, и демо кормятся ровно ею.
export function buildConsumables(list = [], opts = {}, now = Date.now()) {
  const { filter = 'all', category = 'all', query = '', sort = 'state' } = opts;
  const q = String(query || '').trim().toLowerCase();
  const items = arr(list).filter((i) => i.active !== false);

  const enrich = (item) => ({
    item,
    state: stockState(item),
    dead: isDead(item, now),
    idleDays: daysSinceMove(item, now),
    expiry: expiryState(item, now),
    expiryDays: daysUntilExpiry(item, now),
    shelf: shelfOf(item),
    reorderQty: reorderQty(item),
    reorderCost: reorderCost(item),
    needsReorder: needsReorder(item),
  });

  // Счётчики чипов считаем ДО фильтра по состоянию, но ПОСЛЕ поиска и категории —
  // иначе цифра на чипе не совпадает с тем, что человек увидит, нажав на него.
  const scoped = items.filter((i) => (category === 'all' || i.category === category) && matchesQuery(i, q));
  const counts = {};
  for (const f of STOCK_FILTERS) counts[f.id] = scoped.filter((i) => matchesFilter(i, f.id, now)).length;

  let rows = scoped.filter((i) => matchesFilter(i, filter, now)).map(enrich);

  const byName = (a, b) => String(a.item.name || '').localeCompare(String(b.item.name || ''), 'ru');
  rows = rows.sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'location') return String(a.item.location || 'яяя').localeCompare(String(b.item.location || 'яяя'), 'ru') || byName(a, b);
    if (sort === 'dead') return (b.idleDays ?? -1) - (a.idleDays ?? -1) || byName(a, b);
    // 'state': красные наверх, внутри одного цвета — по адресу, чтобы обходить
    // полки по порядку, а не бегать по цеху.
    return (STATE_META[a.state].order - STATE_META[b.state].order)
      || String(a.item.location || 'яяя').localeCompare(String(b.item.location || 'яяя'), 'ru')
      || byName(a, b);
  });

  const all = items.map(enrich);
  const toOrder = all.filter((r) => r.needsReorder);
  const summary = {
    total: all.length,
    out: all.filter((r) => r.state === 'out').length,
    low: all.filter((r) => r.state === 'low').length,
    ok: all.filter((r) => r.state === 'ok').length,
    tracked: all.filter((r) => r.item.tracked).length,
    dead: all.filter((r) => r.dead).length,
    redTag: all.filter((r) => r.item.red_tag).length,
    expiring: all.filter((r) => r.expiry === 'soon' || r.expiry === 'expired').length,
    toOrder: toOrder.length,
    toOrderCost: toOrder.reduce((s, r) => s + r.reorderCost, 0),
  };

  return { rows, counts, summary };
}

// Разложить строки по стеллажам для вида «Светофор». Внутри стеллажа порядок
// уже задан сортировкой, группы — по адресу, «Без адреса» всегда последним.
export function groupByShelf(rows = []) {
  const map = new Map();
  for (const r of arr(rows)) {
    if (!map.has(r.shelf)) map.set(r.shelf, []);
    map.get(r.shelf).push(r);
  }
  return [...map.entries()]
    .map(([shelf, items]) => ({ shelf, items, out: items.filter((i) => i.state === 'out').length }))
    .sort((a, b) => (a.shelf === 'Без адреса' ? 1 : b.shelf === 'Без адреса' ? -1 : a.shelf.localeCompare(b.shelf, 'ru')));
}

// ─── Аудит 5S ───────────────────────────────────────────────────────────────
// Пять шагов, каждый оценивается 0/1/2. Без этой части «склад» остаётся просто
// табличкой остатков: 5S держится не на учёте, а на регулярной оценке.
export const FIVE_S = [
  { id: 's1', title: 'Сортировка', hint: 'На полках нет лишнего: просрочки, чужого, «на всякий случай»' },
  { id: 's2', title: 'Порядок', hint: 'У каждой позиции есть адрес и этикетка, всё стоит на своих местах' },
  { id: 's3', title: 'Чистота', hint: 'Полки и пол чистые, тары не текут, мусор вынесен' },
  { id: 's4', title: 'Стандартизация', hint: 'Заданы минимумы, фото-эталон полки совпадает с тем, что видим' },
  { id: 's5', title: 'Дисциплина', hint: 'Сигналы отрабатываются: красное заказано, приход оприходован' },
];

export const SCORE_LABELS = { 0: 'плохо', 1: 'частично', 2: 'хорошо' };

export function auditTotal(scores = {}) {
  return FIVE_S.reduce((s, step) => s + Math.max(0, Math.min(2, num(scores[step.id]))), 0);
}

// Вердикт по сумме баллов (0–10). Пороги намеренно строгие: «хорошо» — это когда
// почти всё на 2, иначе смысл еженедельной оценки теряется.
export function auditVerdict(total) {
  if (total >= 9) return { label: 'отлично', tone: 'ok' };
  if (total >= 7) return { label: 'нормально', tone: 'ok' };
  if (total >= 4) return { label: 'есть провалы', tone: 'low' };
  return { label: 'плохо', tone: 'out' };
}

// Динамика баллов: последние N аудитов от старых к новым — для спарклайна.
export function auditTrend(list = [], limit = 12) {
  return arr(list)
    .slice()
    .sort((a, b) => num(a.at) - num(b.at))
    .slice(-limit)
    .map((a) => ({ at: num(a.at), total: num(a.total, auditTotal(a.scores)) }));
}
