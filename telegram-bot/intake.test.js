'use strict';
// Тесты утренней сводки «Дефектовка». Запуск:  node --test intake.test.js
//
// ВСЕ моменты собираются через Date.UTC — то есть тест не зависит от часового
// пояса машины, на которой запущен. Это здесь главное: сводка обязана считать
// «сегодня» и «завтра» по КРАСНОЯРСКУ, а не по времени сервера (в проде сервер
// живёт в UTC, и рассылка в 8:30 Крск уходит в 1:30 UTC — то есть «вчера»).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIntakeDigestText, dayDiff, isConfirmed, isOnIntake, fmtTime, fmtDayTime,
} = require('./intake');

const KRSK = 'Asia/Krasnoyarsk';   // UTC+7, перехода на летнее время нет
// Красноярское время → абсолютные миллисекунды.
const krsk = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh - 7, mm);

// Среда, 12 августа 2026, 10:00 по Красноярску.
const NOW = krsk(2026, 8, 12, 10, 0);

function car(over = {}) {
  return {
    id: 'j1',
    phase: 'approval',
    approval_status: 'inspection',
    car_model: 'Geely Atlas',
    plate_number: 'А123ВС124',
    client_name: 'Иванов И.',
    client_phone: '+7 900 000-00-00',
    approval_since: krsk(2026, 8, 11, 9, 0),
    ...over,
  };
}

// ─── Часовой пояс ────────────────────────────────────────────────────────────

test('«завтра» считается по Красноярску, а не по времени сервера', () => {
  // 13 августа 01:00 по Красноярску — это ещё 12 августа 18:00 по UTC.
  const nightVisit = krsk(2026, 8, 13, 1, 0);
  assert.equal(dayDiff(NOW, nightVisit, KRSK), 1);   // для сервиса — завтра
  assert.equal(dayDiff(NOW, nightVisit, 'UTC'), 0);  // а по UTC было бы «сегодня»
});

test('дни считаются календарными сутками, а не делением на 24 часа', () => {
  assert.equal(dayDiff(krsk(2026, 8, 12, 23, 50), krsk(2026, 8, 13, 0, 10), KRSK), 1);
  assert.equal(dayDiff(krsk(2026, 8, 12, 0, 30), krsk(2026, 8, 12, 23, 30), KRSK), 0);
  assert.equal(dayDiff(krsk(2026, 8, 12), krsk(2026, 8, 9), KRSK), -3);
});

test('время и дата в сообщении — красноярские', () => {
  assert.equal(fmtTime(krsk(2026, 8, 12, 9, 5), KRSK), '09:05');
  assert.equal(fmtDayTime(krsk(2026, 8, 12, 15, 0), KRSK), '12 авг, 15:00');
  // То же мгновение по UTC — другой час (проверяем, что пояс реально применяется).
  assert.equal(fmtTime(krsk(2026, 8, 12, 9, 5), 'UTC'), '02:05');
});

// ─── Отбор машин ─────────────────────────────────────────────────────────────

test('в сводку попадают только машины из колонки «Осмотр / дефектовка»', () => {
  assert.ok(isOnIntake(car()));
  assert.ok(isOnIntake(car({ approval_status: '' })));
  assert.ok(!isOnIntake(car({ approval_status: 'calc' })));
  assert.ok(!isOnIntake(car({ phase: 'repair' })));
  assert.ok(!isOnIntake(car({ archived: true })));
  assert.ok(!isOnIntake(null));
});

test('подтверждение привязано к дате: после переноса его нет', () => {
  const day = krsk(2026, 8, 13, 10, 0);
  assert.ok(isConfirmed({ scheduled_at: day, confirmed_at: NOW, confirmed_for: day }));
  assert.ok(!isConfirmed({ scheduled_at: krsk(2026, 8, 14, 10, 0), confirmed_at: NOW, confirmed_for: day }));
  assert.ok(!isConfirmed({ scheduled_at: day }));
});

// ─── Текст сводки ────────────────────────────────────────────────────────────

