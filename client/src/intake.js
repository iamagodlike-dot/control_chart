// Экран мастера-приёмщика — диспетчерская дефектовки.
//
// ЧТО ЭТО. Машина заведена в систему (страховая дала направление или клиент
// обратился сам), но физически её ещё нет: сначала приёмщик обязан позвонить и
// договориться, когда её привезут на дефектовку. Экран отвечает на три вопроса —
// кому звонить прямо сейчас, кто приедет в ближайшие две недели и про кого пора
// напомнить. Сама дефектовка (осмотр, фото, повреждения) — следующий шаг, здесь
// только запись на неё.
//
// ОТКУДА МАШИНЫ. Колонка «Осмотр / дефектовка» доски «Согласование»
// (phase = approval, approval_status = 'inspection'). Как только машину переводят
// в «Калькуляцию», она с экрана уходит — приёмщику она больше не нужна.
//
// ГДЕ ЖИВУТ ДАННЫЕ. В самом документе машины, поле `job.intake`
// (см. api.jobs.setIntakeDate). Отдельная коллекция не заводится сознательно:
// экран и так подписан на машины, лишние чтения Firestore при бесплатной квоте
// заметны (см. память «Нагрузка на Firebase»).
//
// ВРЕМЯ — ВСЕГДА МЕСТНОЕ. Сервис работает по Красноярску, а «завтра», «день
// прошёл» и клетки календаря считаются по календарным суткам, а не по разнице в
// миллисекундах: дефектовка в 09:00 завтра — это «завтра» и в 23:50, и в 00:10.
//
// Модуль намеренно без зависимостей (как billing.js / monitor.js), чтобы
// гоняться юнит-тестами:  node --test src/intake.test.js

import { isApproval } from './phase.js';

// Под-статус согласования, машины которого попадают на экран приёмщика.
export const INTAKE_APPROVAL_STATUS = 'inspection';

// Сколько дней машина может висеть без приглашения, прежде чем строка начнёт
// желтеть и краснеть. Направление от страховой отрабатывают в день получения,
// поэтому пороги низкие: сутки — уже пора звонить, три дня — просрочено.
export const INVITE_WARN_DAYS = 1;
export const INVITE_ALERT_DAYS = 3;

// Горизонт календаря: текущая и следующая недели. Всё, что дальше, уходит в
// список «приедут позже» — в сетке от них был бы только шум.
export const CALENDAR_WEEKS = 2;

export const DAY_MS = 86400000;

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// ─── Мелкие утилиты ──────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ─── Календарные сутки (местное время) ───────────────────────────────────────

// Полночь того дня, в который попадает момент. Основа всех сравнений «какой это
// день»: сравнивать сами моменты нельзя — 23:50 и 00:10 отличаются на 20 минут,
// но это разные сутки.
export function startOfDay(ms) {
  const t = num(ms);
  if (!t) return 0;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 'ГГГГ-ММ-ДД' в МЕСТНОМ времени — ключ клетки календаря. Через toISOString()
// ночная запись по Красноярску попала бы во вчерашнюю клетку.
export function dayKey(ms) {
  const t = num(ms);
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Разница в КАЛЕНДАРНЫХ днях: «сколько раз наступила полночь между from и to».
// Может быть отрицательной (to раньше from). Через деление на DAY_MS без
// нормализации к полуночи ответ зависел бы от времени суток.
export function dayDiff(fromMs, toMs) {
  const a = startOfDay(fromMs);
  const b = startOfDay(toMs);
  if (!a || !b) return 0;
  return Math.round((b - a) / DAY_MS);
}

// Полночь понедельника той недели, в которую попадает момент. Неделя начинается
// с понедельника — так её видит вся страна и так же устроен DateTimeField.
export function startOfWeek(ms) {
  const t = startOfDay(ms);
  if (!t) return 0;
  const d = new Date(t);
  const shift = (d.getDay() + 6) % 7;   // Вс = 0 у Date → 6 у нас
  d.setDate(d.getDate() - shift);
  return d.getTime();
}

// Прибавить дни через сам Date, а не через +n*DAY_MS: на переходах зимнего
// времени арифметика в миллисекундах даёт 23-часовые «сутки».
export function addDays(ms, n) {
  const t = startOfDay(ms);
  if (!t) return 0;
  const d = new Date(t);
  d.setDate(d.getDate() + Math.round(num(n)));
  return d.getTime();
}

// 'ГГГГ-ММ-ДДTЧЧ:ММ' (то, что отдаёт DateTimeField) → ms в местном времени.
// new Date('2026-08-12T14:30') браузеры читают как местное, но Node — по-разному
// в зависимости от версии, а модуль обязан считаться одинаково и в тестах.
export function parseLocalDateTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(str(value).trim());
  if (!m) return 0;
  const [, y, mo, d, hh, mm] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh || 0), Number(mm || 0), 0, 0);
  return Number.isFinite(dt.getTime()) ? dt.getTime() : 0;
}

