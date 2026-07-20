// Pure helpers for the «Мои траты» (staff-entered expenses) screen. No React,
// no Firestore — same style as receiving.js / parts.js, so it's unit-testable.

// Categories offered in the add form. Tailored to what an экспедитор actually
// spends on, not the shop's accounting chart.
export const EXPENSE_CATEGORIES = ['Запчасти', 'Расходники', 'Бензин / дорога', 'Доставка', 'Инструмент', 'Прочее'];

export function expensesTotal(list = []) {
  return (Array.isArray(list) ? list : []).reduce((s, e) => s + (Number(e && e.amount) || 0), 0);
}

// Sum spent in the calendar month of `now` (by created_at, ms since epoch).
export function expensesTotalThisMonth(list = [], now = 0) {
  return expensesTotal(expensesInMonth(list, now));
}

// The subset of expenses whose created_at falls in the calendar month of `now`.
export function expensesInMonth(list = [], now = 0) {
  const ref = new Date(now);
  const y = ref.getFullYear();
  const m = ref.getMonth();
  return (Array.isArray(list) ? list : []).filter((e) => {
    const t = new Date((e && e.created_at) || 0);
    return t.getFullYear() === y && t.getMonth() === m;
  });
}

// Newest first, by created_at. Returns a new array (does not mutate input).
export function sortExpensesNewest(list = []) {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => ((b && b.created_at) || 0) - ((a && a.created_at) || 0));
}

// Roll up spend per person (keyed by created_by email). Used by the owner's
// «Траты сотрудников» screen for reimbursement. Returns
// [{ key, name, total, count }] sorted by total desc.
export function expensesByPerson(list = []) {
  const map = new Map();
  for (const e of (Array.isArray(list) ? list : [])) {
    if (!e) continue;
    const key = e.created_by || '—';
    const cur = map.get(key) || { key, name: '', total: 0, count: 0 };
    cur.total += Number(e.amount) || 0;
    cur.count += 1;
    if (!cur.name && e.created_by_name) cur.name = e.created_by_name;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