const digest = (jobs) => buildIntakeDigestText(jobs, { nowMs: NOW, tz: KRSK });

test('пустой день — сообщение не собирается вовсе', () => {
  assert.equal(digest([]), null);
  assert.equal(digest([car({ approval_status: 'calc' })]), null);
  // Записанная на будущее машина сама по себе поводом для сводки не является.
  assert.equal(digest([car({ intake: { scheduled_at: krsk(2026, 8, 20, 9, 0) } })]), null);
});

test('четыре раздела: сегодня, позвонить, не приехали, ждут приглашения', () => {
  const text = digest([
    car({ id: 'today', plate_number: 'Б001АА', intake: { scheduled_at: krsk(2026, 8, 12, 15, 0) } }),
    car({
      id: 'today-ok',
      plate_number: 'Б002АА',
      intake: {
        scheduled_at: krsk(2026, 8, 12, 17, 30),
        confirmed_at: NOW,
        confirmed_for: krsk(2026, 8, 12, 17, 30),
      },
    }),
    car({ id: 'call', plate_number: 'В003АА', intake: { scheduled_at: krsk(2026, 8, 13, 10, 0) } }),
    car({ id: 'overdue', plate_number: 'Г004АА', intake: { scheduled_at: krsk(2026, 8, 11, 9, 0) } }),
    car({ id: 'wait', plate_number: 'Д005АА', approval_since: krsk(2026, 8, 6, 9, 0) }),
  ]);

  assert.match(text, /<b>Сегодня приезжают<\/b> — 2/);
  assert.match(text, /15:00 .*Б001АА.*не подтверждено/);
  assert.match(text, /17:30 .*Б002АА.*· подтверждено/);
  assert.match(text, /<b>Позвонить сегодня<\/b> — завтра дефектовка, 1/);
  assert.match(text, /10:00 .*В003АА/);
  assert.match(text, /<b>Не приехали<\/b> — 1/);
  assert.match(text, /11 авг, 09:00 .*Г004АА/);
  assert.match(text, /<b>Ждут приглашения<\/b> — 1 \(дольше 3 дней: 1\)/);
  assert.match(text, /6 дней .*Д005АА/);
  // Заголовок с днём недели — по Красноярску.
  assert.match(text, /среда, 12 августа/);
});

test('подтверждённая на завтра машина в «позвонить» не попадает', () => {
  const day = krsk(2026, 8, 13, 10, 0);
  const text = digest([
    car({ id: 'ok', intake: { scheduled_at: day, confirmed_at: NOW, confirmed_for: day } }),
  ]);
  assert.equal(text, null);   // больше в сводке ничего нет — она и не собирается
});

test('начатая дефектовка не считается неприехавшей', () => {
  const text = digest([
    car({ intake: { scheduled_at: krsk(2026, 8, 11, 9, 0), started_at: krsk(2026, 8, 11, 9, 30) } }),
  ]);
  assert.equal(text, null);
});

test('внутри раздела машины идут по времени, длинный хвост обрезается', () => {
  const many = Array.from({ length: 15 }, (_, i) => car({
    id: `w${i}`,
    plate_number: `Ц${String(i).padStart(3, '0')}ЦЦ`,
    // Чем больше индекс, тем дольше ждёт — сверху должен оказаться последний.
    approval_since: krsk(2026, 8, 11 - i, 9, 0),
  }));
  const text = digest(many);
  assert.match(text, /<b>Ждут приглашения<\/b> — 15/);
  assert.match(text, /…и ещё 3/);
  const first = text.split('\n').find((l) => l.includes('Ц'));
  assert.ok(first.includes('Ц014ЦЦ'), `сверху должна быть самая давняя, а не ${first}`);
});

test('телефон и клиент попадают в строку — по ним и звонят', () => {
  const text = digest([car({
    id: 'call', client_name: 'Орлова С. П.', client_phone: '+7 908 201-33-45',
    intake: { scheduled_at: krsk(2026, 8, 13, 10, 0) },
  })]);
  assert.match(text, /Орлова С\. П\./);
  assert.match(text, /\+7 908 201-33-45/);
});
