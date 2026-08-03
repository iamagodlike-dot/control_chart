// Тесты склада расходников: светофор для обеих групп (учётная A и канбан B/C),
// расчёт дозаказа, мёртвые запасы, сроки годности, фильтры/сортировка/сводка
// buildConsumables и оценка аудита 5S. Zero-dependency — run with:
//   node --test src/consumables.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS, DEAD_DAYS,
  stockState, needsReorder, reorderQty, reorderCost,
  daysSinceMove, isDead, expiryState, daysUntilExpiry, shelfOf,
  buildConsumables, groupByShelf,
  FIVE_S, auditTotal, auditVerdict, auditTrend,
} from './consumables.js';

const NOW = new Date('2026-08-01T12:00:00').getTime();
const daysAgo = (n) => NOW - n * DAY_MS;
const inDays = (n) => NOW + n * DAY_MS;

// Учётная позиция (группа A) с разумными полями по умолчанию.
const a = (over = {}) => ({
  id: 'a1', name: 'Лак 2К', category: 'ЛКМ (лак, грунт, краска)', unit: 'л',
  tracked: true, qty: 5, min_qty: 2, max_qty: 8,
  location: 'С1-A-01', last_price: 2400, last_move_at: daysAgo(2), active: true,
  ...over,
});

// Канбан-позиция (группа B/C).
const k = (over = {}) => ({
  id: 'k1', name: 'Перчатки нитрил', category: 'СИЗ', unit: 'упак',
  tracked: false, empty: false, max_qty: 3,
  location: 'С3-C-02', last_price: 320, last_move_at: daysAgo(5), active: true,
  ...over,
});

// ─── Светофор ───────────────────────────────────────────────────────────────

test('учётная позиция: qty выше минимума → зелёная', () => {
  assert.equal(stockState(a({ qty: 5, min_qty: 2 })), 'ok');
});

test('учётная позиция: qty РОВНО на минимуме → уже жёлтая, а не зелёная', () => {
  // Граница включительна: «осталось ровно столько, сколько мы назвали
  // минимумом» — это и есть момент заказывать, а не «ещё чуть-чуть подождём».
  assert.equal(stockState(a({ qty: 2, min_qty: 2 })), 'low');
});

test('учётная позиция: ноль и минус → красная', () => {
  assert.equal(stockState(a({ qty: 0 })), 'out');
  assert.equal(stockState(a({ qty: -1 })), 'out');
});

test('канбан-позиция: только два состояния, жёлтой не бывает', () => {
  assert.equal(stockState(k({ empty: false })), 'ok');
  assert.equal(stockState(k({ empty: true })), 'out');
  // даже если в документе случайно осталось qty ниже минимума — не смотрим на него
  assert.equal(stockState(k({ empty: false, qty: 0, min_qty: 5 })), 'ok');
});

test('пустой вход не роняет светофор', () => {
  assert.equal(stockState(null), 'ok');
  assert.equal(stockState(undefined), 'ok');
});

// ─── Дозаказ ────────────────────────────────────────────────────────────────

test('дозаказ учётной: добить до максимума, вверх до целого', () => {
  assert.equal(reorderQty(a({ qty: 1.4, max_qty: 8 })), 7);
  assert.equal(reorderQty(a({ qty: 0, max_qty: 8 })), 8);
});

test('дозаказ учётной без максимума: два минимума', () => {
  assert.equal(reorderQty(a({ qty: 0, max_qty: undefined, min_qty: 3 })), 6);
});

test('дозаказ никогда не меньше единицы', () => {
  // остаток выше максимума (пересчёт нашёл лишнее) — заявка всё равно осмысленная
  assert.equal(reorderQty(a({ qty: 12, max_qty: 8 })), 1);
});

test('дозаказ канбана: одна стандартная упаковка', () => {
  assert.equal(reorderQty(k({ max_qty: 3 })), 3);
  assert.equal(reorderQty(k({ max_qty: undefined })), 1);
});

test('стоимость дозаказа считается по последней цене, без цены — ноль', () => {
  assert.equal(reorderCost(a({ qty: 0, max_qty: 8, last_price: 2400 })), 19200);
  assert.equal(reorderCost(a({ qty: 0, max_qty: 8, last_price: undefined })), 0);
});

