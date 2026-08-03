import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorks, laborFromWorks, worksTotals, buildMasterOrderSheets, normalizeWork, newWork, workSum, todayInput,
} from './masterOrder.js';

// Машина без страховой: источник работ — последний заказ-наряд с позициями.
const ORDER = {
  id: 'd1', type: 'order', doc_number: 'ЗН-2026-0007', created_at: 200,
  services: [
    { id: 's1', name: 'Снятие/установка бампера', qty: 1, price: 2000 },
    { id: 's2', name: 'Окраска', qty: 2, price: 5000 },
  ],
  parts: [], discount: 0,
};
const JOB = { id: 'j1', car_model: 'Toyota Camry', plate_number: 'K456TT', vin: 'VIN1', order_number: '110' };

test('buildWorks: сид из заказ-наряда — реальная цена стартует с цены ЗН', () => {
  const works = buildWorks(JOB, [ORDER], []);
  assert.equal(works.length, 2);
  assert.equal(works[0].name, 'Снятие/установка бампера');
  assert.equal(works[0].qty, 1);
  assert.equal(works[0].price, 2000);       // подсказка = цена ЗН
  assert.equal(works[0].order_price, 2000); // справочно, для страховой
  assert.equal(works[0].master_id, '');
  assert.equal(works[0].from_order, true);
  assert.equal(works[1].qty, 2);
  // id стабильные и уникальные
  assert.equal(new Set(works.map((w) => w.id)).size, 2);
  // Ни одного undefined — иначе запись в Firestore упадёт целиком
  for (const w of works) for (const v of Object.values(w)) assert.notEqual(v, undefined);
});

test('buildWorks: пересид сохраняет реальную цену, мастера и id', () => {
  const first = buildWorks(JOB, [ORDER], []);
  const edited = first.map((w, i) => (i === 0
    ? { ...w, price: 3500, master_id: 'm1', master_name: 'Иванов' }
    : w));
  // ЗН переиздали: цена страховой выросла, добавилась работа
  const ORDER2 = {
    ...ORDER,
    services: [
      { id: 'x1', name: 'Снятие/установка бампера', qty: 1, price: 2400 },
      { id: 'x2', name: 'Окраска', qty: 2, price: 5000 },
      { id: 'x3', name: 'Полировка', qty: 1, price: 1500 },
    ],
  };
  const again = buildWorks(JOB, [ORDER2], edited);
  assert.equal(again.length, 3);
  assert.equal(again[0].id, edited[0].id);         // стабильный id
  assert.equal(again[0].price, 3500);              // введённая цена не затёрта
  assert.equal(again[0].master_id, 'm1');
  assert.equal(again[0].master_name, 'Иванов');
  assert.equal(again[0].order_price, 2400);        // справка обновилась
  assert.equal(again[2].name, 'Полировка');        // новая работа подтянулась
  assert.equal(again[2].master_id, '');
});

test('buildWorks: одинаковые названия сохраняют СВОИ цены и мастеров (FIFO)', () => {
  const order = {
    type: 'order',
    services: [
      { name: 'Окраска детали', qty: 1, price: 4000 },
      { name: 'Окраска детали', qty: 1, price: 4000 },
    ],
    parts: [],
  };
  const seeded = buildWorks(JOB, [order], []);
  const edited = [
    { ...seeded[0], price: 6000, master_id: 'm1', master_name: 'Иванов' },
    { ...seeded[1], price: 9000, master_id: 'm2', master_name: 'Петров' },
  ];
  const again = buildWorks(JOB, [order], edited);
  assert.deepEqual(again.map((w) => w.price), [6000, 9000]);
  assert.deepEqual(again.map((w) => w.master_id), ['m1', 'm2']);
});

test('buildWorks: ручные работы «сверх ЗН» не теряются при пересиде', () => {
  const seeded = buildWorks(JOB, [ORDER], []);
  const withExtra = [...seeded, newWork({ name: 'Скрытые работы', qty: 1, price: 4000, master_id: 'm2', master_name: 'Петров' })];
  const again = buildWorks(JOB, [ORDER], withExtra);
  assert.equal(again.length, 3);
  const extra = again[again.length - 1];
  assert.equal(extra.name, 'Скрытые работы');
  assert.equal(extra.from_order, false);
  assert.equal(extra.price, 4000);
  assert.equal(extra.master_id, 'm2');
});

test('buildWorks: без документов берём работы карточки', () => {
  const job = { ...JOB, services: [{ id: 'a', name: 'Разборка', qty: 1, price: 1200 }] };
  const works = buildWorks(job, [], []);
  assert.equal(works.length, 1);
  assert.equal(works[0].name, 'Разборка');
  assert.equal(works[0].order_price, 1200);
  assert.deepEqual(buildWorks({}, [], []), []);
});

