// Себестоимость по страховой машине с допродажами. Zero-dependency —
// run with:  node --test src/costing.test.js
// Ключевое правило: «как одна машина» — в источник себестоимости входят ВСЕ
// позиции (страховой ремонт + допродажи клиента), см. pickCostingSource.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCostingSource, computeCosting, buildCosting } from './costing.js';

const insJob = () => ({
  payment_type: 'insurance',
  discount: 1000,
  services: [
    { name: 'Окраска', qty: 1, price: 10000 },                  // страховая
    { name: 'Полировка', qty: 1, price: 3000, payer: 'client' }, // допродажа
  ],
  parts: [
    { name: 'Дверь', qty: 1, price: 20000 },                      // страховая
    { name: 'Коврики', qty: 1, price: 4000, payer: 'client' },    // допродажа
  ],
});

test('pickCostingSource — страховая машина без ЗН: все позиции из карточки (страховая + допродажи)', () => {
  const src = pickCostingSource(insJob(), []);
  assert.deepEqual(src.services.map((s) => s.name), ['Окраска', 'Полировка']);
  assert.deepEqual(src.parts.map((p) => p.name), ['Дверь', 'Коврики']);
  assert.equal(src.source, 'job');
});

test('pickCostingSource — сливает последний страховой ЗН + допродажи из карточки', () => {
  const docs = [
    { type: 'order', recipient: 'insurance', doc_number: 'ЗН-С', discount: 1000,
      services: [{ name: 'Окраска ЗН', qty: 1, price: 12000 }], parts: [{ name: 'Дверь ЗН', qty: 1, price: 21000 }] },
  ];
  const src = pickCostingSource(insJob(), docs);
  // страховые — из ЗН, допродажи — из карточки
  assert.deepEqual(src.services.map((s) => s.name), ['Окраска ЗН', 'Полировка']);
  assert.deepEqual(src.parts.map((p) => p.name), ['Дверь ЗН', 'Коврики']);
});

test('computeCosting — выручка включает допродажи (одна машина = полная сумма)', () => {
  const src = pickCostingSource(insJob(), []);
  const costing = buildCosting({ ...insJob(), services: src.services }, [], []);
  // services_sum = работы (страховые + допродажи) = 10000 + 3000
  const res = computeCosting({ ...costing, parts: src.parts.map((p) => ({ ...p, cost: 0 })) }, {});
  // выручка = работы 13000 + запчасти 24000 − скидка 1000 = 36000
  assert.equal(res.revenue, 36000);
});

test('pickCostingSource — не-страховая машина: прежнее поведение (последний ЗН)', () => {
  const cashJob = { payment_type: 'cash', services: [{ name: 'Работа', qty: 1, price: 5000 }], parts: [] };
  const docs = [{ type: 'order', doc_number: 'ЗН-1', services: [{ name: 'Работа ЗН', qty: 1, price: 6000 }], parts: [] }];
  const src = pickCostingSource(cashJob, docs);
  assert.equal(src.source, 'order');
  assert.deepEqual(src.services.map((s) => s.name), ['Работа ЗН']);
});

// ===== Несколько убытков на одной машине =====
// Экономика пока «как одна машина»: складываем ВСЕ потоки (убыток №1 + убыток №2 +
// допродажи). Раздельная прибыль по делу — отдельный этап (job.costings).

const twoClaimJob = () => ({
  payment_type: 'insurance',
  claims: [
    { id: 'insurance', claim_number: 'PVU-123', order_number: 'ЗН-2026-0007', discount: 1000 },
    { id: 'cl_x7', claim_number: 'PVU-999', order_number: 'ЗН-2026-0042', discount: 500 },
  ],
  services: [
    { name: 'Окраска двери', qty: 1, price: 10000 },                    // убыток №1 (без метки)
    { name: 'Окраска бампера', qty: 1, price: 8000, payer: 'cl_x7' },   // убыток №2
    { name: 'Полировка', qty: 1, price: 3000, payer: 'client' },        // допродажа
  ],
  parts: [
    { name: 'Дверь', qty: 1, price: 20000 },
    { name: 'Бампер', qty: 1, price: 15000, payer: 'cl_x7' },
    { name: 'Коврики', qty: 1, price: 4000, payer: 'client' },
  ],
});

