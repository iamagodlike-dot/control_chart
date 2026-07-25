// Проверяет логику экрана «Настройки → Телеграм-бот». Без зависимостей —
// запуск:  node --test src/botSettings.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBotSettings, defaultBotSettings, isValidTgId, tgIdError,
  peopleWithRole, roleCounts, recipientsOf, timeInMoscow, tzOffsetMinutes,
  botStatusInfo, commandStatusText, commandTone, agoText, parseTime,
} from './botSettings.js';

test('пустая база — работаем по умолчаниям', () => {
  const s = normalizeBotSettings(null);
  assert.deepEqual(s.people, []);
  assert.equal(s.schedules.summary.time, '10:00');
  assert.equal(s.schedules.summary.tz, 'Asia/Krasnoyarsk');
  assert.equal(s.schedules.summary.enabled, true);
  assert.equal(s.pushes.newCar, true);
});

test('пустой список людей — это выбор владельца, а не «нет данных»', () => {
  assert.deepEqual(normalizeBotSettings({ people: [] }).people, []);
  // …а вот отсутствие поля — повод взять умолчание
  assert.deepEqual(normalizeBotSettings({}).people, defaultBotSettings().people);
});

test('битые записи людей отбрасываются, хорошие чистятся', () => {
  const s = normalizeBotSettings({
    people: [
      { tg_id: ' 103056371 ', name: '  Роман  ', roles: ['manager', 'manager', 'выдумка'], active: true },
      { tg_id: '@nickname', name: 'По нику нельзя', roles: ['manager'] },
      { tg_id: '12', roles: ['staff'] },
      { tg_id: '835906867', roles: ['partsman'], active: false },
      null,
      'мусор',
    ],
  });
  assert.equal(s.people.length, 2);
  assert.deepEqual(s.people[0], { tg_id: '103056371', name: 'Роман', roles: ['manager'], active: true });
  assert.equal(s.people[1].active, false);
});

test('время: кривое заменяется умолчанием, короткое дополняется нулём', () => {
  assert.deepEqual(parseTime('7:5'), { hour: 7, minute: 5 });
  assert.equal(parseTime('25:00'), null);
  assert.equal(parseTime('чепуха'), null);
  const s = normalizeBotSettings({
    schedules: { summary: { time: '7:5' }, reminder: { time: '99:99' } },
  });
  assert.equal(s.schedules.summary.time, '07:05');
  assert.equal(s.schedules.reminder.time, '18:00');
});

test('выключенная рассылка и выключённый пуш сохраняются', () => {
  const s = normalizeBotSettings({
    schedules: { reminder: { enabled: false, time: '18:00' } },
    pushes: { newCar: false },
  });
  assert.equal(s.schedules.reminder.enabled, false);
  assert.equal(s.pushes.newCar, false);
  assert.equal(s.pushes.ready, true, 'не упомянутый пуш остаётся включённым');
});

test('получатели разбора почты: пусто — всем управляющим, выбор — только выбранным', () => {
  const base = normalizeBotSettings({
    people: [
      { tg_id: '111111111', name: 'Первый', roles: ['manager'] },
      { tg_id: '222222222', name: 'Второй', roles: ['manager'] },
      { tg_id: '333333333', name: 'Учредитель', roles: ['founder'] },
      { tg_id: '444444444', name: 'Отключённый', roles: ['manager'], active: false },
    ],
  });
  assert.deepEqual(recipientsOf(base, 'mailDigest').map((p) => p.tg_id), ['111111111', '222222222']);

  const picked = normalizeBotSettings({
    ...base,
    schedules: { mailDigest: { time: '18:00', to: ['222222222'] } },
  });
  assert.deepEqual(recipientsOf(picked, 'mailDigest').map((p) => p.tg_id), ['222222222']);
  // Сводка учредителя всегда идёт учредителям — выбор людей там не предусмотрен
  assert.deepEqual(recipientsOf(picked, 'founderDigest').map((p) => p.tg_id), ['333333333']);
});

