import dayjs from 'dayjs';
import { computeCosting } from './costing';
import { computeDocTotals } from './orderDoc';
import { PAYMENT_SHORT } from './insurance';

// Pure finance/bookkeeping helpers — no React, no Firestore. Everything the
// «Финансы» screen shows is derived here so it can be unit-tested and reused.
//
// Two money worlds, kept separate on purpose:
//   • Прибыль от ремонтов (P&L) — from each car's costing snapshot, attributed
//     to the period by the car's date (archived_at || created_at).
//   • Прочие расходы/доходы — standalone transactions (rent, salaries, taxes…),
//     attributed by their own date.
//   • Чистая прибыль = прибыль от ремонтов − прочие расходы + прочие доходы.
// The invoice/касса view (paid / debt) is a THIRD, cash-flow lens.

export const PERIODS = [
  { id: 'month', label: 'Этот месяц' },
  { id: 'quarter', label: 'Квартал' },
  { id: 'year', label: 'Год' },
  { id: 'all', label: 'Всё время' },
];

export const EXPENSE_CATEGORIES = [
  'Аренда', 'Зарплаты / оклады', 'Налоги', 'Закупка (опт)',
  'Инструмент / оборудование', 'Коммуналка', 'Реклама', 'Прочее',
];
export const INCOME_CATEGORIES = ['Прочий доход', 'Возврат', 'Прочее'];

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// [start, end] in ms for a period id, or null for «всё время» (no filter).
export function periodRange(periodId, now = dayjs()) {
  const d = dayjs(now);
  switch (periodId) {
    case 'month':
      return { start: d.startOf('month').valueOf(), end: d.endOf('month').valueOf() };
    case 'quarter': {
      const q = Math.floor(d.month() / 3);
      return { start: d.month(q * 3).startOf('month').valueOf(), end: d.month(q * 3 + 2).endOf('month').valueOf() };
    }
    case 'year':
      return { start: d.startOf('year').valueOf(), end: d.endOf('year').valueOf() };
    default:
      return null;
  }
}

export function inRange(ts, range) {
  if (!range) return true;
  const t = num(ts, NaN);
  return Number.isFinite(t) && t >= range.start && t <= range.end;
}

// The date a car's profit is booked to: completion if archived, else intake.
export function jobDate(job = {}) {
  return num(job.archived_at, 0) || num(job.created_at, 0);
}

// The date an invoice's money is booked to: when paid, else when issued.
function invoiceTs(inv = {}) {
  return num(inv.paid_at, 0) || num(inv.created_at, 0);
}
function invoiceAmount(inv = {}) {
  const t = inv.totals && typeof inv.totals.total === 'number' ? inv.totals.total : computeDocTotals(inv).total;
  return num(t, 0);
}

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

