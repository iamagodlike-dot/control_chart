// Тесты классификации «Монитора»: каждая ветка classify + границы светофора +
// сортировка/фильтры/сводка buildMonitor. Zero-dependency — run with:
//   node --test src/monitor.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, buildMonitor, days, DAY_MS, THRESHOLDS } from './monitor.js';

const NOW = new Date('2026-07-21T12:00:00').getTime();
const daysAgo = (n) => NOW - n * DAY_MS;
const iso = (msTime) => new Date(msTime).toISOString();

// Этап маршрута (коллекция stages) с разумными полями по умолчанию.
const stage = (status, endDaysAgo = 1) => ({
  status,
  start_at: iso(daysAgo(endDaysAgo + 1)),
  end_at: iso(daysAgo(endDaysAgo)),
});

test('согласование: простой от заведения, причина «Страховая»', () => {
  const r = classify({ phase: 'approval', approval_status: 'sent', created_at: daysAgo(20) }, NOW);
  assert.equal(r.stageKey, 'approval');
  assert.equal(r.stageLabel, 'Согласование: Отправлено страховой');
  assert.equal(r.cause, 'Страховая');
  assert.equal(r.idleDays, 20);
  assert.equal(r.totalDays, 20);
  assert.equal(r.severity, 'orange'); // 15–25 → 🟠
  assert.equal(r.ranked, true);
});

test('согласование: доплата — отдельная причина', () => {
  const r = classify({ phase: 'approval', approval_status: 'surcharge', created_at: daysAgo(3) }, NOW);
  assert.equal(r.cause, 'Страховая (доплата)');
  assert.equal(r.severity, 'ok');
});

test('отказ: не простой, серый, в самом низу', () => {
  const r = classify({ phase: 'approval', approval_status: 'rejected', created_at: daysAgo(40) }, NOW);
  assert.equal(r.stageKey, 'rejected');
  assert.equal(r.idleDays, 0);
  assert.equal(r.ranked, false);
  assert.equal(r.severity, 'none');
  assert.equal(r.totalDays, 40); // «всего дней» считается всегда
});

test('готово: все этапы done, простой от конца последнего, не ранжируется', () => {
  const r = classify({
    created_at: daysAgo(15),
    stages: [stage('done', 9), stage('done', 4)],
  }, NOW);
  assert.equal(r.stageKey, 'done');
  assert.equal(r.idleDays, 4); // от САМОГО ПОЗДНЕГО end_at
  assert.equal(r.ranked, false);
});

test('в ремонте: есть этап в работе → простоя нет', () => {
  const r = classify({
    created_at: daysAgo(17),
    stages: [stage('done', 5), { ...stage('in_progress'), end_at: iso(NOW + DAY_MS) }],
  }, NOW);
  assert.equal(r.stageKey, 'repair');
  assert.equal(r.idleDays, 0);
  assert.equal(r.severity, 'ok');
});

test('в ремонте: просроченный этап «в работе» — это работа, а не простой', () => {
  // effectiveStatus дал бы 'delayed', но мастер реально работает — машина не стоит.
  const r = classify({ created_at: daysAgo(9), stages: [stage('in_progress', 2)] }, NOW);
  assert.equal(r.stageKey, 'repair');
  assert.equal(r.idleDays, 0);
});

test('ждёт запчасти: отсчёт от самого раннего заказа детали', () => {
  const r = classify({
    created_at: daysAgo(12),
    repair_since: daysAgo(10),
    stages: [stage('planned')],
    parts: [
      { status: 'ordered', receiving_log: [{ status: 'ordered', at: daysAgo(6) }] },
      { status: 'ordered', receiving_log: [{ status: 'ordered', at: daysAgo(4) }] },
      { status: 'in', receiving_log: [{ status: 'ordered', at: daysAgo(11) }] }, // уже на складе — не ждём
    ],
  }, NOW);
  assert.equal(r.stageKey, 'parts');
  assert.equal(r.cause, 'Запчасти');
  assert.equal(r.idleDays, 6);
  assert.equal(r.severity, 'orange'); // 6–10 → 🟠
});

test('ждёт запчасти: деталь без статуса = «Требуется», отсчёт от repair_since', () => {
  const r = classify({
    created_at: daysAgo(8),
    repair_since: daysAgo(4),
    stages: [],
    parts: [{ name: 'Бампер' }], // status отсутствует → 'need'
  }, NOW);
  assert.equal(r.stageKey, 'parts');
  assert.equal(r.idleDays, 4);
});

test('очередь: этапов нет, деталей не ждём — от repair_since', () => {
  const r = classify({ created_at: daysAgo(12), repair_since: daysAgo(7), stages: [], parts: [] }, NOW);
  assert.equal(r.stageKey, 'queue');
  assert.equal(r.cause, 'Нет поста/мастера');
  assert.equal(r.idleDays, 7);
  assert.equal(r.severity, 'orange');
  assert.equal(r.totalDays, 12);
});

test('старая машина без phase и repair_since = ремонт, отсчёт от created_at', () => {
  const r = classify({ created_at: daysAgo(3), stages: [], parts: [] }, NOW);
  assert.equal(r.stageKey, 'queue');
  assert.equal(r.idleDays, 3);
});

