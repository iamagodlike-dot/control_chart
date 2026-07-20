import dayjs from 'dayjs';
import { computeCosting } from './costing';
import { periodRange, inRange, jobDate } from './finance';

// Pure helpers for the «Зарплата» screen — no React, no Firestore, same style
// as finance.js / costing.js.
//
// Two sides of a master's money:
//   • НАЧИСЛЕНО — финальные суммы «К выплате» из costing каждой машины
//     (labor_rows, введены вручную в «Себестоимости»), booked to the period
//     by the car's date (archived_at || created_at).
//   • ВЫПЛАЧЕНО — payout transactions (direction=expense, master_id set),
//     booked by their own date.
//   • ДОЛГ = начислено − выплачено за ВСЁ время (a snapshot, независимо от
//     выбранного периода) — that's the number the shop owes the master today.
//
// Payout transactions carry master_id/master_name. They are deliberately
// EXCLUDED from «прочие расходы» in computeFinance (the labour is already part
// of себестоимость) but stay in the cash-flow лента as real money out.

export const PAYROLL_CATEGORY = 'Зарплата мастера';

export function isPayoutTx(t) {
  return !!(t && t.master_id);
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// One row per master: accruals + payouts merged by master_id, with a fallback
// name match so old costing rows (typed name, no id) still land on the master.
export function computePayroll({ jobs = [], transactions = [], masters = [], company = {}, period = 'all', now = dayjs() } = {}) {
  const range = periodRange(period, now);

  const idByName = new Map((masters || []).map((m) => [(m.name || '').trim().toLowerCase(), m.id]));
  const rows = new Map();
  const ensure = (key, name, masterId) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        master_id: masterId || '',
        name: name || 'Без имени',
        accrued: 0, paid: 0,          // за выбранный период
        accruedAll: 0, paidAll: 0,    // за всё время (для долга)
        cars: [],                     // наряды за период
        payouts: [],                  // выплаты за период
      });
    }
    return rows.get(key);
  };
  const keyFor = (masterId, name) => {
    if (masterId) return masterId;
    const byName = idByName.get((name || '').trim().toLowerCase());
    return byName || `name:${(name || '').trim().toLowerCase()}`;
  };

  // Справочник целиком: мастер без начислений тоже виден (например, чтобы
  // зафиксировать аванс).
  for (const m of masters || []) ensure(m.id, m.name, m.id);

  for (const j of jobs) {
    if (!j.costing) continue;
    const t = computeCosting(j.costing, company);
    const inPeriod = inRange(jobDate(j), range);
    for (const l of t.labor_rows || []) {
      if (!(l.total > 0)) continue;
      const r = ensure(keyFor(l.master_id, l.name), l.name, l.master_id);
      r.accruedAll = round2(r.accruedAll + l.total);
      if (inPeriod) {
        r.accrued = round2(r.accrued + l.total);
        r.cars.push({
          job_id: j.id,
          label: [j.car_model, j.plate_number].filter(Boolean).join(' · ') || 'Машина',
          order_number: j.order_number || '',
          date: jobDate(j),
          works_sum: l.works_sum,   // стоимость работ мастера по наряду (справочно)
          amount: l.total,          // финальная сумма к выплате из себестоимости
          archived: !!j.archived,
        });
      }
    }
  }

  for (const t of transactions) {
    if (!isPayoutTx(t)) continue;
    const amount = num(t.amount, 0);
    if (!(amount > 0)) continue;
    const r = ensure(keyFor(t.master_id, t.master_name), t.master_name, t.master_id);
    r.paidAll = round2(r.paidAll + amount);
    const ts = dayjs(t.date).valueOf();
    if (inRange(ts, range)) {
      r.paid = round2(r.paid + amount);
      r.payouts.push({ id: t.id, ts, amount, note: t.note || '', date: t.date });
    }
  }

  const list = [...rows.values()]
    .map((r) => ({
      ...r,
      balance: round2(r.accruedAll - r.paidAll),
      cars: r.cars.sort((a, b) => b.date - a.date),
      payouts: r.payouts.sort((a, b) => b.ts - a.ts),
    }))
    // Мастера без какого-либо следа денег не показываем в списке (но они
    // доступны в форме выплаты через справочник).
    .filter((r) => r.accruedAll > 0 || r.paidAll > 0 || r.accrued > 0 || r.paid > 0)
    .sort((a, b) => (b.balance - a.balance) || a.name.localeCompare(b.name, 'ru'));

  return {
    rows: list,
    totals: {
      accrued: round2(list.reduce((s, r) => s + r.accrued, 0)),
      paid: round2(list.reduce((s, r) => s + r.paid, 0)),
      balance: round2(list.reduce((s, r) => s + r.balance, 0)),
    },
  };
}