// ms → 'ГГГГ-ММ-ДДTЧЧ:ММ' для подстановки в поле ввода при переносе.
export function toLocalInput(ms) {
  const t = num(ms);
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ─── Подписи ─────────────────────────────────────────────────────────────────

export function fmtTime(ms) {
  const t = num(ms);
  if (!t) return '';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDay(ms) {
  const t = num(ms);
  if (!t) return '';
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function fmtWeekday(ms) {
  const t = num(ms);
  if (!t) return '';
  return WEEKDAYS_SHORT[(new Date(t).getDay() + 6) % 7];
}

export function fmtDayTime(ms) {
  const t = num(ms);
  if (!t) return '';
  return `${fmtDay(t)}, ${fmtTime(t)}`;
}

// «сегодня» / «завтра» / «через 3 дня» / «5 дней назад» — человеческая подпись
// того же числа, что стоит в дате. Приёмщику важнее «завтра», чем «13 августа».
export function fmtRelativeDay(ms, nowMs) {
  const diff = dayDiff(nowMs, ms);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === 2) return 'послезавтра';
  if (diff === -1) return 'вчера';
  if (diff < 0) return `${-diff} ${pluralDays(-diff)} назад`;
  return `через ${diff} ${pluralDays(diff)}`;
}

export function pluralDays(n) {
  const a = Math.abs(n) % 100;
  const b = Math.abs(n) % 10;
  if (a > 10 && a < 20) return 'дней';
  if (b > 1 && b < 5) return 'дня';
  if (b === 1) return 'день';
  return 'дней';
}

// ─── Данные приёмки в машине ─────────────────────────────────────────────────

// Пустая приёмка — то, с чего начинается машина, которую ещё не трогали.
export function emptyIntake() {
  return {
    scheduled_at: 0,      // согласованные дата и время дефектовки
    invited_at: 0,        // когда назначили впервые
    invited_by: '',
    confirmed_at: 0,      // накануне позвонили, клиент подтвердил
    confirmed_for: 0,     // ДЛЯ КАКОЙ даты подтверждено (см. ниже)
    started_at: 0,        // дефектовка начата — задел под следующий шаг
    log: [],              // журнал приглашений и переносов
  };
}

// Приёмка машины в нормальном виде. У старых машин поля нет вовсе → пустая.
export function readIntake(job) {
  const raw = job && typeof job.intake === 'object' && job.intake ? job.intake : null;
  const base = emptyIntake();
  if (!raw) return base;
  return {
    ...base,
    scheduled_at: num(raw.scheduled_at),
    invited_at: num(raw.invited_at),
    invited_by: str(raw.invited_by),
    confirmed_at: num(raw.confirmed_at),
    confirmed_for: num(raw.confirmed_for),
    started_at: num(raw.started_at),
    log: arr(raw.log)
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        at: num(e.at),
        by: str(e.by),
        kind: ['invite', 'move', 'confirm'].includes(e.kind) ? e.kind : 'move',
        from: num(e.from),
        to: num(e.to),
        reason: str(e.reason),
      }))
      .sort((a, b) => b.at - a.at),   // свежее сверху: журнал читают с конца
  };
}

// Подтверждение привязано к КОНКРЕТНОЙ дате: после переноса «клиент подтвердил»
// обнуляется само, без отдельной чистки. Иначе машина, подтверждённая на среду и
// перенесённая на пятницу, считалась бы подтверждённой — и звонок накануне
// пятницы никто бы не сделал.
export function isConfirmed(intake) {
  const i = intake || {};
  return !!(i.confirmed_at && i.scheduled_at && i.confirmed_for === i.scheduled_at);
}

// Машина на экране приёмщика? = согласование + под-статус «Осмотр / дефектовка».
// Пустой approval_status трактуем как 'inspection' — ровно так же, как доска
// «Согласование» (DEFAULT_APPROVAL_STATUS), иначе машина без статуса потерялась
// бы между двумя экранами.
export function isOnIntake(job) {
  if (!job || job.archived) return false;
  if (!isApproval(job)) return false;
  const st = str(job.approval_status) || INTAKE_APPROVAL_STATUS;
  return st === INTAKE_APPROVAL_STATUS;
}

// С какого момента считаем «сколько машина ждёт приглашения»: с попадания в
// колонку осмотра, а если её туда не переводили — с заведения в систему.
export function waitingSince(job) {
  return num(job?.approval_since) || num(job?.created_at) || 0;
}

