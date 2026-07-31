// Деньги: касса, лента и долг. Запуск:  node --test src/finance.test.js
//
// Здесь закреплено главное следствие правила «один счёт на ремонт» (invoices.js):
// перевыставленный счёт больше не удваивает ни выручку кассы, ни долг клиента, ни
// приход в ленте. И обратное: счета РАЗНЫХ убытков по-прежнему складываются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFinance, computeCashFlow } from './finance.js';

const JOBS = [{ id: 'j1', car_model: 'Kia Rio', plate_number: 'А001АА', created_at: 1000 }];

// Счёт на 100 000 ₽.
function inv(id, recipient, created_at, extra = {}) {
  return { id, job_id: 'j1', recipient, created_at, type: 'invoice', totals: { total: 100000 }, ...extra };
}

test('дубль счёта не удваивает кассу', () => {
  const one = computeFinance({ jobs: JOBS, invoices: [inv('a', 'insurance', 100, { paid: true, paid_at: 150 })] });
  const dup = computeFinance({
    jobs: JOBS,
    invoices: [
      inv('old', 'insurance', 100, { paid: true, paid_at: 150 }),
      inv('new', 'insurance', 200, { paid: true, paid_at: 250 }),
    ],
  });
  assert.equal(dup.cash.paid, 100000);
  assert.equal(dup.cash.billed, 100000);
  assert.deepEqual(dup.cash, one.cash, 'перевыставленный счёт = тот же ремонт, касса не меняется');
});

test('дубль неоплаченного счёта не удваивает долг', () => {
  const dup = computeCashFlow({ jobs: JOBS, invoices: [inv('old', 'insurance', 100), inv('new', 'insurance', 200)] });
  assert.equal(dup.outstanding, 100000);
  assert.equal(dup.outstandingCount, 1);
});

test('дубль оплаченного счёта даёт один приход в ленте', () => {
  const cash = computeCashFlow({
    jobs: JOBS,
    invoices: [
      inv('old', 'insurance', 100, { paid: true, paid_at: 150 }),
      inv('new', 'insurance', 200, { paid: true, paid_at: 250 }),
    ],
  });
  const income = cash.feed.filter((e) => e.kind === 'invoice_paid');
  assert.equal(income.length, 1);
  assert.equal(income[0].amount, 100000);
  assert.equal(cash.income, 100000);
});

test('счета разных убытков и допродаж складываются', () => {
  const invoices = [inv('a', 'insurance', 100), inv('b', 'cl_k3f9', 110), inv('c', 'client', 120)];
  assert.equal(computeCashFlow({ jobs: JOBS, invoices }).outstanding, 300000);
  assert.equal(computeFinance({ jobs: JOBS, invoices }).cash.billed, 300000);
});

test('«доп. счёт» складывается с основным', () => {
  const invoices = [
    inv('avans', 'insurance', 100, { billing_role: 'extra', totals: { total: 30000 } }),
    inv('ostatok', 'insurance', 200, { totals: { total: 70000 } }),
  ];
  assert.equal(computeCashFlow({ jobs: JOBS, invoices }).outstanding, 100000);
});

test('счёт, помеченный «не учитывать», выпадает из долга', () => {
  const invoices = [inv('good', 'insurance', 100), inv('dubl', 'insurance', 200, { billing_role: 'void' })];
  const cash = computeCashFlow({ jobs: JOBS, invoices });
  assert.equal(cash.outstanding, 100000);
  assert.equal(cash.outstandingCount, 1);
});

test('предоплата по-прежнему гасит долг по учитываемому счёту', () => {
  const jobs = [{ ...JOBS[0], prepayment_paid: true, prepayment_paid_amount: 40000, prepayment_paid_at: 120 }];
  const cash = computeCashFlow({ jobs, invoices: [inv('old', 'insurance', 100), inv('new', 'insurance', 200)] });
  assert.equal(cash.outstanding, 60000, '100 000 по одному счёту минус 40 000 предоплаты');
  assert.equal(cash.income, 40000, 'в ленте только сама предоплата');
});

test('одиночный счёт считается ровно как раньше', () => {
  const invoices = [inv('a', 'insurance', 100, { paid: true, paid_at: 150 })];
  const fin = computeFinance({ jobs: JOBS, invoices });
  assert.equal(fin.cash.billed, 100000);
  assert.equal(fin.cash.paid, 100000);
  assert.equal(fin.cash.outstanding, 0);
  assert.equal(computeCashFlow({ jobs: JOBS, invoices }).income, 100000);
});

test('счёт удалённой машины по-прежнему не всплывает в долге', () => {
  const cash = computeCashFlow({ jobs: JOBS, invoices: [{ ...inv('x', 'insurance', 100), job_id: 'ghost' }] });
  assert.equal(cash.outstanding, 0);
});
