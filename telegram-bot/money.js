'use strict';
const dayjs = require('dayjs');
require('dayjs/locale/ru');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(isoWeek);
dayjs.locale('ru');

// ─────────────────────────────────────────────────────────────────────────────
// Финансовые расчёты. Формулы НАМЕРЕННО повторяют client/src/finance.js и
// client/src/orderDoc.js, чтобы цифры совпадали с разделом «Финансы» на сайте.
// Если там изменится логика расчёта — синхронизировать здесь.
// ─────────────────────────────────────────────────────────────────────────────

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// Диапазон [start, end] в мс, либо null для «всё время».
function periodRange(periodId, now = dayjs()) {
  const d = dayjs(now);
  switch (periodId) {
    case 'today':
      return { start: d.startOf('day').valueOf(), end: d.endOf('day').valueOf() };
    case 'week':
      return { start: d.startOf('isoWeek').valueOf(), end: d.endOf('isoWeek').valueOf() };
    case 'month':
      return { start: d.startOf('month').valueOf(), end: d.endOf('month').valueOf() };
    case 'quarter': {
      const q = Math.floor(d.month() / 3);
      return { start: d.month(q * 3).startOf('month').valueOf(), end: d.month(q * 3 + 2).endOf('month').valueOf() };
    }
    case 'year':
      return { start: d.startOf('year').valueOf(), end: d.endOf('year').valueOf() };
    default:
      return null; // всё время
  }
}

function inRange(ts, range) {
  if (!range) return true;
  const t = num(ts, NaN);
  return Number.isFinite(t) && t >= range.start && t <= range.end;
}

// Сумма счёта: как computeOrderTotals/computeDocTotals (НДС «в том числе», не меняет итог).
function computeTotal(snapshot = {}) {
  const sum = (arr) => (arr || []).reduce((a, it) => a + num(it.qty, 0) * num(it.price, 0), 0);
  const subtotal = sum(snapshot.services) + sum(snapshot.parts);
  return Math.max(0, subtotal - num(snapshot.discount, 0));
}

// Итог счёта: берём сохранённый totals.total, иначе считаем на месте — как в finance.js.
function invoiceAmount(inv = {}) {
  const t = inv.totals && typeof inv.totals.total === 'number' ? inv.totals.total : computeTotal(inv);
  return num(t, 0);
}

// Дата счёта для попадания в период: оплата, иначе выставление.
function invoiceTs(inv = {}) {
  return num(inv.paid_at, 0) || num(inv.created_at, 0);
}

// Подтверждённая предоплата по машине (только если отмечена как полученная).
function confirmedPrepayment(job = {}) {
  return job.prepayment_paid ? num(job.prepayment_paid_amount, 0) : 0;
}

// Долг по машинам с учётом предоплаты — как computeCashFlow.
// Предоплата сначала «съедается» оплаченными счетами (старые первыми),
// остаток гасит долг по неоплаченным.
function computeDebt(jobs, invoices) {
  const prepayLeft = new Map(jobs.map((j) => [j.id, confirmedPrepayment(j)]));
  const take = (jobId, total) => {
    const left = prepayLeft.get(jobId) || 0;
    const used = Math.min(left, total);
    prepayLeft.set(jobId, left - used);
    return used;
  };

  const paid = invoices.filter((i) => i.paid).sort((a, b) => invoiceTs(a) - invoiceTs(b));
  for (const inv of paid) take(inv.job_id, invoiceAmount(inv));

  const perJob = new Map();
  let total = 0;
  for (const inv of invoices.filter((i) => !i.paid)) {
    const amt = invoiceAmount(inv);
    const used = take(inv.job_id, amt);
    const due = Math.max(0, amt - used);
    if (due > 0) {
      perJob.set(inv.job_id, (perJob.get(inv.job_id) || 0) + due);
      total += due;
    }
  }
  return { total, perJob };
}

// Касса за период — как computeFinance.cash.
function computeCashPeriod(invoices, period, now = dayjs()) {
  const range = periodRange(period, now);
  const inP = invoices.filter((i) => inRange(invoiceTs(i), range));
  const paidInP = inP.filter((i) => i.paid);
  return {
    billed: inP.reduce((s, i) => s + invoiceAmount(i), 0),
    paid: paidInP.reduce((s, i) => s + invoiceAmount(i), 0),
    count: inP.length,
    paidCount: paidInP.length,
  };
}

module.exports = { periodRange, invoiceAmount, confirmedPrepayment, computeDebt, computeCashPeriod };