test('заказывать надо только красные и жёлтые, и только если заявки ещё нет', () => {
  assert.equal(needsReorder(a({ qty: 5 })), false);
  assert.equal(needsReorder(a({ qty: 1 })), true);
  assert.equal(needsReorder(a({ qty: 0 })), true);
  // заявка уже висит в «Заявках» → второй раз не создаём
  assert.equal(needsReorder(a({ qty: 0, request_id: 'r1' })), false);
});

// ─── Мёртвые запасы и срок годности ─────────────────────────────────────────

test('дни с последнего движения', () => {
  assert.equal(daysSinceMove(a({ last_move_at: daysAgo(10) }), NOW), 10);
  assert.equal(daysSinceMove(a({ last_move_at: 0 }), NOW), null);
});

test('мёртвый запас: не двигалось дольше порога', () => {
  assert.equal(isDead(a({ last_move_at: daysAgo(DEAD_DAYS - 1) }), NOW), false);
  assert.equal(isDead(a({ last_move_at: daysAgo(DEAD_DAYS) }), NOW), true);
});

test('позиция с красным ярлыком в мёртвые не попадает — её уже разбирают', () => {
  assert.equal(isDead(a({ last_move_at: daysAgo(200), red_tag: { at: NOW, reason: 'непонятно чьё' } }), NOW), false);
});

test('срок годности: вышел / истекает / в порядке / нет срока', () => {
  assert.equal(expiryState(a({ shelf_life_until: daysAgo(1) }), NOW), 'expired');
  assert.equal(expiryState(a({ shelf_life_until: inDays(10) }), NOW), 'soon');
  assert.equal(expiryState(a({ shelf_life_until: inDays(200) }), NOW), 'ok');
  assert.equal(expiryState(k(), NOW), null);
  assert.equal(daysUntilExpiry(a({ shelf_life_until: inDays(10) }), NOW), 10);
});

// ─── Адрес ──────────────────────────────────────────────────────────────────

test('стеллаж вынимается из адреса, пустой адрес не теряется', () => {
  assert.equal(shelfOf({ location: 'С2-B-03' }), 'С2');
  assert.equal(shelfOf({ location: '' }), 'Без адреса');
  assert.equal(shelfOf({}), 'Без адреса');
});

// ─── Вью-модель экрана ──────────────────────────────────────────────────────

const SEED = [
  a({ id: '1', name: 'Лак 2К', qty: 0, min_qty: 2, max_qty: 8, location: 'С1-A-01', last_price: 2400 }),          // out
  a({ id: '2', name: 'Грунт эпоксидный', qty: 2, min_qty: 2, max_qty: 6, location: 'С1-A-02', last_price: 1800 }), // low
  a({ id: '3', name: 'Отвердитель', qty: 6, min_qty: 2, max_qty: 8, location: 'С1-B-01' }),                        // ok
  k({ id: '4', name: 'Перчатки', empty: true, max_qty: 3, location: 'С3-C-02', last_price: 320 }),                 // out
  k({ id: '5', name: 'Скотч малярный', category: 'Малярный расходник', empty: false, location: 'С3-C-03' }),        // ok
  a({ id: '6', name: 'Полироль старая', qty: 4, min_qty: 1, location: 'С2-A-05', last_move_at: daysAgo(150) }),     // ok + мёртвый
  a({ id: '7', name: 'Списанное', qty: 1, min_qty: 5, location: 'С2-A-06', active: false }),                        // отключена
];

test('buildConsumables: архивные позиции не участвуют нигде', () => {
  const { summary, rows } = buildConsumables(SEED, { filter: 'all' }, NOW);
  assert.equal(summary.total, 6);
  assert.equal(rows.length, 6);
  assert.equal(rows.some((r) => r.item.id === '7'), false);
});

test('buildConsumables: сводка считает светофор, мёртвые и деньги дозаказа', () => {
  const { summary } = buildConsumables(SEED, {}, NOW);
  assert.equal(summary.out, 2);   // лак + перчатки
  assert.equal(summary.low, 1);   // грунт
  assert.equal(summary.ok, 3);
  assert.equal(summary.dead, 1);  // полироль
  assert.equal(summary.toOrder, 3);
  // лак 8×2400 + грунт 4×1800 + перчатки 3×320 = 19200 + 7200 + 960
  assert.equal(summary.toOrderCost, 27360);
});

test('buildConsumables: сортировка по умолчанию — красные наверх, потом по адресу', () => {
  const { rows } = buildConsumables(SEED, { filter: 'all', sort: 'state' }, NOW);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.item.name), ['Лак 2К', 'Перчатки', 'Грунт эпоксидный']);
});