// ─── Строка машины ───────────────────────────────────────────────────────────

// Вью-модель одной машины. Здесь же разложены все поля, которые нужны попапу
// звонка, — чтобы интерфейс не выковыривал их из документа машины сам.
export function intakeRow(job, nowMs = 0) {
  const intake = readIntake(job);
  const since = waitingSince(job);
  const daysWaiting = since ? Math.max(0, dayDiff(since, nowMs)) : 0;
  const scheduled = intake.scheduled_at;
  const dueDiff = scheduled ? dayDiff(nowMs, scheduled) : null;

  let phase;
  if (intake.started_at) phase = 'started';
  else if (!scheduled) phase = 'invite';
  else if (dueDiff < 0) phase = 'overdue';       // день прошёл, машины не было
  else phase = 'scheduled';

  return {
    id: job.id,
    job,
    car_model: str(job.car_model) || 'Без модели',
    plate_number: str(job.plate_number),
    client_name: str(job.client_name),
    client_phone: str(job.client_phone),
    payment_type: str(job.payment_type) || 'cash',
    insurer_name: str(job.insurer_name),
    claim_number: str(job.claim_number),
    policy_number: str(job.policy_number),
    order_number: str(job.order_number),
    notes: str(job.notes),
    vin: str(job.vin),

    intake,
    scheduled_at: scheduled,
    confirmed: isConfirmed(intake),
    log: intake.log,

    phase,
    daysWaiting,
    dueDiff,                                     // null, если дата не назначена
    severity: inviteSeverity(phase, daysWaiting),
  };
}

// Светофор строки. Красное — только там, где реально просрочено: если красным
// подсвечивать всё подряд, приёмщик перестанет на него смотреть.
function inviteSeverity(phase, daysWaiting) {
  if (phase === 'overdue') return 'alert';
  if (phase !== 'invite') return 'ok';
  if (daysWaiting >= INVITE_ALERT_DAYS) return 'alert';
  if (daysWaiting >= INVITE_WARN_DAYS) return 'warn';
  return 'ok';
}

// ─── Сетка календаря ─────────────────────────────────────────────────────────

// Две недели клетками: [{ days: [день × 7] }, …]. Клетка знает про себя всё, что
// нужно нарисовать, — экран не считает даты сам.
export function buildWeeks(nowMs, weeks = CALENDAR_WEEKS) {
  const today = startOfDay(nowMs);
  const first = startOfWeek(nowMs);
  const out = [];
  for (let w = 0; w < Math.max(1, weeks); w += 1) {
    const days = [];
    for (let i = 0; i < 7; i += 1) {
      const ms = addDays(first, w * 7 + i);
      const d = new Date(ms);
      days.push({
        ms,
        key: dayKey(ms),
        dayNum: d.getDate(),
        month: MONTHS_SHORT[d.getMonth()],
        weekday: WEEKDAYS_SHORT[i],
        isToday: ms === today,
        isPast: ms < today,
        isWeekend: i >= 5,
        // Первое число месяца подписываем месяцем — иначе на стыке августа и
        // сентября непонятно, где кончился один и начался другой.
        showMonth: d.getDate() === 1 || (w === 0 && i === 0),
        cars: [],
      });
    }
    out.push({ id: `w${w}`, start: days[0].ms, days });
  }
  return out;
}

// ─── Напоминания ─────────────────────────────────────────────────────────────

// Два повода напомнить, оба названы владельцем:
//   overdue — день прошёл, а машину не отдефектовали (и не перенесли);
//   call    — дефектовка завтра, надо позвонить и убедиться, что всё в силе.
// Напоминания вычисляются, а не хранятся: «прочитанное» напоминание, которое
// исчезло, но дело осталось, — худший вид напоминания.
//
// Текущий момент отдельно не передаётся: строки его уже несут в `phase` и
// `dueDiff` (см. intakeRow). Второй источник «сейчас» рано или поздно разошёлся
// бы с первым — и напоминание жило бы по своему времени.
export function buildReminders(rows) {
  const overdue = rows
    .filter((r) => r.phase === 'overdue')
    .sort((a, b) => a.scheduled_at - b.scheduled_at)   // самые давние сверху
    .map((r) => ({ id: `overdue-${r.id}`, kind: 'overdue', row: r }));

  const call = rows
    .filter((r) => r.phase === 'scheduled' && r.dueDiff === 1 && !r.confirmed)
    .sort((a, b) => a.scheduled_at - b.scheduled_at)
    .map((r) => ({ id: `call-${r.id}`, kind: 'call', row: r }));

  // Просроченные впереди: пропущенная машина — это сорванный срок ремонта,
  // а звонок накануне ещё можно сделать в любой момент дня.
  return [...overdue, ...call];
}

