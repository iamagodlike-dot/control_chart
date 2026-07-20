// Guards the pure helpers in supplierInvoices.js.
// run with:  node --test src/supplierInvoices.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  itemsAmount, isPaid, invoicesByPaid, countInvoices,
  buildInvoiceItems, invoiceCarsSummary, invoiceStatus,
} from './supplierInvoices.js';

test('itemsAmount — Σ(cost × qty), терпит грязные строки', () => {
  assert.equal(itemsAmount([{ cost: 1000, qty: 2 }, { cost: 500, qty: 1 }]), 2500);
  assert.equal(itemsAmount([{ cost: '1 200 ₽', qty: '3' }]), 3600);
  assert.equal(itemsAmount([{ cost: 700 }]), 700); // qty пусто → 1
  assert.equal(itemsAmount([]), 0);
  assert.equal(itemsAmount(null), 0);
});

test('isPaid — по статусу ИЛИ по дате оплаты (устойчиво к частичной записи бота)', () => {
  assert.equal(isPaid({ status: 'paid' }), true);
  assert.equal(isPaid({ paid_at: 123 }), true);
  assert.equal(isPaid({ status: 'unpaid' }), false);
  assert.equal(isPaid({}), false);
});

test('invoicesByPaid + countInvoices', () => {
  const list = [
    { id: 'a', amount: 1000 },                 // unpaid
    { id: 'b', amount: 2000, status: 'paid' }, // paid
    { id: 'c', amount: 500, paid_at: 5 },      // paid (по дате)
  ];
  assert.deepEqual(invoicesByPaid(list, false).map((i) => i.id), ['a']);
  assert.deepEqual(invoicesByPaid(list, true).map((i) => i.id), ['b', 'c']);
  const c = countInvoices(list);
  assert.deepEqual(c, { unpaid: 1, paid: 2, unpaidAmount: 1000 });
});

test('buildInvoiceItems — из выбранных плоских позиций собирает снимок (с машиной)', () => {
  const parts = [
    { id: 'p1', carId: 'j1', name: 'Бампер', code: 'A1', qty: 1, cost: 5000 },
    { id: 'p2', carId: 'j1', name: 'Фара', code: 'A2', qty: 2, cost: 3000 },
    { id: 'p3', carId: 'j2', name: 'Капот', code: 'A3', qty: 1, cost: 8000 },
  ];
  const cars = { j1: { model: 'BMW', plate: 'А123АА' }, j2: { model: 'Audi', plate: 'В456ВВ' } };
  const items = buildInvoiceItems(parts, new Set(['p1', 'p3']), cars);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { job_id: 'j1', part_id: 'p1', name: 'Бампер', code: 'A1', qty: 1, cost: 5000, car_model: 'BMW', plate: 'А123АА' });
  assert.equal(items[1].job_id, 'j2');
  assert.equal(items[1].car_model, 'Audi');
  // авто-сумма из собранных позиций
  assert.equal(itemsAmount(items), 5000 + 8000);
});

test('invoiceCarsSummary — сводка «модель · номер (N поз.)» из снимка в items', () => {
  const inv = { items: [
    { job_id: 'j1', car_model: 'BMW', plate: 'А123АА' },
    { job_id: 'j1', car_model: 'BMW', plate: 'А123АА' },
    { job_id: 'j2', car_model: 'Audi', plate: 'В456ВВ' },
  ] };
  assert.equal(invoiceCarsSummary(inv), 'BMW · А123АА (2 поз.), Audi · В456ВВ (1 поз.)');
});

test('invoiceStatus — метки', () => {
  assert.equal(invoiceStatus('unpaid').label, 'не оплачен');
  assert.equal(invoiceStatus('paid').label, 'оплачен');
  assert.equal(invoiceStatus('что-то').label, 'не оплачен'); // fallback
});