test('buildConsumables: фильтры отбирают ровно то, что обещает чип', () => {
  const only = (filter) => buildConsumables(SEED, { filter }, NOW).rows.map((r) => r.item.id);
  assert.deepEqual(only('out').sort(), ['1', '4']);
  assert.deepEqual(only('low'), ['2']);
  assert.deepEqual(only('reorder').sort(), ['1', '2', '4']);
  assert.deepEqual(only('tracked').sort(), ['1', '2', '3', '6']);
  assert.deepEqual(only('kanban').sort(), ['4', '5']);
  assert.deepEqual(only('dead'), ['6']);
});

test('buildConsumables: счётчик на чипе совпадает с тем, что покажет клик по нему', () => {
  const { counts } = buildConsumables(SEED, { filter: 'all' }, NOW);
  for (const id of ['out', 'low', 'reorder', 'tracked', 'kanban', 'dead']) {
    const got = buildConsumables(SEED, { filter: id }, NOW).rows.length;
    assert.equal(counts[id], got, `чип «${id}» врёт: ${counts[id]} ≠ ${got}`);
  }
});

test('buildConsumables: поиск идёт по названию, адресу и категории', () => {
  const ids = (query) => buildConsumables(SEED, { query }, NOW).rows.map((r) => r.item.id);
  assert.deepEqual(ids('отвердит'), ['3']);
  assert.deepEqual(ids('С3').sort(), ['4', '5']);
  // по категории тоже — «покажи всю малярку» работает без выпадающего списка
  assert.deepEqual(ids('ЛКМ').sort(), ['1', '2', '3', '6']);
  assert.deepEqual(ids('ничего такого нет'), []);
});

test('buildConsumables: поиск сужает и счётчики чипов тоже', () => {
  const { counts } = buildConsumables(SEED, { query: 'С3' }, NOW);
  assert.equal(counts.out, 1);   // из найденных двух красные только перчатки
  assert.equal(counts.all, 2);
});

test('buildConsumables: фильтр по категории', () => {
  const { rows } = buildConsumables(SEED, { category: 'СИЗ' }, NOW);
  assert.deepEqual(rows.map((r) => r.item.id), ['4']);
});

test('buildConsumables переживает мусор на входе', () => {
  assert.equal(buildConsumables(null).rows.length, 0);
  assert.equal(buildConsumables(undefined).summary.total, 0);
  assert.equal(buildConsumables([null, undefined]).rows.length, 0);
});

test('groupByShelf: по стеллажам, «Без адреса» в конце, красные посчитаны', () => {
  const { rows } = buildConsumables([...SEED, a({ id: '8', name: 'Без места', qty: 0, location: '' })], {}, NOW);
  const groups = groupByShelf(rows);
  assert.deepEqual(groups.map((g) => g.shelf), ['С1', 'С2', 'С3', 'Без адреса']);
  assert.equal(groups.find((g) => g.shelf === 'С1').out, 1);
});

// ─── Аудит 5S ───────────────────────────────────────────────────────────────

test('аудит: пять шагов, максимум 10 баллов', () => {
  assert.equal(FIVE_S.length, 5);
  assert.equal(auditTotal({ s1: 2, s2: 2, s3: 2, s4: 2, s5: 2 }), 10);
  assert.equal(auditTotal({}), 0);
});

test('аудит: оценка вне 0–2 подрезается, мусор считается нулём', () => {
  assert.equal(auditTotal({ s1: 5, s2: -3, s3: 'ага' }), 2);
});

test('аудит: вердикт по сумме', () => {
  assert.equal(auditVerdict(10).label, 'отлично');
  assert.equal(auditVerdict(8).label, 'нормально');
  assert.equal(auditVerdict(5).label, 'есть провалы');
  assert.equal(auditVerdict(2).label, 'плохо');
});

test('аудит: динамика — старые слева, длина ограничена', () => {
  const list = Array.from({ length: 20 }, (_, i) => ({ at: daysAgo(20 - i), total: i }));
  const trend = auditTrend(list, 5);
  assert.equal(trend.length, 5);
  assert.deepEqual(trend.map((t) => t.total), [15, 16, 17, 18, 19]);
});

test('аудит: если итог не сохранён, он считается из оценок', () => {
  const trend = auditTrend([{ at: NOW, scores: { s1: 2, s2: 1 } }]);
  assert.equal(trend[0].total, 3);
});
