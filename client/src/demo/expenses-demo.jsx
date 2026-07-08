/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the «Мои траты» screen — NO Firebase, NO auth, seed data in
// memory. Renders the SAME <MyExpensesView> as the real screen (MyExpenses), so
// it's a faithful, credential-free preview.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MyExpensesView from '../components/MyExpensesView';
import { expensesTotal, expensesTotalThisMonth } from '../expenses';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

let idc = 100;
const SEED = [
  { id: 'e1', amount: 1500, category: 'Запчасти', note: 'Крепёж и клипсы на Камри', date: '08.07.2026', created_at: Date.now() },
  { id: 'e2', amount: 800, category: 'Бензин / дорога', note: 'Поездка на разборку', date: '07.07.2026', created_at: Date.now() - 86400000 },
  { id: 'e3', amount: 450, category: 'Доставка', note: '', date: '05.07.2026', created_at: Date.now() - 3 * 86400000 },
];

function Demo() {
  const [expenses, setExpenses] = useState(SEED);
  const [form, setForm] = useState({ amount: '', category: 'Запчасти', note: '' });
  const [busy] = useState(null);
  const [now] = useState(() => Date.now());
  const total = useMemo(() => expensesTotal(expenses), [expenses]);
  const monthTotal = useMemo(() => expensesTotalThisMonth(expenses, now), [expenses, now]);

  function onAdd() {
    const amount = Number(form.amount) || 0;
    if (amount <= 0) return;
    setExpenses((xs) => [
      { id: `e${++idc}`, amount, category: form.category, note: form.note.trim(), date: new Date().toLocaleDateString('ru-RU'), created_at: Date.now() },
      ...xs,
    ]);
    setForm({ amount: '', category: 'Запчасти', note: '' });
  }
  function onRemove(id) { setExpenses((xs) => xs.filter((e) => e.id !== id)); }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <MyExpensesView
        loading={false}
        expenses={expenses}
        total={total}
        monthTotal={monthTotal}
        form={form}
        onFormChange={setForm}
        onAdd={onAdd}
        onRemove={onRemove}
        busy={busy}
        error=""
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