test('pickCostingSource — два убытка без ЗН: позиции ОБОИХ дел + допродажи, ничего не потеряно', () => {
  const src = pickCostingSource(twoClaimJob(), []);
  assert.deepEqual(src.services.map((s) => s.name), ['Окраска двери', 'Окраска бампера', 'Полировка']);
  assert.deepEqual(src.parts.map((p) => p.name), ['Дверь', 'Бампер', 'Коврики']);
  // скидки обоих дел складываются (у допродаж своей скидки нет)
  assert.equal(src.discount, 1500);
  assert.equal(src.source, 'job');
});

test('pickCostingSource — ВЫРУЧКА = сумма обоих дел: у каждого убытка свой ЗН', () => {
  const docs = [
    { type: 'order', recipient: 'cl_x7', doc_number: 'ЗН-2026-0042', discount: 500, created_at: 200,
      services: [{ name: 'Окраска бампера ЗН', qty: 1, price: 9000 }], parts: [{ name: 'Бампер ЗН', qty: 1, price: 16000 }] },
    { type: 'order', recipient: 'insurance', doc_number: 'ЗН-2026-0007', discount: 1000, created_at: 100,
      services: [{ name: 'Окраска двери ЗН', qty: 1, price: 11000 }], parts: [{ name: 'Дверь ЗН', qty: 1, price: 21000 }] },
  ];
  const src = pickCostingSource(twoClaimJob(), docs);
  // оба ЗН вошли; допродажи подтянулись из карточки (своего ЗН у них нет)
  assert.deepEqual(src.services.map((s) => s.name), ['Окраска двери ЗН', 'Окраска бампера ЗН', 'Полировка']);
  assert.deepEqual(src.parts.map((p) => p.name), ['Дверь ЗН', 'Бампер ЗН', 'Коврики']);
  assert.equal(src.discount, 1500, 'скидки обоих ЗН');
  assert.equal(src.source, 'order');
  assert.equal(src.source_number, 'ЗН-2026-0007', 'источник — номер ЗН убытка №1');
});

// ГЛАВНАЯ ЛОВУШКА: переиздание ЗН создаёт ВТОРОЙ документ того же потока
// (create, а не update — update только когда документ открыт из истории).
// Слепое суммирование всех ЗН потока удвоило бы выручку.
test('pickCostingSource — переиздание заказ-наряда НЕ удваивает выручку (берём новейший в потоке)', () => {
  const docs = [ // listByJob отдаёт newest-first
    { type: 'order', recipient: 'insurance', doc_number: 'ЗН-2026-0007', discount: 1000, created_at: 999,
      services: [{ name: 'Окраска ПЕРЕИЗДАНО', qty: 1, price: 12000 }], parts: [] },
    { type: 'order', recipient: 'insurance', doc_number: 'ЗН-2026-0007', discount: 1000, created_at: 100,
      services: [{ name: 'Окраска СТАРОЕ', qty: 1, price: 11000 }], parts: [] },
  ];
  const src = pickCostingSource({ ...twoClaimJob(), claims: [{ id: 'insurance', discount: 1000 }] }, docs);
  const works = src.services.filter((s) => /Окраска/.test(s.name));
  assert.deepEqual(works.map((s) => s.name), ['Окраска ПЕРЕИЗДАНО'], 'старая версия ЗН не суммируется');
  assert.equal(src.discount, 1000, 'скидка не удваивается');
});

// Обратная совместимость: у машины без поля claims всё работает как раньше.
test('pickCostingSource — старая страховая машина (без claims) считается как прежде', () => {
  const legacy = {
    payment_type: 'insurance', discount: 1000,
    services: [{ name: 'Окраска', qty: 1, price: 10000 }, { name: 'Полировка', qty: 1, price: 3000, payer: 'client' }],
    parts: [{ name: 'Дверь', qty: 1, price: 20000 }],
  };
  const docs = [{ type: 'order', doc_number: 'ЗН-СТАРЫЙ', discount: 1000, created_at: 100, // без recipient — легаси-люк
    services: [{ name: 'Окраска ЗН', qty: 1, price: 12000 }], parts: [{ name: 'Дверь ЗН', qty: 1, price: 21000 }] }];
  const src = pickCostingSource(legacy, docs);
  assert.deepEqual(src.services.map((s) => s.name), ['Окраска ЗН', 'Полировка'], 'старый ЗН прилип к убытку №1');
  assert.deepEqual(src.parts.map((p) => p.name), ['Дверь ЗН']);
  assert.equal(src.source_number, 'ЗН-СТАРЫЙ');
});
