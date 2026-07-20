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
  {
    id: 'j4', car_model: 'Audi Q7', plate: 'O777OO', order_number: '120',
    cell_ids: ['C3'],
    parts: [{ id: 'p7', name: 'Зеркало', qty: 1, supplier: 'Emex', status: 'arrived' }], // доехало до ТК
  },
];

test('counts ordered / arrived / in across all jobs (ignoring need/issued)', () => {
  const { counts } = buildReceiving(jobs,'all');
  assert.equal(counts.ordered, 2); // p1, p6
  assert.equal(counts.arrived, 1); // p7
  assert.equal(counts.in, 2);      // p2, p5
  assert.equal(counts.total, 5);
});

test("filter 'ordered' shows only ordered parts, drops cars without them", () => {
  const { groups } = buildReceiving(jobs,'ordered');
  const ids = groups.flatMap((g) => g.parts.map((p) => p.id));
  assert.deepEqual(ids.sort(), ['p1', 'p6']);
  assert.ok(!groups.some((g) => g.jobId === 'j2')); // j2 has only 'in' → hidden
});

test("filter 'arrived' shows only parts waiting for pickup at the ТК", () => {
  const { groups } = buildReceiving(jobs,'arrived');
  const ids = groups.flatMap((g) => g.parts.map((p) => p.id));
  assert.deepEqual(ids.sort(), ['p7']);
  assert.equal(groups[0].jobId, 'j4');
  assert.equal(groups[0].readyPickup, true);
});

test("filter 'in' shows only parts already on our shelves", () => {
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

test('sort: «есть что забрать» → «ждём в пути» → «всё на складе»', () => {
  const { groups } = buildReceiving(jobs,'all');
  // j4 (arrived) — забрать, вверх; j1/j3 (ordered) — в пути; j2 (только in) — вниз.
  assert.equal(groups[0].jobId, 'j4');           // readyPickup floats to the very top
  assert.equal(groups[0].readyPickup, true);
  assert.equal(groups[groups.length - 1].jobId, 'j2'); // fully-stocked sinks to the bottom
  assert.ok(groups.slice(0, -1).every((g) => g.waiting));
});

test('empty / missing parts handled without throwing', () => {
  assert.deepEqual(buildReceiving([], 'all').groups, []);
  assert.deepEqual(buildReceiving([{ id: 'x' }], 'all').groups, []);
  assert.deepEqual(buildReceiving(null, 'all').groups, []);
});

test('receiving photos are grouped per part by partId, sorted by upload time', () => {
  const withPhotos = [{
    id: 'jp', car_model: 'Lada',
    parts: [
      { id: 'a', name: 'Бампер', status: 'arrived' },
      { id: 'b', name: 'Фара', status: 'in' },
    ],
    photos: [
      { id: 'f1', category: 'receiving', partId: 'a', url: '/u/1', uploaded_at: 2 },
      { id: 'f2', category: 'receiving', partId: 'a', url: '/u/2', uploaded_at: 1 },
      { id: 'f3', category: 'receiving', partId: 'b', url: '/u/3' },
      { id: 'f4', category: 'before', partId: 'a', url: '/u/x' },   // «до/после» карточки → игнор
      { id: 'f5', category: 'receiving', url: '/u/y' },             // без partId → игнор
    ],
  }];
  const { groups } = buildReceiving(withPhotos, 'all');
  const pa = groups[0].parts.find((p) => p.id === 'a');
  const pb = groups[0].parts.find((p) => p.id === 'b');
  assert.equal(pa.photoCount, 2);
  assert.deepEqual(pa.photos.map((x) => x.id), ['f2', 'f1']); // uploaded_at по возрастанию
  assert.equal(pb.photoCount, 1);
  assert.deepEqual(pb.photos.map((x) => x.id), ['f3']);
});

test('parts without photos get an empty photos array', () => {
  const { groups } = buildReceiving(jobs, 'all');
  const p1 = groups.flatMap((g) => g.parts).find((p) => p.id === 'p1');
  assert.deepEqual(p1.photos, []);
  assert.equal(p1.photoCount, 0);
});

test('part comment passes through the VM; missing → empty string', () => {
  const withComment = [{
    id: 'jc', car_model: 'Lada',
    parts: [
      { id: 'a', name: 'Бампер', status: 'arrived', comment: 'коробка мятая' },
      { id: 'b', name: 'Фара', status: 'in' }, // без комментария
    ],
  }];
  const { groups } = buildReceiving(withComment, 'all');
  const pa = groups[0].parts.find((p) => p.id === 'a');
  const pb = groups[0].parts.find((p) => p.id === 'b');
  assert.equal(pa.comment, 'коробка мятая');
  assert.equal(pb.comment, '');
});