test('готово приоритетнее «ждёт запчасти» (все этапы закрыты)', () => {
  const r = classify({
    created_at: daysAgo(10),
    stages: [stage('done', 2)],
    parts: [{ status: 'ordered' }],
  }, NOW);
  assert.equal(r.stageKey, 'done');
});

test('границы светофора: ремонтные причины', () => {
  const sev = (n) => classify({ created_at: daysAgo(n), stages: [], parts: [] }, NOW).severity;
  assert.equal(sev(2), 'ok');
  assert.equal(sev(3), 'warn');
  assert.equal(sev(5), 'warn');
  assert.equal(sev(6), 'orange');
  assert.equal(sev(10), 'orange');
  assert.equal(sev(11), 'danger');
  assert.deepEqual(THRESHOLDS.repair, [2, 5, 10]);
});

test('границы светофора: согласование мягче', () => {
  const sev = (n) => classify({ phase: 'approval', approval_status: 'calc', created_at: daysAgo(n) }, NOW).severity;
  assert.equal(sev(7), 'ok');
  assert.equal(sev(8), 'warn');
  assert.equal(sev(14), 'warn');
  assert.equal(sev(15), 'orange');
  assert.equal(sev(25), 'orange');
  assert.equal(sev(26), 'danger');
});

test('days: не отрицательные, неполный день не считается', () => {
  assert.equal(days(NOW - DAY_MS / 2, NOW), 0);
  assert.equal(days(NOW + DAY_MS, NOW), 0);
  assert.equal(days(NaN, NOW), 0);
});

// ---- buildMonitor: вью-модель ----

const FLEET = [
  { id: 'a', phase: 'approval', approval_status: 'inspection', created_at: daysAgo(20), payment_type: 'insurance', car_model: 'BMW X5', plate_number: 'О456', client_name: 'Иванов' },
  { id: 'b', created_at: daysAgo(12), repair_since: daysAgo(12), stages: [], parts: [], payment_type: 'cash', car_model: 'Hyundai Solaris', plate_number: 'К221', client_name: 'Сидоров' },
  { id: 'c', created_at: daysAgo(10), stages: [stage('planned')], parts: [{ status: 'ordered', receiving_log: [{ status: 'ordered', at: daysAgo(6) }] }], payment_type: 'insurance', car_model: 'Toyota Rav4', plate_number: 'В789', client_name: 'Петров' },
  { id: 'd', created_at: daysAgo(17), stages: [{ ...stage('in_progress'), end_at: iso(NOW + DAY_MS) }], payment_type: 'insurance', car_model: 'Toyota Camry', plate_number: 'А123', client_name: 'Козлов' },
  { id: 'e', created_at: daysAgo(15), stages: [stage('done', 9)], payment_type: 'cash', car_model: 'Kia Rio', plate_number: 'Т555', client_name: 'Орлов' },
  { id: 'f', phase: 'approval', approval_status: 'rejected', created_at: daysAgo(30), payment_type: 'insurance', car_model: 'Lada Vesta', plate_number: 'М001', client_name: 'Фомин' },
];

test('buildMonitor: сортировка по простою, «готово»/«отказ» внизу', () => {
  const { rows } = buildMonitor(FLEET, { now: NOW });
  assert.deepEqual(rows.map((r) => r.job.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  // a=20 (согласование), b=12 (очередь), c=6 (запчасти), d=0 (в ремонте), потом неранжируемые
});

test('buildMonitor: сводка по всей площадке', () => {
  const { summary } = buildMonitor(FLEET, { now: NOW });
  assert.equal(summary.total, 6);
  assert.equal(summary.over7, 2);            // a (20) и b (12)
  assert.equal(summary.topCause, 'Страховая'); // причины: Страховая=1, Нет поста=1, Запчасти=1 → первая по счёту с max
  assert.equal(summary.avgIdle, Math.round((20 + 12 + 6 + 0) / 4));
});

test('buildMonitor: чип «Согласование» накрывает и отказ', () => {
  const { rows, counts } = buildMonitor(FLEET, { now: NOW, stage: 'approval' });
  assert.deepEqual(rows.map((r) => r.job.id), ['a', 'f']);
  assert.equal(counts.approval, 2);
  assert.equal(counts.parts, 1);
});

test('buildMonitor: фильтр по оплате и поиск', () => {
  const cash = buildMonitor(FLEET, { now: NOW, payer: 'client' });
  assert.deepEqual(cash.rows.map((r) => r.job.id), ['b', 'e']);
  const found = buildMonitor(FLEET, { now: NOW, query: 'rav' });
  assert.deepEqual(found.rows.map((r) => r.job.id), ['c']);
  const byPlate = buildMonitor(FLEET, { now: NOW, query: 'к221' });
  assert.deepEqual(byPlate.rows.map((r) => r.job.id), ['b']);
});

test('buildMonitor: сортировка по дедлайну — без дедлайна вниз', () => {
  const fleet = FLEET.map((j) => (j.id === 'c' ? { ...j, deadline: iso(NOW + 2 * DAY_MS) } : j))
    .map((j) => (j.id === 'd' ? { ...j, deadline: iso(NOW + 5 * DAY_MS) } : j));
  const { rows } = buildMonitor(fleet, { now: NOW, sort: 'deadline' });
  assert.deepEqual(rows.slice(0, 2).map((r) => r.job.id), ['c', 'd']);
});
