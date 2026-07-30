// Тесты экрана мастера-приёмщика (диспетчерская дефектовки).
//
// Запуск:  node --test src/intake.test.js
//
// Все даты собираются через new Date(год, месяц, день, час) — то есть в МЕСТНОМ
// времени машины, на которой идут тесты. Так проверяется именно то, что важно на
// бою: «завтра» и клетки календаря считаются по местным суткам, а не по UTC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALENDAR_WEEKS, INVITE_ALERT_DAYS, INVITE_WARN_DAYS, MIN_REASON_LEN,
  addDays, buildIntakeBoard, buildReminders, buildWeeks, dayDiff, dayKey,
  describeLogEntry, emptyIntake, fmtDayTime, fmtRelativeDay, intakeRow, isConfirmed,
  isOnIntake, parseLocalDateTime, readIntake, startOfDay, startOfWeek, toLocalInput,
  validateSchedule, waitingSince,
} from './intake.js';

// Среда, 12 августа 2026, 10:00 по местному времени.
const NOW = new Date(2026, 7, 12, 10, 0).getTime();
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();

// Машина на осмотре: минимум полей, которые смотрит экран.
function car(over = {}) {
  return {
    id: 'j1',
    phase: 'approval',
    approval_status: 'inspection',
    car_model: 'Geely Atlas',
    plate_number: 'А123ВС124',
    client_name: 'Иванов И.',
    client_phone: '+7 900 000-00-00',
    payment_type: 'insurance',
    insurer_name: 'Ингосстрах',
    created_at: at(2026, 8, 11, 9, 0),
    ...over,
  };
}

// ─── Календарные сутки ───────────────────────────────────────────────────────

test('startOfDay — полночь того же дня, а не UTC', () => {
  const night = at(2026, 8, 12, 23, 50);
  assert.equal(startOfDay(night), at(2026, 8, 12));
  assert.equal(new Date(startOfDay(night)).getDate(), 12);
  assert.equal(startOfDay(0), 0);
});

test('dayKey — местная дата (ночная запись не уезжает во вчера)', () => {
  assert.equal(dayKey(at(2026, 8, 12, 23, 50)), '2026-08-12');
  assert.equal(dayKey(at(2026, 8, 13, 0, 10)), '2026-08-13');
  assert.equal(dayKey(0), '');
});

test('dayDiff — считает наступившие полночи, а не разницу в часах', () => {
  // 20 минут разницы, но это разные сутки → один день.
  assert.equal(dayDiff(at(2026, 8, 12, 23, 50), at(2026, 8, 13, 0, 10)), 1);
  // 23 часа разницы внутри одних суток → ноль.
  assert.equal(dayDiff(at(2026, 8, 12, 0, 30), at(2026, 8, 12, 23, 30)), 0);
  assert.equal(dayDiff(at(2026, 8, 12), at(2026, 8, 10)), -2);
});

test('startOfWeek — понедельник; воскресенье относится к своей неделе', () => {
  assert.equal(startOfWeek(at(2026, 8, 12, 15, 0)), at(2026, 8, 10));   // ср → пн 10.08
  assert.equal(startOfWeek(at(2026, 8, 10, 0, 1)), at(2026, 8, 10));    // сам пн
  assert.equal(startOfWeek(at(2026, 8, 16, 23, 0)), at(2026, 8, 10));   // вс → тот же пн
});

test('addDays — переход через границу месяца', () => {
  assert.equal(addDays(at(2026, 8, 30), 3), at(2026, 9, 2));
  assert.equal(addDays(at(2026, 8, 2), -3), at(2026, 7, 30));
});

test('parseLocalDateTime и toLocalInput — туда и обратно без сдвига', () => {
  const ms = parseLocalDateTime('2026-08-15T14:30');
  assert.equal(ms, at(2026, 8, 15, 14, 30));
  assert.equal(toLocalInput(ms), '2026-08-15T14:30');
  // Дата без времени = полночь; мусор = 0, а не NaN и не «сегодня».
  assert.equal(parseLocalDateTime('2026-08-15'), at(2026, 8, 15));
  assert.equal(parseLocalDateTime('завтра'), 0);
  assert.equal(parseLocalDateTime(''), 0);
  assert.equal(toLocalInput(0), '');
});