// The one aggregate the whole «Финансы» screen reads.
export function computeFinance({ jobs = [], invoices = [], transactions = [], company = {}, period = 'all', now = dayjs() } = {}) {
  const range = periodRange(period, now);

  // ---- Прибыль от ремонтов (по машинам с заполненной себестоимостью) ----
  const jobsWithCosting = jobs.filter((j) => j.costing);
  const inPeriodJobs = jobsWithCosting.filter((j) => inRange(jobDate(j), range));

  const repairs = { revenue: 0, cost: 0, parts: 0, materials: 0, labor: 0, overhead: 0, count: 0 };
  const perOrder = [];
  const payMap = new Map();      // payment_type -> {revenue, count}
  const insurerMap = new Map();  // insurer_name -> {revenue, count}
  const payrollMap = new Map();  // master name -> amount

  for (const j of inPeriodJobs) {
    const t = computeCosting(j.costing, company);
    repairs.revenue += t.revenue;
    repairs.cost += t.cost_total;
    repairs.parts += t.parts_cost;
    repairs.materials += t.materials_cost;
    repairs.labor += t.labor_cost;
    repairs.overhead += t.overhead_cost;
    repairs.count += 1;

    perOrder.push({
      id: j.id,
      car_model: j.car_model || '—',
      plate_number: j.plate_number || '',
      order_number: j.order_number || '',
      client_name: j.client_name || '',
      date: jobDate(j),
      payment_type: j.payment_type || 'cash',
      insurer_name: j.insurer_name || '',
      revenue: t.revenue,
      cost: t.cost_total,
      profit: t.profit,
      margin: t.margin_pct,
    });

    const pt = j.payment_type || 'cash';
    const pRec = payMap.get(pt) || { revenue: 0, count: 0 };
    pRec.revenue += t.revenue; pRec.count += 1; payMap.set(pt, pRec);
    if (pt === 'insurance' && j.insurer_name) {
      const iRec = insurerMap.get(j.insurer_name) || { revenue: 0, count: 0 };
      iRec.revenue += t.revenue; iRec.count += 1; insurerMap.set(j.insurer_name, iRec);
    }
    for (const l of j.costing.labor || []) {
      const name = (l.name || '').trim() || 'Без имени';
      payrollMap.set(name, (payrollMap.get(name) || 0) + num(l.amount, 0));
    }
  }
  repairs.profit = repairs.revenue - repairs.cost;
  repairs.margin = repairs.revenue > 0 ? round1((repairs.profit / repairs.revenue) * 100) : 0;

  // ---- Прочие расходы / доходы (транзакции) ----
  const txInPeriod = transactions.filter((t) => inRange(dayjs(t.date).valueOf(), range));
  const expenses = { total: 0, byCategory: new Map() };
  const otherIncome = { total: 0, byCategory: new Map() };
  for (const t of txInPeriod) {
    const amount = num(t.amount, 0);
    const bucket = t.direction === 'income' ? otherIncome : expenses;
    bucket.total += amount;
    bucket.byCategory.set(t.category || 'Прочее', (bucket.byCategory.get(t.category || 'Прочее') || 0) + amount);
  }

  const net = repairs.profit - expenses.total + otherIncome.total;

  // ---- Касса (счета): за период + общий долг (снимок, не за период) ----
  const invInPeriod = invoices.filter((i) => inRange(invoiceTs(i), range));
  const billed = invInPeriod.reduce((s, i) => s + invoiceAmount(i), 0);
  const paid = invInPeriod.filter((i) => i.paid).reduce((s, i) => s + invoiceAmount(i), 0);
  const outstanding = invoices.filter((i) => !i.paid).reduce((s, i) => s + invoiceAmount(i), 0);
  const outstandingCount = invoices.filter((i) => !i.paid).length;

  const toSortedArr = (map, extra = (k) => k) => [...map.entries()]
    .map(([k, v]) => ({ key: k, label: extra(k), ...(typeof v === 'object' ? v : { amount: v }) }))
    .sort((a, b) => (b.revenue ?? b.amount) - (a.revenue ?? a.amount));

  return {
    period, range,
    repairs,
    expenses: { total: expenses.total, byCategory: toSortedArr(expenses.byCategory) },
    otherIncome: { total: otherIncome.total, byCategory: toSortedArr(otherIncome.byCategory) },
    net,
    cash: { billed, paid, outstanding, outstandingCount, count: invInPeriod.length },
    byPayment: toSortedArr(payMap, (k) => PAYMENT_SHORT[k] || k),
    byInsurer: toSortedArr(insurerMap, (k) => k),
    payroll: toSortedArr(payrollMap).filter((p) => p.amount > 0),
    perOrder: perOrder.sort((a, b) => b.profit - a.profit),
    coverage: { withCosting: inPeriodJobs.length, totalJobs: jobs.length },
  };
}

// ---- Лента движения денег (cash-flow) ----
// Derived, never stored: подтверждённые предоплаты (job.prepayment_paid_*),
// оплаченные счета and ручные транзакции merged into one chronological feed.
// A paid invoice contributes the ДОПЛАТА (total − confirmed prepayment) so the
// same money is never counted twice; the same prepayment also reduces the
// client's outstanding debt on unpaid invoices.

export function confirmedPrepayment(job = {}) {
  return job.prepayment_paid ? num(job.prepayment_paid_amount, 0) : 0;
}

