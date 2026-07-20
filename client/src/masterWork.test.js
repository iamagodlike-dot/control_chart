import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMasterWork, effectiveStageStatus, STAGE_STATUS } from './masterWork.js';

// Фиксированное «сейчас», чтобы просрочка считалась детерминированно.
const NOW = new Date('2026-07-08T12:00:00').getTime();

const POSTS = [
  { id: 'post-dis', name: 'Разборка' },
  { id: 'post-paint', name: 'Окраска' },
];

// s1,s2 — машина j1 мастера m1 (одна в работе, одна запланирована);
// s3 — машина j2 мастера m1, срок вчера → просрочка;
// s4 — машина j3 ЧУЖОГО мастера m2 (не должна попасть);
// s5 — машина j4 мастера m1, всё готово.
const STAGES = [
  { id: 's2', job_id: 'j1', master_id: 'm1', post_id: 'post-paint', start_at: '2026-07-08T14:00:00', end_at: '2026-07-08T16:00:00', status: 'planned', car_model: 'TOYOTA CAMRY', plate_number: 'K456TT', order_number: '110', client_name: 'Смирнов', deadline: '2026-07-10' },
  { id: 's1', job_id: 'j1', master_id: 'm1', post_id: 'post-dis', start_at: '2026-07-08T08:00:00', end_at: '2026-07-08T14:00:00', status: 'in_progress', car_model: 'TOYOTA CAMRY', plate_number: 'K456TT', order_number: '110', client_name: 'Смирнов', deadline: '2026-07-10' },
  { id: 's3', job_id: 'j2', master_id: 'm1', post_id: 'post-dis', start_at: '2026-07-07T09:00:00', end_at: '2026-07-07T11:00:00', status: 'planned', car_model: 'KIA RIO', plate_number: 'A007KX', order_number: '102', client_name: 'Кузнецов' },
  { id: 's4', job_id: 'j3', master_id: 'm2', post_id: 'post-dis', start_at: '2026-07-08T09:00:00', end_at: '2026-07-08T10:00:00', status: 'planned', car_model: 'BMW X5' },
  { id: 's5', job_id: 'j4', master_id: 'm1', post_id: 'post-paint', start_at: '2026-07-06T09:00:00', end_at: '2026-07-06T18:00:00', status: 'done', car_model: 'LADA VESTA', order_number: '95' },
];

test('effectiveStageStatus: готово / просрочка / как есть', () => {
  assert.equal(effectiveStageStatus({ status: 'done', end_at: '2000-01-01' }, NOW), 'done');
  assert.equal(effectiveStageStatus({ status: 'planned', end_at: '2026-07-07T11:00:00' }, NOW), 'delayed');
  assert.equal(effectiveStageStatus({ status: 'in_progress', end_at: '2026-07-08T14:00:00' }, NOW), 'in_progress');
  assert.equal(effectiveStageStatus({ status: 'planned', end_at: '' }, NOW), 'planned');
});

test('берёт только машины своего мастера', () => {
  const { cards, counts } = buildMasterWork('m1', { stages: STAGES, posts: POSTS }, NOW);
  assert.equal(counts.cars, 3); // j1, j2, j4 — но НЕ j3 (мастер m2)
  assert.ok(!cards.some((c) => c.jobId === 'j3'));
});

test('группирует этапы по машине и сортирует по началу', () => {
  const { cards } = buildMasterWork('m1', { stages: STAGES, posts: POSTS }, NOW);
  const j1 = cards.find((c) => c.jobId === 'j1');
  assert.equal(j1.stages.length, 2);
  assert.deepEqual(j1.stages.map((s) => s.id), ['s1', 's2']); // s1 08:00 раньше s2 14:00
  assert.equal(j1.stages[0].post, 'Разборка'); // имя поста из posts
});

test('порядок карточек: просрочка → в работе → готово; счётчики', () => {
  const { cards, counts } = buildMasterWork('m1', { stages: STAGES, posts: POSTS }, NOW);
  assert.deepEqual(cards.map((c) => c.jobId), ['j2', 'j1', 'j4']);
  assert.equal(counts.overdue, 1); // j2
  assert.equal(counts.active, 1);  // j1
  assert.equal(counts.done, 1);    // j4
  assert.equal(cards.find((c) => c.jobId === 'j2').overdue, true);
  assert.equal(cards.find((c) => c.jobId === 'j4').done, true);
});

test('без masterId — пусто', () => {
  assert.equal(buildMasterWork('', { stages: STAGES, posts: POSTS }, NOW).cards.length, 0);
  assert.equal(buildMasterWork(undefined, { stages: STAGES, posts: POSTS }, NOW).cards.length, 0);
});

test('пустой ввод не падает', () => {
  const { cards, counts } = buildMasterWork('m1', {}, NOW);
  assert.deepEqual(cards, []);
  assert.equal(counts.cars, 0);
});

test('STAGE_STATUS покрывает все статусы Gantt', () => {
  for (const k of ['planned', 'in_progress', 'done', 'delayed', 'queued']) {
    assert.ok(STAGE_STATUS[k]?.label, `нет метки для ${k}`);
  }
});
