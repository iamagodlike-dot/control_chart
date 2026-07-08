// Guards the pure expense helpers. Zero-dependency — run with:
//   node --test src/expenses.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expensesTotal, expensesTotalThisMonth, expensesInMonth, sortExpensesNewest, expensesByPerson } from './expenses.js';

const ms = (y, m, d) => new Date(y, m - 1, d).getTime();

test('expensesTotal sums amounts, coercing junk to 0', () => {
  assert.equal(expensesTotal([{ amount: 500 }, { amount: '1500' }, { amount: null }, {}]), 2000);
  assert.equal(expensesTotal([]), 0);
  assert.equal(expensesTotal(null), 0);
});

test('expensesTotalThisMonth counts only the month of `now`', () => {
  const list = [
    { amount: 500, created_at: ms(2026, 7, 3) },  // июль
    { amount: 800, created_at: ms(2026, 7, 20) }, // июль
    { amount: 999, created_at: ms(2026, 6, 30) }, // июнь — не считается
  ];
  const now = ms(2026, 7, 8);
  assert.equal(expensesTotalThisMonth(list, now), 1300);
  assert.equal(expensesTotal(list), 2299); // всего — все месяцы
});

test('expensesInMonth returns only the month rows', () => {
  const list = [
    { id: 'a', amount: 500, created_at: ms(2026, 7, 3) },
    { id: 'b', amount: 999, created_at: ms(2026, 6, 30) },
  ];
  const got = expensesInMonth(list, ms(2026, 7, 8)).map((e) => e.id);
  assert.deepEqual(got, ['a']);
});

test('sortExpensesNewest orders by created_at desc without mutating', () => {
  const list = [
    { id: 'old', created_at: ms(2026, 7, 1) },
    { id: 'new', created_at: ms(2026, 7, 20) },
    { id: 'mid', created_at: ms(2026, 7, 10) },
  ];
  assert.deepEqual(sortExpensesNewest(list).map((e) => e.id), ['new', 'mid', 'old']);
  assert.equal(list[0].id, 'old'); // исходный массив не тронут
});

test('expensesByPerson rolls up per created_by, sorted by total desc', () => {
  const list = [
    { amount: 500, created_by: 'exp@a.ru', created_by_name: 'Иван' },
    { amount: 800, created_by: 'exp@a.ru' },
    { amount: 2000, created_by: 'mas@a.ru', created_by_name: 'Пётр' },
  ];
  const rows = expensesByPerson(list);
  assert.deepEqual(rows.map((r) => [r.key, r.total, r.count, r.name]), [
    ['mas@a.ru', 2000, 1, 'Пётр'],
    ['exp@a.ru', 1300, 2, 'Иван'], // имя подхватилось из первой записи, где оно есть
  ]);
});
