/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the owner «Траты сотрудников» screen — NO Firebase, seed
// data in memory. Renders the SAME <StaffExpensesView> as the real screen.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import StaffExpensesView from '../components/StaffExpensesView';
import { expensesTotal, expensesInMonth, sortExpensesNewest, expensesByPerson } from '../expenses';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

const NOW = Date.now();
const DAY = 86400000;
const SEED = [
  { id: 'a', amount: 1500, category: 'Запчасти', note: 'Крепёж и клипсы на Камри', date: '08.07.2026', created_at: NOW, created_by: 'exp@academy', created_by_name: 'Олег (экспедитор)' },
  { id: 'b', amount: 800, category: 'Бензин / дорога', note: 'Поездка на разборку', date: '07.07.2026', created_at: NOW - DAY, created_by: 'exp@academy', created_by_name: 'Олег (экспедитор)' },
  { id: 'c', amount: 450, category: 'Доставка', note: '', date: '05.07.2026', created_at: NOW - 3 * DAY, created_by: 'exp@academy', created_by_name: 'Олег (экспедитор)' },
  { id: 'd', amount: 3200, category: 'Инструмент', note: 'Полировальник', date: '06.07.2026', created_at: NOW - 2 * DAY, created_by: 'mas@academy', created_by_name: 'Пётр (маляр)' },
  { id: 'e', amount: 1200, category: 'Запчасти', note: 'Прошлый месяц', date: '20.06.2026', created_at: NOW - 30 * DAY, created_by: 'exp@academy', created_by_name: 'Олег (экспедитор)' },
];

function Demo() {
  const [all, setAll] = useState(SEED);
  const [period, setPeriod] = useState('month');
  const [now] = useState(() => Date.now());
  const scoped = useMemo(() => sortExpensesNewest(period === 'month' ? expensesInMonth(all, now) : all), [all, period, now]);
  const total = useMemo(() => expensesTotal(scoped), [scoped]);
  const byPerson = useMemo(() => expensesByPerson(scoped), [scoped]);
  function onRemove(id) { setAll((xs) => xs.filter((e) => e.id !== id)); }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <StaffExpensesView
        loading={false}
        expenses={scoped}
        total={total}
        count={scoped.length}
        byPerson={byPerson}
        period={period}
        onPeriod={setPeriod}
        onRemove={onRemove}
        busy={null}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
