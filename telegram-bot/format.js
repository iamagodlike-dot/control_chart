'use strict';
const dayjs = require('dayjs');

// ─── Статусы (те же, что на сайте) ───
const STATUS_LABEL = {
  planned: 'запланирован',
  queued: 'в очереди',
  in_progress: 'в работе',
  done: 'готово',
  delayed: 'задержка',
};
const STATUS_DOT = {
  planned: '⚪️',
  queued: '⚫️',
  in_progress: '🟠',
  done: '🟢',
  delayed: '🔴',
};

function badge(status) {
  return `${STATUS_DOT[status] || '⚪️'} ${STATUS_LABEL[status] || status || '—'}`;
}

// Фактический статус этапа: если срок прошёл, а он не «готово» — это «задержка».
function effectiveStageStatus(stage, now = dayjs()) {
  if (!stage) return 'planned';
  if (stage.status === 'done') return 'done';
  const end = stage.end_at ? dayjs(stage.end_at) : null;
  if (end && end.isValid() && end.isBefore(now)) return 'delayed';
  return stage.status || 'planned';
}

// Общий статус машины по её этапам.
function jobOverallStatus(job, now = dayjs()) {
  const stages = job.stages || [];
  if (stages.length === 0) return 'planned';
  const eff = stages.map((s) => effectiveStageStatus(s, now));
  if (eff.includes('delayed')) return 'delayed';
  if (eff.includes('in_progress')) return 'in_progress';
  if (eff.every((s) => s === 'done')) return 'done';
  return 'planned';
}

// Текущий этап машины: сначала «в работе», иначе — ближайший незакрытый.
function currentStage(job) {
  const stages = job.stages || [];
  const active = stages.filter((s) => s.status !== 'done');
  if (active.length === 0) return null;
  return active.find((s) => s.status === 'in_progress') || active[0];
}

// ─── Даты и деньги ───
function fmtDate(v) {
  if (!v) return '—';
  const d = dayjs(v);
  return d.isValid() ? d.format('DD.MM') : '—';
}

function money(n) {
  const num = Number(n) || 0;
  return new Intl.NumberFormat('ru-RU').format(Math.round(num)) + ' ₽';
}

// Человеческое «через N дней / сегодня / просрочено».
function relativeDeadline(v, now = dayjs()) {
  if (!v) return '';
  const d = dayjs(v);
  if (!d.isValid()) return '';
  const days = d.startOf('day').diff(now.startOf('day'), 'day');
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days > 1) return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  const overdue = -days;
  return `просрочено на ${overdue} ${plural(overdue, 'день', 'дня', 'дней')}`;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// Приводит дату к миллисекундам: число (мс), Firestore Timestamp, или строка ISO.
function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
  const d = dayjs(v);
  return d.isValid() ? d.valueOf() : null;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Запчасти (те же статусы/типы, что на экране «Запчасти» сайта) ───
// pr — порядок вывода (сначала «требуется», затем «заказано» и т.д.).
// ВАЖНО: порядок/набор статусов должен совпадать с client/src/parts.js
// (partStatusMeta). «Выставлен счёт» (invoiced) вставлен между «Требуется» и
// «Заказано» — иначе позиция со счётом падала бы в бакет «Требуется».
const PART_STATUS_META = [
  { id: 'need', label: 'Требуется', dot: '🔴', pr: 0 },
  { id: 'invoiced', label: 'Выставлен счёт', dot: '🟠', pr: 1 },
  { id: 'ordered', label: 'Заказано', dot: '🟡', pr: 2 },
  { id: 'arrived', label: 'Приехало', dot: '🟣', pr: 3 }, // доехало до ТК — экспедитору забрать
  { id: 'in', label: 'На складе', dot: '🟢', pr: 4 },
  { id: 'issued', label: 'Изъято', dot: '🔵', pr: 5 },
];
const partStatusMeta = (id) => PART_STATUS_META.find((s) => s.id === id) || PART_STATUS_META[0];

const PART_KIND_LABEL = {
  new: 'Новое',
  used: 'Б/У',
  used_orig: 'Б/У под ориг.',
  analog: 'Замена',
  analog_orig: 'Аналог под ориг.',
};
const partKindLabel = (id) => PART_KIND_LABEL[id] || '';