test('подписи дат — человеческие', () => {
  assert.equal(fmtDayTime(at(2026, 8, 15, 9, 5)), '15 авг, 09:05');
  assert.equal(fmtRelativeDay(at(2026, 8, 12, 18, 0), NOW), 'сегодня');
  assert.equal(fmtRelativeDay(at(2026, 8, 13, 8, 0), NOW), 'завтра');
  assert.equal(fmtRelativeDay(at(2026, 8, 17, 8, 0), NOW), 'через 5 дней');
  assert.equal(fmtRelativeDay(at(2026, 8, 11, 8, 0), NOW), 'вчера');
  assert.equal(fmtRelativeDay(at(2026, 8, 9, 8, 0), NOW), '3 дня назад');
});

// ─── Чтение данных машины ────────────────────────────────────────────────────

test('readIntake — у нетронутой машины пустая приёмка, мусор в журнале выбрасывается', () => {
  assert.deepEqual(readIntake(car()), emptyIntake());
  assert.deepEqual(readIntake(null), emptyIntake());

  const i = readIntake(car({
    intake: {
      scheduled_at: at(2026, 8, 14, 11, 0),
      log: [
        null,
        { at: 100, kind: 'invite', to: at(2026, 8, 13, 9, 0) },
        { at: 200, kind: 'move', from: at(2026, 8, 13, 9, 0), to: at(2026, 8, 14, 11, 0), reason: 'клиент в отъезде' },
      ],
    },
  }));
  assert.equal(i.scheduled_at, at(2026, 8, 14, 11, 0));
  assert.equal(i.log.length, 2);
  assert.equal(i.log[0].at, 200);            // свежее сверху
  assert.equal(i.log[0].reason, 'клиент в отъезде');
});

test('подтверждение слетает после переноса — иначе накануне никто не позвонит', () => {
  const day = at(2026, 8, 14, 11, 0);
  assert.ok(isConfirmed({ scheduled_at: day, confirmed_at: NOW, confirmed_for: day }));
  // Перенесли на другое время — подтверждение больше не считается.
  assert.ok(!isConfirmed({ scheduled_at: at(2026, 8, 15, 11, 0), confirmed_at: NOW, confirmed_for: day }));
  assert.ok(!isConfirmed({ scheduled_at: day, confirmed_at: 0, confirmed_for: 0 }));
});

test('isOnIntake — только колонка «Осмотр / дефектовка», архив не в счёт', () => {
  assert.ok(isOnIntake(car()));
  assert.ok(isOnIntake(car({ approval_status: '' })));            // пустой статус = осмотр
  assert.ok(!isOnIntake(car({ approval_status: 'calc' })));
  assert.ok(!isOnIntake(car({ phase: 'repair' })));
  assert.ok(!isOnIntake(car({ archived: true })));
  assert.ok(!isOnIntake(null));
});

test('waitingSince — сначала дата попадания в колонку, потом дата заведения', () => {
  assert.equal(waitingSince(car({ approval_since: 555 })), 555);
  assert.equal(waitingSince(car()), at(2026, 8, 11, 9, 0));
  assert.equal(waitingSince({}), 0);
});

// ─── Состояние машины ────────────────────────────────────────────────────────

test('машина без даты — «пригласить», с днями ожидания', () => {
  const r = intakeRow(car({ approval_since: at(2026, 8, 10, 9, 0) }), NOW);
  assert.equal(r.phase, 'invite');
  assert.equal(r.daysWaiting, 2);
  assert.equal(r.dueDiff, null);
});

test('светофор ожидания: сутки → жёлтый, три дня → красный', () => {
  assert.equal(INVITE_WARN_DAYS, 1);
  assert.equal(INVITE_ALERT_DAYS, 3);
  const sev = (days) => intakeRow(car({ approval_since: addDays(NOW, -days) }), NOW).severity;
  assert.equal(sev(0), 'ok');
  assert.equal(sev(1), 'warn');
  assert.equal(sev(2), 'warn');
  assert.equal(sev(3), 'alert');
  assert.equal(sev(9), 'alert');
});

test('назначенная дата: сегодня и завтра — «назначено», вчера — «просрочено»', () => {
  const row = (ms) => intakeRow(car({ intake: { scheduled_at: ms } }), NOW);
  assert.equal(row(at(2026, 8, 12, 16, 0)).phase, 'scheduled');   // сегодня, позже
  assert.equal(row(at(2026, 8, 12, 8, 0)).phase, 'scheduled');    // сегодня, но утро уже прошло
  assert.equal(row(at(2026, 8, 13, 9, 0)).dueDiff, 1);
  assert.equal(row(at(2026, 8, 11, 9, 0)).phase, 'overdue');
  assert.equal(row(at(2026, 8, 11, 9, 0)).severity, 'alert');
});