test('отключённый человек не считается ни в одной роли', () => {
  const people = normalizeBotSettings({
    people: [
      { tg_id: '111111111', roles: ['manager', 'founder'] },
      { tg_id: '222222222', roles: ['manager'], active: false },
    ],
  }).people;
  assert.equal(peopleWithRole(people, 'manager').length, 1);
  assert.deepEqual(roleCounts(people), { manager: 1, founder: 1, partsman: 0, staff: 0 });
});

test('Telegram ID: цифры да, ники нет', () => {
  assert.equal(isValidTgId('103056371'), true);
  assert.equal(isValidTgId('@roman'), false);
  assert.equal(isValidTgId(''), false);
  assert.match(tgIdError('@roman'), /ник/);
  assert.match(tgIdError(''), /Введите/);
  assert.equal(tgIdError('103056371'), '');
});

test('подсказка «сколько это по Москве»', () => {
  // В России нет перехода на летнее время, поэтому разница постоянная: Крск = МСК+4
  assert.equal(tzOffsetMinutes('Europe/Moscow'), 180);
  assert.equal(tzOffsetMinutes('Asia/Krasnoyarsk'), 420);
  assert.equal(timeInMoscow('10:00', 'Asia/Krasnoyarsk'), '06:00');
  assert.equal(timeInMoscow('18:00', 'Asia/Krasnoyarsk'), '14:00');
  assert.equal(timeInMoscow('02:00', 'Asia/Krasnoyarsk'), '22:00', 'переход через полночь');
  assert.equal(timeInMoscow('09:00', 'Europe/Moscow'), '09:00');
  assert.equal(timeInMoscow('чепуха', 'Europe/Moscow'), '');
});

test('состояние бота по отметке «жив»', () => {
  const now = 1_700_000_000_000;
  assert.equal(botStatusInfo(null, now).state, 'unknown');
  assert.equal(botStatusInfo({ online_at: now - 60_000, username: 'infobot' }, now).state, 'online');
  assert.equal(botStatusInfo({ online_at: now - 4 * 60_000 }, now).state, 'online');
  const dead = botStatusInfo({ online_at: now - 3 * 60 * 60_000 }, now);
  assert.equal(dead.state, 'offline');
  assert.match(dead.detail, /3 часа назад/);
});

test('человеческое «сколько прошло»', () => {
  assert.equal(agoText(30_000), 'только что');
  assert.equal(agoText(60_000), '1 минуту назад');
  assert.equal(agoText(3 * 60_000), '3 минуты назад');
  assert.equal(agoText(11 * 60_000), '11 минут назад');
  assert.equal(agoText(60 * 60_000), '1 час назад');
  assert.equal(agoText(25 * 60 * 60_000), '1 день назад');
});

test('ответ бота на задание с сайта', () => {
  const now = 1_700_000_000_000;
  assert.equal(commandStatusText({ status: 'pending', created_at: now }, now), 'Отправляю…');
  assert.match(commandStatusText({ status: 'pending', created_at: now - 60_000 }, now), /не ответил/);
  assert.equal(commandStatusText({ status: 'done', result: 'Доставлено: 2' }, now), 'Доставлено: 2');
  assert.match(commandStatusText({ status: 'error', result: 'не найден чат' }, now), /Не получилось/);
});

test('цвет ответа зависит от текста, а не только от «выполнено»', () => {
  const now = 1_700_000_000_000;
  const done = (result) => commandTone({ status: 'done', result }, now);
  assert.equal(done('Доставлено: 2'), 'ok');
  // Бот отчитался честно: задание выполнено, но сообщение никому не дошло —
  // зелёным это красить нельзя.
  assert.equal(done('Не доставлено: 777000111 — не найден чат'), 'bad');
  assert.equal(done('Доставлено: 1. Не дошло: 222 — бота заблокировали'), 'warn');
  assert.equal(done('некому отправлять — нет управляющих'), 'warn');
  assert.equal(done('напоминать сегодня не о чем — сообщение не отправлено'), 'warn');
  assert.equal(commandTone({ status: 'error', result: 'что-то сломалось' }, now), 'bad');
  assert.equal(commandTone({ status: 'pending', created_at: now }, now), 'wait');
  assert.equal(commandTone({ status: 'pending', created_at: now - 60_000 }, now), 'bad');
});