// ─── Сборка экрана ───────────────────────────────────────────────────────────

function matchesQuery(row, q) {
  if (!q) return true;
  return [row.car_model, row.plate_number, row.client_name, row.client_phone, row.insurer_name, row.claim_number]
    .some((v) => str(v).toLowerCase().includes(q));
}

const SEVERITY_ORDER = { alert: 0, warn: 1, ok: 2 };

// Всё, что рисует экран, одним вызовом. `nowMs` передаём снаружи (Date.now() в
// рендере запрещён правилом чистоты проекта — см. Approval.jsx).
export function buildIntakeBoard(jobs, { nowMs = 0, query = '', weeks = CALENDAR_WEEKS } = {}) {
  const q = str(query).trim().toLowerCase();
  const all = arr(jobs).filter(isOnIntake).map((j) => intakeRow(j, nowMs));
  const rows = all.filter((r) => matchesQuery(r, q));

  // Пригласить: дольше всех ждущие сверху — это и есть смысл экрана.
  const invite = rows
    .filter((r) => r.phase === 'invite')
    .sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (bySeverity) return bySeverity;
      if (b.daysWaiting !== a.daysWaiting) return b.daysWaiting - a.daysWaiting;
      return a.plate_number.localeCompare(b.plate_number, 'ru');
    });

  const grid = buildWeeks(nowMs, weeks);
  const cells = new Map();
  for (const week of grid) for (const day of week.days) cells.set(day.key, day);
  const windowEnd = grid[grid.length - 1].days[6].ms;

  const scheduled = rows.filter((r) => r.scheduled_at && r.phase !== 'invite');
  const later = [];
  for (const row of scheduled) {
    const cell = cells.get(dayKey(row.scheduled_at));
    if (cell) cell.cars.push(row);
    else if (startOfDay(row.scheduled_at) > windowEnd) later.push(row);
    // Машины с датой РАНЬШЕ окна (прошлая неделя и глубже) в сетку не попадают —
    // их держат напоминания «не отдефектован», иначе они молча исчезли бы.
  }
  for (const day of cells.values()) day.cars.sort((a, b) => a.scheduled_at - b.scheduled_at);
  later.sort((a, b) => a.scheduled_at - b.scheduled_at);

  // Напоминания считаем по ВСЕМ машинам, а не по отфильтрованным поиском: иначе
  // набранный в поиске номер спрятал бы напоминание про другую машину.
  const reminders = buildReminders(all);

  return {
    rows,
    invite,
    weeks: grid,
    later,
    reminders,
    counts: {
      invite: invite.length,
      scheduled: scheduled.filter((r) => r.phase === 'scheduled').length,
      today: all.filter((r) => r.phase === 'scheduled' && r.dueDiff === 0).length,
      overdue: all.filter((r) => r.phase === 'overdue').length,
      later: later.length,
      stale: invite.filter((r) => r.severity === 'alert').length,
    },
  };
}

// ─── Форма приглашения и переноса ────────────────────────────────────────────

export const MIN_REASON_LEN = 3;

// Проверка формы перед записью. ОДНО место, где живут правила, — его читают и
// кнопка «Сохранить», и подсказки под полями, поэтому они не могут разойтись.
//
// `isMove` = у машины уже была дата. Владелец потребовал: переносить только с
// отметкой «согласовано с клиентом» и с причиной — перенос без звонка клиенту
// это и есть та ситуация, из-за которой машину потом не привозят.
export function validateSchedule({ at = 0, reason = '', agreed = false, isMove = false, nowMs = 0 } = {}) {
  const errors = {};
  const ms = num(at);
  if (!ms) errors.at = 'Укажите дату и время';
  else if (startOfDay(ms) < startOfDay(nowMs)) errors.at = 'Эта дата уже прошла';

  if (isMove) {
    if (!agreed) errors.agreed = 'Без согласования с клиентом переносить нельзя';
    if (str(reason).trim().length < MIN_REASON_LEN) errors.reason = 'Коротко напишите причину переноса';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// Строка журнала для интерфейса: «12 авг, 14:30 → 15 авг, 10:00 — клиент в отъезде».
export function describeLogEntry(entry) {
  const e = entry || {};
  if (e.kind === 'invite') return `Записан на ${fmtDayTime(e.to)}`;
  if (e.kind === 'confirm') return `Клиент подтвердил ${fmtDayTime(e.to)}`;
  const from = e.from ? fmtDayTime(e.from) : '—';
  return `Перенос ${from} → ${fmtDayTime(e.to)}`;
}