test('laborFromWorks: сумма по мастеру, нераспределённые не идут в ЗП', () => {
  const works = [
    { name: 'A', qty: 1, price: 3000, master_id: 'm1', master_name: 'Иванов' },
    { name: 'B', qty: 2, price: 2500, master_id: 'm1', master_name: 'Иванов' },
    { name: 'C', qty: 1, price: 4000, master_id: 'm2', master_name: 'Петров' },
    { name: 'D', qty: 1, price: 5000, master_id: '', master_name: '' },
  ];
  const labor = laborFromWorks(works);
  assert.equal(labor.length, 2);                       // ровно одна строка на мастера
  const byId = Object.fromEntries(labor.map((l) => [l.master_id, l]));
  assert.equal(byId.m1.amount, 8000);                  // 3000 + 2×2500
  assert.equal(byId.m2.amount, 4000);
  assert.equal(byId.m1.name, 'Иванов');                // имя обязательно: P&L группирует по нему
  assert.deepEqual(laborFromWorks([]), []);
  assert.deepEqual(laborFromWorks(null), []);
});

test('worksTotals: итог, распределено, остаток и разбивка по мастерам', () => {
  const works = [
    { name: 'A', qty: 1, price: 3000, master_id: 'm1', master_name: 'Иванов' },
    { name: 'B', qty: 2, price: 2500, master_id: 'm1', master_name: 'Иванов' },
    { name: 'C', qty: 1, price: 5000, master_id: '', master_name: '' },
  ];
  const t = worksTotals(works);
  assert.equal(t.sum, 13000);
  assert.equal(t.assigned, 8000);
  assert.equal(t.unassigned, 5000);
  assert.equal(t.byMaster.length, 1);
  assert.deepEqual(t.byMaster[0], { master_id: 'm1', name: 'Иванов', count: 2, sum: 8000 });
  assert.deepEqual(worksTotals([]), { sum: 0, assigned: 0, unassigned: 0, byMaster: [] });
});

test('buildMasterOrderSheets: лист на мастера, нераспределённые в печать не идут', () => {
  const works = [
    { id: 'w1', name: 'A', qty: 1, price: 3000, master_id: 'm1', master_name: 'Иванов' },
    { id: 'w2', name: 'B', qty: 2, price: 2500, master_id: 'm1', master_name: 'Иванов' },
    { id: 'w3', name: 'C', qty: 1, price: 4000, master_id: 'm2', master_name: 'Петров' },
    { id: 'w4', name: 'D', qty: 1, price: 9000, master_id: '', master_name: '' },
  ];
  const sheets = buildMasterOrderSheets(JOB, works, { name: 'Авто Академия', director: 'Петров П.П.' }, Date.UTC(2026, 7, 3, 12));
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].master_name, 'Иванов');
  assert.equal(sheets[0].rows.length, 2);
  assert.equal(sheets[0].rows[1].sum, 5000);           // 2 × 2500
  assert.equal(sheets[0].subtotal, 8000);
  assert.equal(sheets[1].subtotal, 4000);
  assert.equal(sheets[0].vehicle.plate_number, 'K456TT');
  assert.equal(sheets[0].doc_number, '110');
  assert.equal(sheets[0].company.director, 'Петров П.П.');
  // Работа без мастера не попала ни на один лист
  assert.equal(sheets.some((s) => s.rows.some((r) => r.name === 'D')), false);
  assert.deepEqual(buildMasterOrderSheets(JOB, [], {}), []);
});

test('normalizeWork / workSum: мусор приводится к числам, undefined не бывает', () => {
  const w = normalizeWork({ name: 'A', qty: '2', price: '1500', master_id: null });
  assert.equal(w.qty, 2);
  assert.equal(w.price, 1500);
  assert.equal(w.master_id, '');
  assert.equal(w.master_name, '');
  assert.equal(w.from_order, true);       // легаси-строки считаем «из ЗН»
  assert.ok(w.id);
  assert.equal(workSum(w), 3000);
  assert.equal(workSum({ price: 100 }), 100);   // кол-во по умолчанию 1
  assert.equal(workSum(null), 0);
  assert.equal(newWork().from_order, false);
});

test('округление построчное: наряд, оплата и себестоимость дают ОДНО число', () => {
  // Дробное кол-во (0,5 нормо-часа) — на нём итоги и разъезжались.
  const works = [
    { id: 'a', name: 'Окраска', qty: 0.5, price: 3333, master_id: 'm1', master_name: 'Иванов' },
    { id: 'b', name: 'Полировка', qty: 0.5, price: 3333, master_id: 'm1', master_name: 'Иванов' },
  ];
  const labor = laborFromWorks(works);
  const sheets = buildMasterOrderSheets({}, works, {});
  assert.equal(labor[0].amount, 3334);
  assert.equal(sheets[0].subtotal, 3334, 'мастер подписывает ту же сумму, что получит');
  assert.equal(worksTotals(works).sum, 3334);
  assert.equal(Number.isInteger(labor[0].amount), true);
});

test('todayInput: локальная дата в формате документов', () => {
  const d = new Date(2026, 0, 5, 10, 30);
  assert.equal(todayInput(d.getTime()), '2026-01-05');
});
