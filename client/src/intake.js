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
// Поля делятся на две части: запись на дефектовку (сверху) и сама дефектовка,
// то есть осмотр приехавшей машины (снизу, см. раздел «Дефектовка»).
export function emptyIntake() {
  return {
    scheduled_at: 0,      // согласованные дата и время дефектовки
    invited_at: 0,        // когда назначили впервые
    invited_by: '',
    confirmed_at: 0,      // накануне позвонили, клиент подтвердил
    confirmed_for: 0,     // ДЛЯ КАКОЙ даты подтверждено (см. ниже)
    log: [],              // журнал приглашений и переносов

    started_at: 0,        // осмотр начат
    finished_at: 0,       // осмотр завершён
    finished_by: '',
    mileage: '',
    fuel: '',
    keys: '',
    docs: [],             // id переданных документов
    equipment: [],        // id принятой комплектности
    damages: [],          // [{ id, zone, kind, scope, note }]
    notes: '',
    act_number: '',
    act_date: 0,
  };
}

// Приёмка машины в нормальном виде. У старых машин поля нет вовсе → пустая.
export function readIntake(job) {
  const raw = job && typeof job.intake === 'object' && job.intake ? job.intake : null;
  // Пробег из карточки подставляем и в пустую приёмку тоже: у машины, которую
  // приёмщик ещё не открывал, он всё равно уже может быть известен (Audatex,
  // документ), и требовать вписать его заново незачем.
  const base = { ...emptyIntake(), mileage: str(job?.mileage) };
  if (!raw) return base;
  return {
    ...base,
    scheduled_at: num(raw.scheduled_at),
    invited_at: num(raw.invited_at),
    invited_by: str(raw.invited_by),
    confirmed_at: num(raw.confirmed_at),
    confirmed_for: num(raw.confirmed_for),
    started_at: num(raw.started_at),
    finished_at: num(raw.finished_at),
    finished_by: str(raw.finished_by),
    // Пробег у машины один. Пока приёмщик не вписал свой, показываем тот, что уже
    // есть в карточке (мог прийти из Audatex или из документа), — иначе экран
    // дефектовки и акт расходились бы с заказ-нарядом.
    mileage: str(raw.mileage) || str(job?.mileage),
    fuel: str(raw.fuel),
    keys: str(raw.keys),
    docs: arr(raw.docs).map(str),
    equipment: arr(raw.equipment).map(str),
    notes: str(raw.notes),
    act_number: str(raw.act_number),
    act_date: num(raw.act_date),
    damages: arr(raw.damages)
      .filter((d) => d && typeof d === 'object' && str(d.zone).trim())
      .map((d) => ({
        id: str(d.id) || str(d.zone),
        zone: str(d.zone),
        kind: str(d.kind) || DEFAULT_DAMAGE_KIND,
        scope: str(d.scope) === 'old' ? 'old' : DEFAULT_DAMAGE_SCOPE,
        note: str(d.note),
      })),
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

  // Порядок важен: начатая дефектовка перебивает и «просрочено», и «не назначено».
  // Машину могли пригнать без записи — приёмщик просто начал осмотр.
  let phase;
  if (intake.finished_at) phase = 'inspected';
  else if (intake.started_at) phase = 'inspecting';
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

// ═══ ДЕФЕКТОВКА ══════════════════════════════════════════════════════════════
// Машина приехала. Приёмщик обходит её с телефоном и фиксирует состояние: что
// на одометре, что передали вместе с машиной, что уже повреждено и как это
// выглядит на снимках. Результат — акт, которым сервис закрывается от претензий
// «этой царапины не было» и «где мой домкрат».
//
// Смету здесь НЕ считаем — это отдельная работа калькулятора (решение владельца).
//
// Справочники держим константами в коде, а не в настройках: их правят раз в год,
// а отдельный экран настроек — это ещё один экран, который надо поддерживать.

// Обязательные ракурсы съёмки. `required: true` → без снимка дефектовку не закрыть.
// «Повреждения крупно» обязателен всегда: именно эти кадры потом решают спор.
export const PHOTO_SLOTS = [
  { id: 'front_left', label: 'Перед ¾ слева', required: true },
  { id: 'rear_right', label: 'Зад ¾ справа', required: true },
  { id: 'side_left', label: 'Левый борт', required: true },
  { id: 'side_right', label: 'Правый борт', required: true },
  { id: 'vin', label: 'VIN-табличка', required: true },
  { id: 'odometer', label: 'Панель приборов (пробег)', required: true },
  { id: 'interior', label: 'Салон', required: false },
  { id: 'damage', label: 'Повреждения крупно', required: true },
];

// Уровень топлива — как на приборной панели, восемь делений слишком мелко.
export const FUEL_LEVELS = [
  { id: 'empty', label: 'Пусто' },
  { id: 'quarter', label: '¼' },
  { id: 'half', label: '½' },
  { id: 'three_quarters', label: '¾' },
  { id: 'full', label: 'Полный' },
];

// Документы, которые клиент передаёт вместе с машиной.
export const DOC_ITEMS = [
  { id: 'sts', label: 'СТС' },
  { id: 'pts', label: 'ПТС' },
  { id: 'policy', label: 'Полис (ОСАГО/КАСКО)' },
  { id: 'referral', label: 'Направление страховой' },
  { id: 'passport', label: 'Паспорт собственника (копия)' },
  { id: 'power_of_attorney', label: 'Доверенность' },
];

// Комплектность — то, из-за чего чаще всего возникают претензии при выдаче.
export const EQUIPMENT_ITEMS = [
  { id: 'jack', label: 'Домкрат' },
  { id: 'spare', label: 'Запасное колесо' },
  { id: 'wheel_wrench', label: 'Баллонный ключ' },
  { id: 'tools', label: 'Набор инструмента' },
  { id: 'first_aid', label: 'Аптечка' },
  { id: 'extinguisher', label: 'Огнетушитель' },
  { id: 'warning_triangle', label: 'Знак аварийной остановки' },
  { id: 'radio', label: 'Магнитола / мультимедиа' },
  { id: 'mats', label: 'Коврики' },
  { id: 'wheel_lock_key', label: 'Секретка на колёса' },
];

// Зоны кузова. Плоский список, а не кликабельная схема: приёмщик работает с
// телефона одной рукой, галочки быстрее и надёжнее рисунка.
export const DAMAGE_ZONES = [
  { id: 'bumper_front', label: 'Бампер передний', group: 'Перед' },
  { id: 'hood', label: 'Капот', group: 'Перед' },
  { id: 'grille', label: 'Решётка радиатора', group: 'Перед' },
  { id: 'headlight_left', label: 'Фара левая', group: 'Перед' },
  { id: 'headlight_right', label: 'Фара правая', group: 'Перед' },
  { id: 'windshield', label: 'Лобовое стекло', group: 'Перед' },

  { id: 'fender_front_left', label: 'Крыло переднее левое', group: 'Левый борт' },
  { id: 'door_front_left', label: 'Дверь передняя левая', group: 'Левый борт' },
  { id: 'door_rear_left', label: 'Дверь задняя левая', group: 'Левый борт' },
  { id: 'sill_left', label: 'Порог левый', group: 'Левый борт' },
  { id: 'fender_rear_left', label: 'Крыло заднее левое', group: 'Левый борт' },
  { id: 'mirror_left', label: 'Зеркало левое', group: 'Левый борт' },

  { id: 'fender_front_right', label: 'Крыло переднее правое', group: 'Правый борт' },
  { id: 'door_front_right', label: 'Дверь передняя правая', group: 'Правый борт' },
  { id: 'door_rear_right', label: 'Дверь задняя правая', group: 'Правый борт' },
  { id: 'sill_right', label: 'Порог правый', group: 'Правый борт' },
  { id: 'fender_rear_right', label: 'Крыло заднее правое', group: 'Правый борт' },
  { id: 'mirror_right', label: 'Зеркало правое', group: 'Правый борт' },

  { id: 'bumper_rear', label: 'Бампер задний', group: 'Зад' },
  { id: 'trunk', label: 'Крышка багажника', group: 'Зад' },
  { id: 'taillight_left', label: 'Фонарь левый', group: 'Зад' },
  { id: 'taillight_right', label: 'Фонарь правый', group: 'Зад' },
  { id: 'rear_window', label: 'Заднее стекло', group: 'Зад' },

  { id: 'roof', label: 'Крыша', group: 'Прочее' },
  { id: 'wheel_front_left', label: 'Диск переднего левого', group: 'Прочее' },
  { id: 'wheel_front_right', label: 'Диск переднего правого', group: 'Прочее' },
  { id: 'wheel_rear_left', label: 'Диск заднего левого', group: 'Прочее' },
  { id: 'wheel_rear_right', label: 'Диск заднего правого', group: 'Прочее' },
  { id: 'interior', label: 'Салон', group: 'Прочее' },
];

// Характер повреждения. Порядок = по возрастанию тяжести.
export const DAMAGE_KINDS = [
  { id: 'scratch', label: 'Царапина' },
  { id: 'chip', label: 'Скол' },
  { id: 'dent', label: 'Вмятина' },
  { id: 'crack', label: 'Излом / трещина' },
  { id: 'tear', label: 'Разрыв' },
  { id: 'missing', label: 'Отсутствует' },
  { id: 'paint', label: 'Требует окраски' },
  { id: 'replace', label: 'Требует замены' },
];
export const DEFAULT_DAMAGE_KIND = 'scratch';

// Отношение повреждения к страховому случаю. Требование владельца: страховая
// платит только за свой случай, и если доаварийные царапины смешать с аварийными,
// на калькуляции их разбирают заново — уже без машины перед глазами.
export const DAMAGE_SCOPES = [
  { id: 'case', label: 'По случаю', short: 'случай' },
  { id: 'old', label: 'Было раньше', short: 'ранее' },
];
export const DEFAULT_DAMAGE_SCOPE = 'case';

// Фото дефектовки лежат в общем job.photos с этим префиксом категории. Зона
// «Фото — до ремонта» в карточке машины их НЕ подхватывает (она смотрит на
// category === 'before').
export const INTAKE_PHOTO_PREFIX = 'intake:';
export const photoCategory = (slotId) => `${INTAKE_PHOTO_PREFIX}${slotId}`;
export const photoSlotId = (category) => (
  typeof category === 'string' && category.startsWith(INTAKE_PHOTO_PREFIX)
    ? category.slice(INTAKE_PHOTO_PREFIX.length)
    : null
);

// Юридический блок печатного акта.
export const ACT_TEXT =
  'Транспортное средство передано Исполнителю для проведения осмотра (дефектовки) и '
  + 'последующего ремонта. Настоящий акт фиксирует комплектность и состояние ТС на момент '
  + 'приёмки. Заказчик подтверждает, что перечень повреждений и комплектность, указанные в '
  + 'акте, соответствуют фактическому состоянию ТС, и что ценные вещи и документы из салона и '
  + 'багажника изъяты. Исполнитель не несёт ответственности за оставленные в ТС ценности. '
  + 'Скрытые повреждения и дефекты, не выявляемые при внешнем осмотре, фиксируются '
  + 'дополнительно в ходе дефектовки и согласуются с Заказчиком отдельно.';

// ─── Шаги мастера ────────────────────────────────────────────────────────────
// Порядок повторяет порядок реального осмотра: сначала то, что видно с
// водительского места, потом обход с камерой, потом повреждения, и в конце —
// что клиент передал вместе с машиной (это уже разговор с ним).
export const INSPECTION_STEPS = [
  { id: 'car', label: 'Машина', hint: 'Пробег, топливо, ключи' },
  { id: 'photos', label: 'Фото', hint: 'Обход по кругу' },
  { id: 'damages', label: 'Повреждения', hint: 'Что уже побито' },
  { id: 'handover', label: 'Передали', hint: 'Документы и комплектность' },
  { id: 'finish', label: 'Готово', hint: 'Акт и завершение' },
];

// ─── Готовность ──────────────────────────────────────────────────────────────

// Фото дефектовки по рубрикам. `pending` — снимки из локальной очереди отправки
// (см. photoQueue.js): для приёмщика они уже сделаны, и рубрику закрывают. Иначе
// на плохой связи экран требовал бы переснять то, что лежит в телефоне.
export function intakePhotosBySlot(job, pending = []) {
  const out = {};
  const push = (slot, photo) => { (out[slot] || (out[slot] = [])).push(photo); };
  for (const p of arr(job?.photos)) {
    const slot = photoSlotId(p?.category);
    if (slot) push(slot, p);
  }
  for (const p of arr(pending)) {
    if (p && p.slot) push(p.slot, { ...p, pending: true });
  }
  return out;
}

// Полная сводка по машине: что заполнено, чего не хватает, можно ли завершать.
// ЕДИНСТВЕННОЕ место, где живёт правило «что обязательно», — его читают и точки
// прогресса, и кнопка «Завершить», поэтому они не могут разойтись.
export function inspectionStatus(job, pending = []) {
  const intake = readIntake(job);
  const bySlot = intakePhotosBySlot(job, pending);
  const slots = PHOTO_SLOTS.map((slot) => {
    const list = bySlot[slot.id] || [];
    return {
      ...slot,
      photos: list,
      count: list.length,
      waiting: list.filter((p) => p.pending).length,
    };
  });
  const photosMissing = slots.filter((s) => s.required && !s.count);
  const mileageMissing = !str(intake.mileage).trim();

  // Блокируем завершение только тем, без чего акт бессмысленен: пробег (он идёт
  // и в акт, и в заказ-наряд) и обязательные ракурсы. Всё остальное — на совести
  // приёмщика: бывает машина без единого документа и без домкрата.
  const blockers = [
    ...(mileageMissing ? ['Пробег'] : []),
    ...photosMissing.map((s) => `Фото: ${s.label}`),
  ];

  const damagesByScope = {
    case: intake.damages.filter((d) => d.scope !== 'old').length,
    old: intake.damages.filter((d) => d.scope === 'old').length,
  };

  // Готовность шага для точек прогресса. Это НЕ блокировка: серый шаг просто
  // означает «здесь пусто», перейти на него и уйти обратно можно всегда.
  const steps = {
    car: !mileageMissing,
    photos: photosMissing.length === 0,
    damages: intake.damages.length > 0,
    handover: intake.docs.length > 0 || intake.equipment.length > 0,
    finish: intake.finished_at > 0,
  };

  return {
    intake,
    slots,
    photos: { done: slots.filter((s) => s.count).length, total: slots.length, waiting: slots.reduce((n, s) => n + s.waiting, 0) },
    damages: intake.damages.length,
    damagesByScope,
    mileageMissing,
    photosMissing,
    blockers,
    steps,
    ready: blockers.length === 0,
    started: intake.started_at > 0,
    done: intake.finished_at > 0,
    // Повреждений не отмечено вовсе — не запрещаем (бывает скрытый ущерб), но на
    // последнем шаге предупреждаем: чаще это забывчивость, чем целая машина.
    warnNoDamages: intake.damages.length === 0,
  };
}

// ─── Подписи и акт ───────────────────────────────────────────────────────────

const labelFrom = (list, id, fallback = '') => {
  const found = arr(list).find((x) => x && x.id === id);
  return found ? found.label : fallback;
};

export const fuelLabel = (id) => labelFrom(FUEL_LEVELS, id, '—');
export const damageKindLabel = (id) => labelFrom(DAMAGE_KINDS, id, '—');
export const damageScopeLabel = (id) => labelFrom(DAMAGE_SCOPES, id, 'По случаю');
export const zoneLabel = (id) => labelFrom(DAMAGE_ZONES, id, id || '—');

// Зоны, сгруппированные для колонок интерфейса: [{ group, zones: [...] }].
export function groupZones(zones = DAMAGE_ZONES) {
  const order = [];
  const map = new Map();
  for (const z of arr(zones)) {
    const g = str(z.group) || 'Прочее';
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    map.get(g).push(z);
  }
  return order.map((g) => ({ group: g, zones: map.get(g) }));
}

// Строки таблицы повреждений для акта — уже с подписями и в порядке справочника
// зон (а не в порядке кликов приёмщика).
export function damageRows(intake) {
  const index = new Map(DAMAGE_ZONES.map((z, i) => [z.id, i]));
  return arr(intake?.damages)
    .slice()
    .sort((a, b) => (index.get(a.zone) ?? 999) - (index.get(b.zone) ?? 999))
    .map((d) => ({
      zone: zoneLabel(d.zone),
      kind: damageKindLabel(d.kind),
      scope: damageScopeLabel(d.scope),
      isOld: d.scope === 'old',
      note: str(d.note),
    }));
}

// ms → 'ГГГГ-ММ-ДД' в МЕСТНОМ времени (формат, который ждёт formatDocDate).
function isoDay(ms) {
  const t = num(ms);
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Снимок для печатного акта. Как и остальные документы проекта — «замороженные»
// данные: компонент листа ничего не дочитывает сам.
export function buildIntakeActSnapshot(job, company, { docNumber = '', docDate = 0, acceptedBy = '' } = {}) {
  const intake = readIntake(job);
  const docSet = new Set(intake.docs);
  const eqSet = new Set(intake.equipment);
  return {
    doc_number: str(docNumber) || str(intake.act_number),
    doc_date: isoDay(num(docDate) || num(intake.act_date) || 0),
    accepted_by: str(acceptedBy),
    company: company || {},
    customer: {
      name: str(job?.client_name),
      phone: str(job?.client_phone),
    },
    vehicle: {
      car_model: str(job?.car_model),
      plate_number: str(job?.plate_number),
      vin: str(job?.vin),
      year: str(job?.year),
      color: str(job?.color),
    },
    insurance: {
      payment_type: str(job?.payment_type) || 'cash',
      insurer_name: str(job?.insurer_name),
      claim_number: str(job?.claim_number),
      policy_type: str(job?.policy_type),
      order_number: str(job?.order_number),
    },
    condition: {
      mileage: str(intake.mileage),
      fuel: str(intake.fuel),
      fuel_label: fuelLabel(intake.fuel),
      keys: str(intake.keys),
    },
    docs: DOC_ITEMS.map((d) => ({ label: d.label, present: docSet.has(d.id) })),
    equipment: EQUIPMENT_ITEMS.map((e) => ({ label: e.label, present: eqSet.has(e.id) })),
    damages: damageRows(intake),
    notes: str(intake.notes),
    act_text: ACT_TEXT,
    photos_count: arr(job?.photos).filter((p) => photoSlotId(p?.category)).length,
  };
}