// ─── Фаза машины (копия client/src/phase.js — при правках на сайте синхронизировать) ───
// СОВМЕСТИМОСТЬ: у машин, заведённых до появления фазы, поля `phase` нет. Как и на
// сайте, считаем их ремонтом — иначе они выпали бы из сводки по укомплектованности.
const PHASE = { APPROVAL: 'approval', REPAIR: 'repair' };
const isApproval = (job) => !!job && job.phase === PHASE.APPROVAL;
const isRepair = (job) => !isApproval(job);

// Под-статусы согласования = колонки доски «Согласование» на сайте, слева направо.
// Точки подобраны под те же цвета, что и колонки (planned/in_progress/queued/done +
// warning/danger). `side: true` — тупиковые колонки (доплата / отказ).
// ВАЖНО: набор и порядок должны совпадать с client/src/phase.js (APPROVAL_STATUSES).
const APPROVAL_STATUS_META = [
  { id: 'inspection', label: 'Осмотр / дефектовка',    dot: '⚪️', pr: 0 },
  { id: 'calc',       label: 'Калькуляция',            dot: '🟠', pr: 1 },
  { id: 'sent',       label: 'Отправлено страховой',   dot: '⚫️', pr: 2 },
  { id: 'approved',   label: 'Согласовано',            dot: '🟢', pr: 3 },
  { id: 'surcharge',  label: 'Нужна доплата / правки', dot: '🟡', pr: 4, side: true },
  { id: 'rejected',   label: 'Отказ',                  dot: '🔴', pr: 5, side: true },
];
// Неизвестный/пустой под-статус = «Осмотр» (так же трактует доска на сайте).
const approvalStatusMeta = (id) => APPROVAL_STATUS_META.find((s) => s.id === id) || APPROVAL_STATUS_META[0];

// ─── Покраска ───
const PAINT_STATUS_META = {
  need: { label: 'Требуется', dot: '🔴' },
  matching: { label: 'Подбор цвета', dot: '🟡' },
  mixing: { label: 'Замешивается', dot: '🔵' },
  ready: { label: 'Готова', dot: '🟢' },
  applied: { label: 'Нанесена', dot: '⚪️' },
};
const paintStatusMeta = (id) => PAINT_STATUS_META[id] || PAINT_STATUS_META.need;

// ─── Тип оплаты (короткие подписи для карточки) ───
const PAYMENT_SHORT = { cash: 'Наличные', insurance: 'Страховая', legal: 'Юрлицо' };

// Короткая сводка по массиву запчастей: сколько всего и сколько в каждом статусе.
function partsSummary(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const counts = {};
  for (const p of list) {
    const id = partStatusMeta(p && p.status).id;
    counts[id] = (counts[id] || 0) + 1;
  }
  return { total: list.length, counts };
}

// Укомплектованность машины по запчастям: сколько позиций уже у нас на руках
// (на складе или изъяты в работу) из общего числа.
// ГОТЧА: у позиций из импорта Audatex и ручного ввода поля status нет вообще —
// пустой статус означает «Требуется» (так же, как normalizePart на сайте).
function partsReadiness(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const obtained = list.filter((p) => {
    const st = (p && p.status) || 'need';
    return st === 'in' || st === 'issued';
  }).length;
  return {
    total: list.length,
    obtained,
    missing: list.length - obtained,
    complete: list.length > 0 && obtained === list.length,
  };
}

// Компактная подпись машины для списков: госномер «шильдиком» (моноширинный) + модель.
function carLabel(job) {
  const model = esc((job && job.car_model) || 'Авто');
  const plate = job && job.plate_number ? `<code>${esc(job.plate_number)}</code>` : '';
  return plate ? `${plate} · ${model}` : model;
}

// Текстовая полоса прогресса из «плиток»: ▰ — заполнено, ▱ — пусто. Ширина равна
// числу делений (максимум 12), доля заполнения округляется.
function progressBar(done, total) {
  const t = Number(total) || 0;
  if (t <= 0) return '';
  const width = Math.min(t, 12);
  const filled = Math.max(0, Math.min(width, Math.round(((Number(done) || 0) / t) * width)));
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

module.exports = {
  STATUS_LABEL,
  badge,
  effectiveStageStatus,
  jobOverallStatus,
  currentStage,
  fmtDate,
  money,
  relativeDeadline,
  plural,
  esc,
  toMs,
  PART_STATUS_META,
  partStatusMeta,
  partKindLabel,
  paintStatusMeta,
  PAYMENT_SHORT,
  partsSummary,
  partsReadiness,
  progressBar,
  carLabel,
  PHASE,
  isApproval,
  isRepair,
  APPROVAL_STATUS_META,
  approvalStatusMeta,
};
