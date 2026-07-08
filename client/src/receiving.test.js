// Guards the expeditor receiving view-model. Zero-dependency —
// run with:  node --test src/receiving.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiving } from './receiving.js';

const jobs = [
  {
    id: 'j1', car_model: 'Toyota Camry', plate: 'A123AA', order_number: '101',
    cell_ids: ['A1'],
    parts: [
      { id: 'p1', name: 'Бампер', code: 'BMP', qty: 1, supplier: 'Exist', status: 'ordered' },
      { id: 'p2', name: 'Фара', code: 'FAR', qty: 2, status: 'in' }, // без поставщика
      { id: 'p3', name: 'Крыло', status: 'need' },     // not shipped → ignored
      { id: 'p4', name: 'Решётка', status: 'issued' }, // already taken → ignored
    ],
  },
  {
    id: 'j2', car_model: 'Kia Rio', cell_id: 'B2',      // legacy single-cell field
    parts: [{ id: 'p5', name: 'Капот', qty: 1, status: 'in' }],
  },
  {
    id: 'j3', car_model: 'BMW X5', // no cell assigned
    parts: [{ id: 'p6', name: 'Дверь', qty: 1, status: 'ordered' }],
  },
];

test('counts ordered vs in across all jobs (ignoring need/issued)', () => {
  const { counts } = buildReceiving(jobs,'all');
  assert.equal(counts.ordered, 2); // p1, p6
  assert.equal(counts.in, 2);      // p2, p5
  assert.equal(counts.total, 4);
});

test("filter 'ordered' shows only ordered parts, drops cars without them", () => {
  const { groups } = buildReceiving(jobs,'ordered');
  const ids = groups.flatMap((g) => g.parts.map((p) => p.id));
  assert.deepEqual(ids.sort(), ['p1', 'p6']);
  assert.ok(!groups.some((g) => g.jobId === 'j2')); // j2 has only 'in' → hidden
});

test("filter 'in' shows only arrived parts", () => {
  const { groups } = buildReceiving(jobs,'in');
  const ids = groups.flatMap((g) => g.parts.map((p) => p.id));
  assert.deepEqual(ids.sort(), ['p2', 'p5']);
});

test('supplier is passed through (where to pick up); absent → empty string', () => {
  const { groups } = buildReceiving(jobs, 'all');
  const j1 = groups.find((g) => g.jobId === 'j1');
  const p1 = j1.parts.find((p) => p.id === 'p1');
  const p2 = j1.parts.find((p) => p.id === 'p2');
  assert.equal(p1.supplier, 'Exist');
  assert.equal(p2.supplier, '');
});

test('cell ids come from cell_ids and legacy cell_id; missing → hasCell false', () => {
  const { groups } = buildReceiving(jobs,'all');
  const j1 = groups.find((g) => g.jobId === 'j1');
  const j2 = groups.find((g) => g.jobId === 'j2');
  const j3 = groups.find((g) => g.jobId === 'j3');
  assert.deepEqual(j1.cellIds, ['A1']);
  assert.equal(j1.hasCell, true);
  assert.deepEqual(j2.cellIds, ['B2']);
  assert.equal(j3.hasCell, false);
});

test('cars still waiting for deliveries sort before fully-arrived cars', () => {
  const { groups } = buildReceiving(jobs,'all');
  // j1 (has ordered) and j3 (ordered) are waiting; j2 (only in) is not.
  assert.equal(groups[groups.length - 1].jobId, 'j2');
  assert.ok(groups.slice(0, -1).every((g) => g.waiting));
});

test('empty / missing parts handled without throwing', () => {
  assert.deepEqual(buildReceiving([], 'all').groups, []);
  assert.deepEqual(buildReceiving([{ id: 'x' }], 'all').groups, []);
  assert.deepEqual(buildReceiving(null, 'all').groups, []);
});
