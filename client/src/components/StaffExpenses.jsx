import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { expensesTotal, expensesInMonth, sortExpensesNewest, expensesByPerson } from '../expenses';
import StaffExpensesView from './StaffExpensesView';

// Owner-only «Траты сотрудников» screen: loads every staff member's expenses
// (Firestore rules allow the owner to read all), rolls them up per person for
// reimbursement, and lets the owner remove bad entries. Markup lives in the view.
export default function StaffExpenses() {
  const [all, setAll] = useState(null); // null → грузим
  const [period, setPeriod] = useState('month');
  const [busy, setBusy] = useState(null);
  const [now] = useState(() => Date.now());

  async function load() {
    try { setAll(await api.expenses.listAll()); }
    catch { setAll([]); }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const scoped = useMemo(() => {
    const base = period === 'month' ? expensesInMonth(all || [], now) : (all || []);
    return sortExpensesNewest(base);
  }, [all, period, now]);

  const total = useMemo(() => expensesTotal(scoped), [scoped]);
  const byPerson = useMemo(() => expensesByPerson(scoped), [scoped]);

  async function onRemove(id) {
    if (!confirm('Удалить эту трату? Она исчезнет и у сотрудника.')) return;
    setBusy(id);
    try { await api.expenses.remove(id); await load(); }
    catch { /* правила/сеть */ }
    finally { setBusy(null); }
  }

  return (
    <StaffExpensesView
      loading={all === null}
      expenses={scoped}
      total={total}
      count={scoped.length}
      byPerson={byPerson}
      period={period}
      onPeriod={setPeriod}
      onRemove={onRemove}
      busy={busy}
    />
  );
}