test('начатая дефектовка выходит из просрочки', () => {
  const r = intakeRow(car({ intake: { scheduled_at: at(2026, 8, 11, 9, 0), started_at: at(2026, 8, 11, 9, 30) } }), NOW);
  assert.equal(r.phase, 'started');
});

// ─── Сетка календаря ─────────────────────────────────────────────────────────

test('buildWeeks — две недели по семь дней, начиная с понедельника текущей', () => {
  const weeks = buildWeeks(NOW);
  assert.equal(weeks.length, CALENDAR_WEEKS);
  assert.equal(weeks[0].days.length, 7);
  assert.equal(weeks[0].days[0].key, '2026-08-10');
  assert.equal(weeks[0].days[0].weekday, 'Пн');
  assert.equal(weeks[1].days[6].key, '2026-08-23');
  const today = weeks[0].days.find((d) => d.isToday);
  assert.equal(today.key, '2026-08-12');
  assert.ok(weeks[0].days[0].isPast);            // понедельник уже прошёл
  assert.ok(!today.isPast);
  assert.ok(weeks[0].days[5].isWeekend && weeks[0].days[6].isWeekend);
});

// ─── Сборка экрана ───────────────────────────────────────────────────────────

function board(jobs, over = {}) {
  return buildIntakeBoard(jobs, { nowMs: NOW, ...over });
}

test('машины раскладываются по трём зонам, дальние — в «приедут позже»', () => {
  const jobs = [
    car({ id: 'need', intake: null, approval_since: at(2026, 8, 9, 9, 0) }),
    car({ id: 'today', plate_number: 'Б001АА124', intake: { scheduled_at: at(2026, 8, 12, 15, 0) } }),
    car({ id: 'nextweek', plate_number: 'В002АА124', intake: { scheduled_at: at(2026, 8, 20, 9, 0) } }),
    car({ id: 'far', plate_number: 'Г003АА124', intake: { scheduled_at: at(2026, 9, 3, 9, 0) } }),
    car({ id: 'late', plate_number: 'Д004АА124', intake: { scheduled_at: at(2026, 8, 11, 9, 0) } }),
    car({ id: 'other', approval_status: 'calc' }),      // не на осмотре — не наша
  ];
  const b = board(jobs);

  assert.deepEqual(b.invite.map((r) => r.id), ['need']);
  assert.deepEqual(b.later.map((r) => r.id), ['far']);

  const cell = (key) => b.weeks.flatMap((w) => w.days).find((d) => d.key === key);
  assert.deepEqual(cell('2026-08-12').cars.map((r) => r.id), ['today']);
  assert.deepEqual(cell('2026-08-20').cars.map((r) => r.id), ['nextweek']);
  assert.deepEqual(cell('2026-08-11').cars.map((r) => r.id), ['late']);   // просроченная видна в своей клетке
  assert.equal(b.counts.invite, 1);
  assert.equal(b.counts.today, 1);
  assert.equal(b.counts.overdue, 1);
  assert.equal(b.counts.later, 1);
});

test('внутри дня машины идут по времени', () => {
  const jobs = [
    car({ id: 'late', intake: { scheduled_at: at(2026, 8, 14, 16, 0) } }),
    car({ id: 'early', intake: { scheduled_at: at(2026, 8, 14, 9, 30) } }),
    car({ id: 'mid', intake: { scheduled_at: at(2026, 8, 14, 12, 0) } }),
  ];
  const day = board(jobs).weeks.flatMap((w) => w.days).find((d) => d.key === '2026-08-14');
  assert.deepEqual(day.cars.map((r) => r.id), ['early', 'mid', 'late']);
});

test('список приглашений: сначала красные, внутри — кто дольше ждёт', () => {
  const jobs = [
    car({ id: 'fresh', approval_since: NOW }),
    car({ id: 'old', approval_since: addDays(NOW, -9) }),
    car({ id: 'yesterday', approval_since: addDays(NOW, -1) }),
    car({ id: 'stale', approval_since: addDays(NOW, -4) }),
  ];
  assert.deepEqual(board(jobs).invite.map((r) => r.id), ['old', 'stale', 'yesterday', 'fresh']);
  assert.equal(board(jobs).counts.stale, 2);
});

test('машина с датой раньше окна календаря не теряется — её держит напоминание', () => {
  const jobs = [car({ id: 'forgotten', intake: { scheduled_at: at(2026, 8, 3, 9, 0) } })];
  const b = board(jobs);
  const inCells = b.weeks.flatMap((w) => w.days).flatMap((d) => d.cars);
  assert.equal(inCells.length, 0);
  assert.equal(b.later.length, 0);
  assert.deepEqual(b.reminders.map((x) => x.kind), ['overdue']);
  assert.equal(b.reminders[0].row.id, 'forgotten');
});

