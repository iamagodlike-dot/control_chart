// Guards the «История приёмки» view-model. Zero-dependency —
// run with:  node --test src/receivingHistory.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceivingHistory } from './receivingHistory.js';

const jobs = [
  {
    id: 'j1', car_model: 'Toyota Camry', plate: 'A123AA', order_number: '101', client_name: 'Смирнов',
    parts: [
      {
        id: 'p1', name: 'Бампер', code: 'BMP', status: 'in',
        receiving_log: [
          { status: 'ordered', at: 1000, by: 'anna@a.ru' },
          { status: 'arrived', at: 2000, by: 'anna@a.ru' },
          { status: 'in', at: 3000, by: 'ivan@a.ru' },
        ],
      },
      {
        id: 'p2', name: 'Фара', code: 'FAR', status: 'arrived',
        receiving_log: [{ status: 'arrived', at: 2500, by: 'ivan@a.ru' }],
      },
    ],
    photos: [
      { id: 'ph1', category: 'receiving', partId: 'p1', url: '/u/1', uploaded_at: 3100, uploaded_by: 'ivan@a.ru' },
      { id: 'ph2', category: 'before', partId: 'p1', url: '/u/x', uploaded_at: 9999 }, // не приёмка → игнор
      { id: 'ph3', category: 'receiving', url: '/u/y', uploaded_at: 8888 },            // без partId → игнор
    ],
  },
  {
    id: 'j2', car_model: 'Kia Rio', archived: true,
    parts: [
      { id: 'p3', name: 'Капот', status: 'in', receiving_log: [{ status: 'in', at: 500, by: 'anna@a.ru' }] },
      { id: 'p4', name: 'Дверь', status: 'need' }, // нет лога → нет событий
    ],
  },
];

test('flattens status log + receiving photos into one feed, newest first', () => {
  const { events } = buildReceivingHistory(jobs, {});
  // p1: 3 status + p2: 1 status + j2/p3: 1 status = 5 status; +1 receiving photo = 6.
  assert.equal(events.length, 6);
  assert.deepEqual(events.map((e) => e.at), [3100, 3000, 2500, 2000, 1000, 500]);
  assert.equal(events[0].kind, 'photo');   // ph1 @3100 is newest
  assert.equal(events[1].status, 'in');    // p1 → in @3000
});

test('counts every event kind across all jobs (ignoring need / non-receiving photos)', () => {
  const { counts } = buildReceivingHistory(jobs, {});
  assert.equal(counts.ordered, 1);
  assert.equal(counts.arrived, 2); // p1@2000, p2@2500
  assert.equal(counts.in, 2);      // p1@3000, p3@500
  assert.equal(counts.photo, 1);   // ph1 only
  assert.equal(counts.total, 6);
});

test("filter by status shows only that status; 'photo' shows only photos", () => {
  assert.deepEqual(
    buildReceivingHistory(jobs, { filter: 'in' }).events.map((e) => e.partName),
    ['Бампер', 'Капот'],
  );
  const photos = buildReceivingHistory(jobs, { filter: 'photo' }).events;
  assert.equal(photos.length, 1);
  assert.equal(photos[0].kind, 'photo');
  assert.equal(photos[0].photo.id, 'ph1');
});

test('search matches car / plate / ЗН / client / part / person', () => {
  assert.ok(buildReceivingHistory(jobs, { query: 'camry' }).events.length === 6 - 1); // j2 excluded
  assert.equal(buildReceivingHistory(jobs, { query: 'kia' }).events.length, 1);        // only j2/p3
  assert.ok(buildReceivingHistory(jobs, { query: 'ivan' }).events.every((e) => e.by === 'ivan@a.ru'));
  assert.equal(buildReceivingHistory(jobs, { query: 'фара' }).events.length, 1);
});

test('event carries car context + archived flag', () => {
  const { events } = buildReceivingHistory(jobs, { filter: 'in' });
  const camry = events.find((e) => e.car === 'Toyota Camry');
  assert.equal(camry.plate, 'A123AA');
  assert.equal(camry.orderNum, '101');
  assert.equal(camry.archived, false);
  const kia = events.find((e) => e.car === 'Kia Rio');
  assert.equal(kia.archived, true);
});

test('photo for a since-deleted part still lists, labelled «Запчасть удалена»', () => {
  const orphan = [{
    id: 'jo', car_model: 'Lada', parts: [],
    photos: [{ id: 'g1', category: 'receiving', partId: 'gone', url: '/u/g', uploaded_at: 10, uploaded_by: 'x@a.ru' }],
  }];
  const { events } = buildReceivingHistory(orphan, {});
  assert.equal(events.length, 1);
  assert.equal(events[0].partName, 'Запчасть удалена');
});

test('entries without a usable timestamp are dropped, not crashed', () => {
  const bad = [{
    id: 'jb', car_model: 'Niva',
    parts: [{ id: 'pb', name: 'X', receiving_log: [{ status: 'in' }, { status: 'in', at: 5, by: null }] }],
  }];
  const { events } = buildReceivingHistory(bad, {});
  assert.equal(events.length, 1); // the at-less entry is skipped
  assert.equal(events[0].at, 5);
});

test('empty / missing input handled without throwing', () => {
  assert.deepEqual(buildReceivingHistory([], {}).events, []);
  assert.deepEqual(buildReceivingHistory(null, {}).events, []);
  assert.deepEqual(buildReceivingHistory([{ id: 'x' }], {}).events, []);
  assert.equal(buildReceivingHistory([{ id: 'x' }], {}).counts.total, 0);
});
