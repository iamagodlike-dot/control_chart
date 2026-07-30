'use strict';
const { esc, carLabel, plural } = require('./format');

// ─── Дефектовка: утренние напоминания мастеру-приёмщику ──────────────────────
//
// Зеркало логики экрана «Дефектовка» на сайте (client/src/intake.js). Правила
// продублированы сознательно — как money.js повторяет invoices.js: бот не может
// импортировать ES-модули сайта. МЕНЯЯ ПРАВИЛА, ПРАВЬТЕ ОБА ФАЙЛА, иначе бот
// начнёт напоминать не о том, что показывает экран.
//
// Одно сообщение утром отвечает приёмщику на четыре вопроса:
//   • кто приезжает сегодня (и подтверждён ли приезд);
//   • кому позвонить сегодня, потому что дефектовка завтра;
//   • кто не приехал и до сих пор не перенесён;
//   • кто вообще ждёт приглашения (и кто ждёт неприлично долго).
//
// ЧАСОВОЙ ПОЯС ЗАДАЁТСЯ ЯВНО. «Сегодня» и «завтра» считаются по поясу сервиса
// (Красноярск), а не по времени сервера: рассылка уходит в 9 утра по Красноярску,
// то есть в 2 часа ночи UTC, — на сервере в UTC это ещё «вчера», и вся сводка
// сдвинулась бы на день. Поэтому все календарные вычисления идут через Intl с
// нужной зоной, а не через локальный Date.

const DAY_MS = 86400000;
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// Те же пороги, что на сайте (INVITE_WARN_DAYS / INVITE_ALERT_DAYS).
const INVITE_ALERT_DAYS = 3;

// Сколько строк максимум в одном разделе: у сообщения Telegram есть предел длины,
// а «ждут приглашения» в запущенном случае бывает и тридцать.
const LIST_LIMIT = 12;

const pad = (n) => String(n).padStart(2, '0');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Разбор момента на календарные части В НУЖНОМ ПОЯСЕ.
function zoned(ms, tz) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(num(ms))).map((x) => [x.type, x.value]));
  // hour12:false в части движков отдаёт «24» вместо «00» — приводим к 0..23.
  return { y: +p.year, m: +p.month, d: +p.day, hh: (+p.hour) % 24, mm: +p.minute };
}

// Номер календарного дня (целое). Разница двух номеров = сутки между датами,
// независимо от времени внутри дня и от перехода через месяц или год.
function dayIndex(ms, tz) {
  const { y, m, d } = zoned(ms, tz);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

const dayDiff = (fromMs, toMs, tz) => dayIndex(toMs, tz) - dayIndex(fromMs, tz);

function fmtTime(ms, tz) {
  const { hh, mm } = zoned(ms, tz);
  return `${pad(hh)}:${pad(mm)}`;
}

function fmtDay(ms, tz) {
  const { m, d } = zoned(ms, tz);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

const fmtDayTime = (ms, tz) => `${fmtDay(ms, tz)}, ${fmtTime(ms, tz)}`;

// «пятница, 31 июля» — подзаголовок сводки. Через Intl, чтобы не держать таблицу
// падежей: у месяцев в этой форме родительный падеж («31 июля», не «31 июль»).
function fmtHeaderDate(ms, tz) {
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })
      .format(new Date(num(ms)));
  } catch {
    return fmtDay(ms, tz);
  }
}

// ─── Отбор машин ─────────────────────────────────────────────────────────────

// Машина на экране приёмщика? Та же проверка, что isOnIntake на сайте: фаза
// «согласование» + под-статус «Осмотр / дефектовка» (пустой статус = осмотр).
function isOnIntake(job) {
  if (!job || job.archived) return false;
  if (job.phase !== 'approval') return false;
  const st = typeof job.approval_status === 'string' ? job.approval_status : '';
  return (st || 'inspection') === 'inspection';
}

const intakeOf = (job) => (job && typeof job.intake === 'object' && job.intake ? job.intake : {});

// Подтверждение привязано к дате, на которую подтверждали: после переноса оно не
// считается (та же isConfirmed, что на сайте).
function isConfirmed(intake) {
  const scheduled = num(intake.scheduled_at);
  return !!(num(intake.confirmed_at) && scheduled && num(intake.confirmed_for) === scheduled);
}

// Состояние одной машины — тот же набор фаз, что у intakeRow на сайте.
function row(job, nowMs, tz) {
  const intake = intakeOf(job);
  const scheduled = num(intake.scheduled_at);
  const since = num(job.approval_since) || num(job.created_at) || 0;
  const dueDiff = scheduled ? dayDiff(nowMs, scheduled, tz) : null;

  let phase;
  if (num(intake.started_at)) phase = 'started';
  else if (!scheduled) phase = 'invite';
  else if (dueDiff < 0) phase = 'overdue';
  else phase = 'scheduled';

  return {
    job,
    phase,
    scheduled,
    dueDiff,
    confirmed: isConfirmed(intake),
    daysWaiting: since ? Math.max(0, dayDiff(since, nowMs, tz)) : 0,
  };
}

