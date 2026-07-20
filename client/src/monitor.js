// Экран «Монитор»: классификация каждой машины на площадке — где она стоит,
// почему стоит и сколько дней. Zero-dependency (как billing.js), чтобы гоняться
// юнит-тестами:  node --test src/monitor.test.js
//
// ЭТАП 1 (текущий): простой считается ПРИБЛИЗИТЕЛЬНО по имеющимся полям
// (created_at / repair_since / receiving_log) — переходы между статусами пока не
// логировались. Этап 2 (дневник переходов, job.status_log в api.js) уже копит
// точную историю; Этап 3 переведёт расчёт на неё.
import { isApproval, approvalStatusLabel } from './phase.js';
import { isInsurance } from './insurance.js';

export const DAY_MS = 86400000;

// Полных дней между двумя моментами (ms), не бывает отрицательным.
export function days(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.max(0, Math.floor((toMs - fromMs) / DAY_MS));
}

// ISO-строка ('2026-07-10T09:00') или ms → ms. NaN, если распарсить нельзя.
function toMs(v) {
  if (typeof v === 'number') return v;
  if (!v) return NaN;
  const t = new Date(v).getTime();
  return t;
}

// Статусы детали, при которых она ЕЩЁ НЕ на складе: машина может ждать её.
// Пустой статус = «Требуется» (как в normalizePart / setInvoiceParts).
export const AWAITED_PART_STATUSES = ['need', 'invoiced', 'ordered', 'arrived'];

// Пороги светофора, в днях простоя: [🟢 до, 🟡 до, 🟠 до], дальше 🔴.
// Пока заглушки; позже вынести в «Настройки».
export const THRESHOLDS = {
  repair: [2, 5, 10],      // очередь / запчасти: 🟢 0–2 · 🟡 3–5 · 🟠 6–10 · 🔴 >10
  insurance: [7, 14, 25],  // согласование — мягче: 🟢 0–7 · 🟡 8–14 · 🟠 15–25 · 🔴 >25
};

function severityFor(stageKey, idleDays) {
  if (stageKey === 'repair') return 'ok';           // идёт работа — всегда 🟢
  if (stageKey === 'done' || stageKey === 'rejected') return 'none';
  const t = stageKey === 'approval' ? THRESHOLDS.insurance : THRESHOLDS.repair;
  if (idleDays <= t[0]) return 'ok';
  if (idleDays <= t[1]) return 'warn';
  if (idleDays <= t[2]) return 'orange';
  return 'danger';
}

// Сердце экрана: одна машина → { stageKey, stageLabel, cause, idleDays,
// totalDays, severity, ranked }. Причины перебираются worst-first; ranked:false
// (готово / отказ) — строки, которые не участвуют в рейтинге простоя.
export function classify(job, now) {
  const totalDays = days(toMs(job.created_at), now);
  const base = { totalDays, ranked: true };

  // 1) Согласование со страховой.
  if (isApproval(job)) {
    const sub = job.approval_status;
    if (sub === 'rejected') {
      return { ...base, stageKey: 'rejected', stageLabel: 'Отказ', cause: '—', idleDays: 0, severity: 'none', ranked: false };
    }
    const subLabel = approvalStatusLabel(sub);
    const idleDays = days(toMs(job.created_at), now);
    return {
      ...base,
      stageKey: 'approval',
      stageLabel: subLabel ? `Согласование: ${subLabel}` : 'Согласование',
      cause: sub === 'surcharge' ? 'Страховая (доплата)' : 'Страховая',
      idleDays,
      severity: severityFor('approval', idleDays),
    };
  }

  // ---- Ремонт (phase === 'repair' или поля нет — старые машины) ----
  const stages = job.stages || [];
  // Берём сырой status, а не effectiveStatus из Gantt: просроченный этап «В работе»
  // (effectiveStatus === 'delayed') — это всё ещё идущая работа, а не простой.
  const hasActive = stages.some((s) => s.status === 'in_progress');
  const allDone = stages.length > 0 && stages.every((s) => s.status === 'done');
  const awaited = (job.parts || []).filter((p) => AWAITED_PART_STATUSES.includes(p.status || 'need'));

  // 2) Готово — все этапы закрыты. Нейтрально, НЕ причина простоя (решение владельца).
  if (allDone) {
    const lastEnd = stages.reduce((max, s) => {
      const t = toMs(s.end_at);
      return Number.isFinite(t) && t > max ? t : max;
    }, -Infinity);
    return {
      ...base,
      stageKey: 'done',
      stageLabel: 'Готово',
      cause: '—',
      idleDays: Number.isFinite(lastEnd) ? days(lastEnd, now) : 0,
      severity: 'none',
      ranked: false,
    };
  }

  // 3) Прямо сейчас идёт этап → простоя нет.
  if (hasActive) {
    return { ...base, stageKey: 'repair', stageLabel: 'В ремонте', cause: '—', idleDays: 0, severity: 'ok' };
  }

  // 4) Работа не идёт и есть неполученные детали → ждёт запчасти.
  if (awaited.length > 0) {
    // Отсчёт — от самого раннего заказа детали (receiving_log), если заказы уже
    // были; иначе от начала ремонта / заведения машины.
    let orderedAt = Infinity;
    for (const p of awaited) {
      for (const e of (p.receiving_log || [])) {
        if (e.status === 'ordered' && Number.isFinite(e.at) && e.at < orderedAt) orderedAt = e.at;
      }
    }
    const start = Number.isFinite(orderedAt) && orderedAt !== Infinity
      ? orderedAt
      : (toMs(job.repair_since ?? job.created_at));
    const idleDays = days(start, now);
    return {
      ...base,
      stageKey: 'parts',
      stageLabel: 'Ждёт запчасти',
      cause: 'Запчасти',
      idleDays,
      severity: severityFor('parts', idleDays),
    };
  }

  // 5) В очереди: согласовано / в ремонте, но работа не начата и деталей не ждём.
  const idleDays = days(toMs(job.repair_since ?? job.created_at), now);
  return {
    ...base,
    stageKey: 'queue',
    stageLabel: 'В очереди',
    cause: 'Нет поста/мастера',
    idleDays,
    severity: severityFor('queue', idleDays),
  };
}