export function computeCashFlow({ jobs = [], invoices = [], transactions = [], period = 'all', now = dayjs() } = {}) {
  const range = periodRange(period, now);
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const carLabel = (j) => [j?.car_model, j?.plate_number].filter(Boolean).join(' · ') || 'Машина';
  const events = [];

  for (const j of jobs) {
    const amt = confirmedPrepayment(j);
    if (amt > 0) {
      events.push({
        id: `prepay-${j.id}`,
        ts: num(j.prepayment_paid_at, 0) || jobDate(j),
        kind: 'prepayment', direction: 'income',
        title: 'Предоплата', sub: carLabel(j),
        amount: amt, job_id: j.id,
      });
    }
  }

  // Each job's confirmed prepayment is consumed once: first by its paid
  // invoices (oldest first), the remainder then reduces unpaid-invoice debt.
  const prepayLeft = new Map(jobs.map((j) => [j.id, confirmedPrepayment(j)]));
  const take = (jobId, total) => {
    const left = prepayLeft.get(jobId) || 0;
    const used = Math.min(left, total);
    prepayLeft.set(jobId, left - used);
    return used;
  };

  const paidInvoices = invoices.filter((i) => i.paid).sort((a, b) => invoiceTs(a) - invoiceTs(b));
  for (const inv of paidInvoices) {
    const total = invoiceAmount(inv);
    const used = take(inv.job_id, total);
    const amount = Math.max(0, total - used);
    // Счёт полностью закрыт предоплатой — деньги уже показаны событием «Предоплата»,
    // нулевую строку «Доплата +0 ₽» в ленту/выгрузку не добавляем.
    if (amount === 0 && used > 0) continue;
    events.push({
      id: `inv-${inv.id}`,
      ts: invoiceTs(inv),
      kind: 'invoice_paid', direction: 'income',
      title: used > 0 ? 'Доплата по счёту' : 'Оплата по счёту',
      sub: carLabel(jobsById.get(inv.job_id)) + (inv.doc_number ? ` · №${inv.doc_number}` : ''),
      amount, job_id: inv.job_id,
    });
  }

  let outstanding = 0;
  let outstandingCount = 0;
  for (const inv of invoices.filter((i) => !i.paid)) {
    const total = invoiceAmount(inv);
    const used = take(inv.job_id, total);
    outstanding += Math.max(0, total - used);
    outstandingCount += 1;
  }

  for (const t of transactions) {
    const dir = t.direction === 'income' ? 'income' : 'expense';
    events.push({
      id: `tx-${t.id}`,
      ts: dayjs(t.date).valueOf(),
      kind: dir, direction: dir,
      title: t.category || 'Прочее', sub: t.note || '',
      amount: num(t.amount, 0), tx_id: t.id,
    });
  }

  events.sort((a, b) => b.ts - a.ts);
  const inPeriod = events.filter((e) => inRange(e.ts, range));
  const income = inPeriod.filter((e) => e.direction === 'income').reduce((s, e) => s + e.amount, 0);
  const expense = inPeriod.filter((e) => e.direction === 'expense').reduce((s, e) => s + e.amount, 0);
  return { feed: events, inPeriod, income, expense, saldo: income - expense, outstanding, outstandingCount };
}

// ---- Выгрузка для бухгалтера (CSV, открывается в Excel) ----
function csvCell(v) {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRows(rows) {
  return rows.map((r) => r.map(csvCell).join(';')).join('\n');
}

export function buildFinanceCsv(fin, periodLabel = '', cash = null) {
  const money = (n) => Math.round(num(n, 0));
  const blocks = [];
  blocks.push(csvRows([
    ['Финансовый отчёт', periodLabel],
    [],
    ['Показатель', 'Сумма, ₽'],
    ['Выручка от ремонтов', money(fin.repairs.revenue)],
    ['Себестоимость', money(fin.repairs.cost)],
    ['  — запчасти', money(fin.repairs.parts)],
    ['  — материалы', money(fin.repairs.materials)],
    ['  — оплата мастерам', money(fin.repairs.labor)],
    ['  — накладные', money(fin.repairs.overhead)],
    ['Прибыль от ремонтов', money(fin.repairs.profit)],
    ['Рентабельность, %', fin.repairs.margin],
    ['Прочие расходы', money(fin.expenses.total)],
    ['Прочие доходы', money(fin.otherIncome.total)],
    ['ЧИСТАЯ ПРИБЫЛЬ', money(fin.net)],
    [],
    ['Долг клиентов (неоплачено, всего)', money(cash ? cash.outstanding : fin.cash.outstanding)],
  ]));

  if (fin.payroll.length) {
    blocks.push(csvRows([[], ['Выплаты мастерам', 'Сумма, ₽'], ...fin.payroll.map((p) => [p.label, money(p.amount)])]));
  }
  if (fin.expenses.byCategory.length) {
    blocks.push(csvRows([[], ['Прочие расходы по категориям', 'Сумма, ₽'], ...fin.expenses.byCategory.map((c) => [c.label, money(c.amount)])]));
  }
  if (fin.perOrder.length) {
    blocks.push(csvRows([
      [], ['Заказы', 'Выручка', 'Себестоимость', 'Прибыль', 'Рентаб., %'],
      ...fin.perOrder.map((o) => [`${o.car_model} ${o.plate_number} ${o.order_number}`.trim(), money(o.revenue), money(o.cost), money(o.profit), o.margin]),
    ]));
  }
  if (cash?.inPeriod?.length) {
    blocks.push(csvRows([
      [], ['Движение денег за период'],
      ['Дата', 'Тип', 'Описание', 'Сумма, ₽'],
      ...cash.inPeriod.map((e) => [
        dayjs(e.ts).format('DD.MM.YYYY'),
        e.direction === 'income' ? 'Приход' : 'Расход',
        [e.title, e.sub].filter(Boolean).join(' — '),
        (e.direction === 'income' ? 1 : -1) * money(e.amount),
      ]),
    ]));
  }
  return blocks.join('\n');
}