test('поиск фильтрует зоны, но не прячет напоминания', () => {
  const jobs = [
    car({ id: 'a', plate_number: 'А111АА124', client_name: 'Петров', intake: null }),
    car({ id: 'b', plate_number: 'Б222ББ124', client_name: 'Сидоров', intake: null }),
    car({ id: 'c', plate_number: 'В333ВВ124', client_name: 'Кузнецов', intake: { scheduled_at: at(2026, 8, 11, 9, 0) } }),
  ];
  const b = board(jobs, { query: 'петров' });
  assert.deepEqual(b.invite.map((r) => r.id), ['a']);
  assert.deepEqual(b.reminders.map((x) => x.row.id), ['c']);
  assert.equal(board(jobs, { query: 'Б222' }).invite.length, 1);
  assert.equal(board(jobs, { query: 'ингос' }).invite.length, 2);   // по страховой тоже
});

// ─── Напоминания ─────────────────────────────────────────────────────────────

test('напоминания: просроченные впереди, звонок — только по неподтверждённым', () => {
  const day = at(2026, 8, 13, 10, 0);
  const rows = [
    intakeRow(car({ id: 'call', intake: { scheduled_at: day } }), NOW),
    intakeRow(car({ id: 'confirmed', intake: { scheduled_at: day, confirmed_at: NOW, confirmed_for: day } }), NOW),
    intakeRow(car({ id: 'overdue-old', intake: { scheduled_at: at(2026, 8, 5, 9, 0) } }), NOW),
    intakeRow(car({ id: 'overdue-new', intake: { scheduled_at: at(2026, 8, 11, 9, 0) } }), NOW),
    intakeRow(car({ id: 'later', intake: { scheduled_at: at(2026, 8, 18, 9, 0) } }), NOW),
    intakeRow(car({ id: 'need' }), NOW),
  ];
  const rem = buildReminders(rows);
  assert.deepEqual(rem.map((x) => `${x.kind}:${x.row.id}`), [
    'overdue:overdue-old',
    'overdue:overdue-new',
    'call:call',
  ]);
});

test('напоминание о звонке появляется только накануне, не за три дня', () => {
  const rows = [intakeRow(car({ intake: { scheduled_at: at(2026, 8, 15, 9, 0) } }), NOW)];
  assert.equal(buildReminders(rows).length, 0);
});

// ─── Форма ───────────────────────────────────────────────────────────────────

test('приглашение: нужна только дата, и не в прошлом', () => {
  assert.ok(validateSchedule({ at: at(2026, 8, 14, 10, 0), nowMs: NOW }).ok);
  // Сегодня, но время уже прошло — разрешаем: машину могли привезти утром.
  assert.ok(validateSchedule({ at: at(2026, 8, 12, 8, 0), nowMs: NOW }).ok);
  assert.equal(validateSchedule({ at: 0, nowMs: NOW }).errors.at, 'Укажите дату и время');
  assert.equal(validateSchedule({ at: at(2026, 8, 11, 9, 0), nowMs: NOW }).errors.at, 'Эта дата уже прошла');
});

test('перенос: без чекбокса «согласовано» и без причины не сохранить', () => {
  const base = { at: at(2026, 8, 15, 10, 0), isMove: true, nowMs: NOW };
  const empty = validateSchedule(base);
  assert.ok(!empty.ok);
  assert.ok(empty.errors.agreed);
  assert.ok(empty.errors.reason);

  assert.ok(!validateSchedule({ ...base, agreed: true }).ok);                          // причины нет
  assert.ok(!validateSchedule({ ...base, reason: 'клиент просил' }).ok);               // галочки нет
  assert.ok(!validateSchedule({ ...base, agreed: true, reason: ' '.repeat(9) }).ok);   // пробелы не причина
  assert.ok(validateSchedule({ ...base, agreed: true, reason: 'клиент в отъезде' }).ok);
  assert.ok(MIN_REASON_LEN >= 3);
});

test('журнал читается человеком', () => {
  const to = at(2026, 8, 15, 10, 0);
  const from = at(2026, 8, 13, 9, 0);
  assert.equal(describeLogEntry({ kind: 'invite', to }), 'Записан на 15 авг, 10:00');
  assert.equal(describeLogEntry({ kind: 'move', from, to }), 'Перенос 13 авг, 09:00 → 15 авг, 10:00');
  assert.equal(describeLogEntry({ kind: 'confirm', to }), 'Клиент подтвердил 15 авг, 10:00');
});