// Фильтр-чипы этапов. Чип «Согласование» накрывает и «Отказ» (это колонка той же
// доски), чтобы ни одна машина не выпадала из всех чипов сразу.
export const STAGE_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'approval', label: 'Согласование' },
  { id: 'queue', label: 'Очередь' },
  { id: 'parts', label: 'Запчасти' },
  { id: 'repair', label: 'В ремонте' },
  { id: 'done', label: 'Готово' },
];

const stageChipMatch = (chip, stageKey) => (
  chip === 'all'
  || (chip === 'approval' ? (stageKey === 'approval' || stageKey === 'rejected') : stageKey === chip)
);

export const SORTS = [
  { id: 'idle', label: 'Простой ↓' },
  { id: 'total', label: 'Всего дней ↓' },
  { id: 'deadline', label: 'Ближайший дедлайн' },
  { id: 'model', label: 'Марка А-Я' },
];

function compareRows(a, b, sort) {
  // Готово/отказ — всегда в самом низу списка (кроме сортировки по марке).
  if (sort !== 'model' && a.ranked !== b.ranked) return a.ranked ? -1 : 1;
  if (sort === 'total') return b.totalDays - a.totalDays || b.idleDays - a.idleDays;
  if (sort === 'deadline') {
    const ad = toMs(a.job.deadline);
    const bd = toMs(b.job.deadline);
    const aHas = Number.isFinite(ad);
    const bHas = Number.isFinite(bd);
    if (aHas !== bHas) return aHas ? -1 : 1;      // без дедлайна — вниз
    if (aHas && bHas && ad !== bd) return ad - bd; // ближайший — сверху
    return b.idleDays - a.idleDays;
  }
  if (sort === 'model') {
    return String(a.job.car_model || '').localeCompare(String(b.job.car_model || ''), 'ru');
  }
  return b.idleDays - a.idleDays || b.totalDays - a.totalDays; // 'idle' (по умолчанию)
}

// ВЬЮ-МОДЕЛЬ экрана: список НЕ-архивных машин → { rows, counts, summary }.
// Сводка считается по ВСЕЙ площадке (до фильтров), counts чипов — после фильтра
// по оплате и поиска, rows — после всех фильтров + сортировка.
export function buildMonitor(jobs, { now = Date.now(), stage = 'all', payer = 'all', query = '', sort = 'idle' } = {}) {
  const all = (jobs || []).map((job) => ({ job, ...classify(job, now) }));

  // Сводка по всей площадке.
  const ranked = all.filter((r) => r.ranked);
  const causeCount = new Map();
  for (const r of ranked) {
    if (r.idleDays >= 1 && r.cause !== '—') causeCount.set(r.cause, (causeCount.get(r.cause) || 0) + 1);
  }
  let topCause = null;
  for (const [cause, n] of causeCount) {
    if (!topCause || n > topCause.count) topCause = { cause, count: n };
  }
  const summary = {
    total: all.length,
    over7: ranked.filter((r) => r.idleDays > 7).length,
    topCause: topCause ? topCause.cause : null,
    avgIdle: ranked.length ? Math.round(ranked.reduce((s, r) => s + r.idleDays, 0) / ranked.length) : 0,
  };

  const q = query.trim().toLowerCase();
  const matches = (r) => {
    if (payer === 'insurance' && !isInsurance(r.job)) return false;
    if (payer === 'client' && isInsurance(r.job)) return false;
    if (!q) return true;
    return [r.job.plate_number, r.job.car_model, r.job.client_name]
      .some((v) => String(v || '').toLowerCase().includes(q));
  };
  const visible = all.filter(matches);

  const counts = { all: visible.length };
  for (const f of STAGE_FILTERS) {
    if (f.id !== 'all') counts[f.id] = visible.filter((r) => stageChipMatch(f.id, r.stageKey)).length;
  }

  const rows = visible
    .filter((r) => stageChipMatch(stage, r.stageKey))
    .sort((a, b) => compareRows(a, b, sort));

  return { rows, counts, summary };
}