// ─── Текст сводки ────────────────────────────────────────────────────────────

const phone = (job) => (job.client_phone ? ` · ${esc(job.client_phone)}` : '');
const who = (job) => (job.client_name ? ` · ${esc(job.client_name)}` : '');

// Строки раздела с обрезкой хвоста — иначе сообщение не влезет в Telegram.
function pushList(lines, items, render) {
  items.slice(0, LIST_LIMIT).forEach((r) => lines.push(render(r)));
  if (items.length > LIST_LIMIT) lines.push(`  …и ещё ${items.length - LIST_LIMIT}`);
  lines.push('');
}

// Собирает сообщение из уже прочитанных машин. Чистая функция (ни базы, ни сети) —
// её же гоняют тесты: node --test intake.test.js
//
// Возвращает null, когда сказать нечего вовсе: пустая ежедневная рассылка «дел
// нет» быстро приучает не открывать сообщения бота.
function buildIntakeDigestText(jobs, { nowMs = Date.now(), tz = 'Asia/Krasnoyarsk' } = {}) {
  const rows = (Array.isArray(jobs) ? jobs : []).filter(isOnIntake).map((j) => row(j, nowMs, tz));

  const today = rows.filter((r) => r.phase === 'scheduled' && r.dueDiff === 0)
    .sort((a, b) => a.scheduled - b.scheduled);
  const callToday = rows.filter((r) => r.phase === 'scheduled' && r.dueDiff === 1 && !r.confirmed)
    .sort((a, b) => a.scheduled - b.scheduled);
  const overdue = rows.filter((r) => r.phase === 'overdue')
    .sort((a, b) => a.scheduled - b.scheduled);
  const waiting = rows.filter((r) => r.phase === 'invite')
    .sort((a, b) => b.daysWaiting - a.daysWaiting);

  if (!today.length && !callToday.length && !overdue.length && !waiting.length) return null;

  const L = ['<b>Дефектовка</b>', fmtHeaderDate(nowMs, tz), ''];

  if (today.length) {
    L.push(`<b>Сегодня приезжают</b> — ${today.length}:`);
    pushList(L, today, (r) => `  • ${fmtTime(r.scheduled, tz)} · ${carLabel(r.job)}${who(r.job)}`
      + (r.confirmed ? ' · подтверждено' : ' · <b>не подтверждено</b>'));
  }

  if (callToday.length) {
    L.push(`<b>Позвонить сегодня</b> — завтра дефектовка, ${callToday.length}:`);
    pushList(L, callToday, (r) => `  • ${fmtTime(r.scheduled, tz)} · ${carLabel(r.job)}${who(r.job)}${phone(r.job)}`);
  }

  if (overdue.length) {
    L.push(`<b>Не приехали</b> — ${overdue.length}:`);
    pushList(L, overdue, (r) => `  • ${fmtDayTime(r.scheduled, tz)} · ${carLabel(r.job)}${who(r.job)}${phone(r.job)}`);
  }

  if (waiting.length) {
    const stale = waiting.filter((r) => r.daysWaiting >= INVITE_ALERT_DAYS).length;
    L.push(`<b>Ждут приглашения</b> — ${waiting.length}${stale ? ` (дольше ${INVITE_ALERT_DAYS} дней: ${stale})` : ''}:`);
    pushList(L, waiting, (r) => {
      const d = r.daysWaiting;
      const age = d === 0 ? 'заехала сегодня' : `${d} ${plural(d, 'день', 'дня', 'дней')}`;
      return `  • ${age} · ${carLabel(r.job)}${who(r.job)}${phone(r.job)}`;
    });
  }

  return L.join('\n').trimEnd();
}

// Читаем ТОЛЬКО машины, а не весь граф базы (loadGraph тянет пять коллекций):
// сводке приёмщика этапы, посты и документы не нужны, а бесплатная квота чтений
// у проекта не бесконечная.
//
// data.js требуем ВНУТРИ функции, а не сверху файла: он тянет за собой firebase и
// сервисный ключ, а без этого груза модуль остаётся чистым и гоняется тестами.
async function intakeDigest({ nowMs = Date.now(), tz = 'Asia/Krasnoyarsk' } = {}) {
  const { listJobs } = require('./data');
  const jobs = await listJobs();
  return buildIntakeDigestText(jobs, { nowMs, tz });
}

module.exports = {
  intakeDigest,
  buildIntakeDigestText,
  // Наружу — для тестов и на случай, если понадобится в других экранах бота.
  isOnIntake,
  isConfirmed,
  dayDiff,
  dayIndex,
  fmtTime,
  fmtDay,
  fmtDayTime,
  INVITE_ALERT_DAYS,
  LIST_LIMIT,
};
