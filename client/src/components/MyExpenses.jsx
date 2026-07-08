import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { auth } from '../firebase';
import { expensesTotal, expensesTotalThisMonth } from '../expenses';
import MyExpensesView from './MyExpensesView';

// Container for «Мои траты»: loads the current user's own expenses, adds new ones,
// and removes them. Firestore rules ensure a staffer only ever sees/edits their
// own records; the owner has a separate all-staff view. Markup lives in the view.
const EMPTY_FORM = { amount: '', category: 'Запчасти', note: '' };

export default function MyExpenses() {
  const email = auth.currentUser?.email || '';
  const [expenses, setExpenses] = useState(null); // null → грузим
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  // Снимаем «сейчас» один раз при входе на экран — не в render/useMemo (иначе
  // это нечистый вызов) — для подсчёта трат за текущий месяц.
  const [now] = useState(() => Date.now());

  async function load() {
    try { setExpenses(await api.expenses.listMine(email)); }
    catch { setExpenses([]); }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const total = useMemo(() => expensesTotal(expenses || []), [expenses]);
  const monthTotal = useMemo(() => expensesTotalThisMonth(expenses || [], now), [expenses, now]);

  async function onAdd() {
    const amount = Number(form.amount) || 0;
    setError('');
    if (amount <= 0) { setError('Введите сумму больше нуля.'); return; }
    setBusy('add');
    try {
      await api.expenses.create({
        amount,
        category: form.category,
        note: form.note.trim(),
        created_by_name: auth.currentUser?.displayName || undefined,
      });
      setForm(EMPTY_FORM);
      await load();
    } catch {
      setError('Не удалось сохранить. Проверьте связь и попробуйте ещё раз.');
    } finally {
      setBusy(null);
    }
  }

  async function onRemove(id) {
    if (!confirm('Удалить эту трату?')) return;
    setBusy(id);
    try { await api.expenses.remove(id); await load(); }
    catch { /* правила/сеть */ }
    finally { setBusy(null); }
  }

  return (
    <MyExpensesView
      loading={expenses === null}
      expenses={expenses || []}
      total={total}
      monthTotal={monthTotal}
      form={form}
      onFormChange={setForm}
      onAdd={onAdd}
      onRemove={onRemove}
      busy={busy}
      error={error}
    />
  );
}
