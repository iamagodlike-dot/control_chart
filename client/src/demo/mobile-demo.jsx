/* eslint-disable react-refresh/only-export-components */
// Standalone MOBILE preview of the экспедитор's cabinet — header + оба экрана
// (Приёмка / Мои траты) with tab switching, NO Firebase. Uses the same
// ReceivingView / MyExpensesView and the same .app/.app-header/.tabs classes as
// the real app, so resizing the browser to phone width shows the true layout.
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Logo from '../components/Logo';
import Icon from '../components/Icon';
import ReceivingView from '../components/ReceivingView';
import MyExpensesView from '../components/MyExpensesView';
import { buildReceiving } from '../receiving';
import { expensesTotal, expensesTotalThisMonth } from '../expenses';
import '../App.css';

const JOBS = [
  {
    id: 'j1', car_model: 'TOYOTA CAMRY', plate: 'K456TT124', order_number: '110', client_name: 'Смирнов В.', cell_ids: ['A1'],
    parts: [
      { id: 'p1', name: 'Бампер передний', code: '52119-06', qty: 1, supplier: 'Exist', status: 'ordered', eta: '05.07' },
      { id: 'p2', name: 'Фара левая', code: '81150-33', qty: 1, supplier: 'Emex', status: 'in' },
    ],
  },
  {
    id: 'j2', car_model: 'KIA RIO', plate: 'A007KX124', order_number: '102', client_name: 'Кузнецов Д.', cell_ids: ['B3'],
    parts: [
      { id: 'p3', name: 'Капот', code: '', qty: 1, supplier: 'Разборка на Калинина', status: 'ordered', eta: '01.07' },
      { id: 'p4', name: 'Крыло переднее правое', code: '53801-06', qty: 1, supplier: 'Exist', status: 'ordered', eta: '06.07' },
    ],
  },
];

let idc = 100;
const EXP_SEED = [
  { id: 'e1', amount: 1500, category: 'Запчасти', note: 'Крепёж и клипсы на Камри', date: '08.07.2026', created_at: Date.now() },
  { id: 'e2', amount: 800, category: 'Бензин / дорога', note: 'Поездка на разборку', date: '07.07.2026', created_at: Date.now() - 86400000 },
];

const TABS = [
  { id: 'receiving', label: 'Приёмка', icon: 'box' },
  { id: 'expenses', label: 'Мои траты', icon: 'receipt' },
];

function MobileDemo() {
  const [tab, setTab] = useState('receiving');
  const [theme, setTheme] = useState('dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const [jobs, setJobs] = useState(JOBS);
  const [rfilter, setRfilter] = useState('ordered');
  const recv = useMemo(() => buildReceiving(jobs, rfilter), [jobs, rfilter]);
  function onSetStatus(jobId, partId, status) {
    setJobs((js) => js.map((j) => (j.id !== jobId ? j : { ...j, parts: j.parts.map((p) => (p.id === partId ? { ...p, status } : p)) })));
  }

  const [expenses, setExpenses] = useState(EXP_SEED);
  const [eform, setEform] = useState({ amount: '', category: 'Запчасти', note: '' });
  const [now] = useState(() => Date.now());
  const etotal = useMemo(() => expensesTotal(expenses), [expenses]);
  const emonth = useMemo(() => expensesTotalThisMonth(expenses, now), [expenses, now]);
  function eAdd() {
    const a = Number(eform.amount) || 0;
    if (a <= 0) return;
    setExpenses((xs) => [{ id: `e${++idc}`, amount: a, category: eform.category, note: eform.note.trim(), date: new Date().toLocaleDateString('ru-RU'), created_at: Date.now() }, ...xs]);
    setEform({ amount: '', category: 'Запчасти', note: '' });
  }
  function eRemove(id) { setExpenses((xs) => xs.filter((e) => e.id !== id)); }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <Logo size={38} />
          <div className="app-brand-text">
            <span className="app-brand-title">Авто Академия</span>
            <span className="app-brand-subtitle">Кузовной ремонт — диспетчерская</span>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={16} />{t.label}
            </button>
          ))}
        </nav>
        <div className="app-user">
          <button className="icon-btn icon-btn--hide-mobile" title="Полноэкранный режим"><Icon name="maximize" size={17} /></button>
          <button className="icon-btn is-theme" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title="Тема">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
          <div className="app-user-id">
            <span className="app-user-avatar"><Icon name="user" size={17} /></span>
            <span className="app-user-email">expeditor@demo</span>
            <span className="app-user-role">Экспедитор</span>
          </div>
          <button className="app-logout"><Icon name="power" size={15} strokeWidth={1.8} />Выйти</button>
        </div>
      </header>
      <main className="app-main">
        {tab === 'receiving' && (
          <ReceivingView loading={false} groups={recv.groups} counts={recv.counts} filter={rfilter} onFilter={setRfilter} onSetStatus={onSetStatus} busy={null} />
        )}
        {tab === 'expenses' && (
          <MyExpensesView loading={false} expenses={expenses} total={etotal} monthTotal={emonth} form={eform} onFormChange={setEform} onAdd={eAdd} onRemove={eRemove} busy={null} error="" />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><MobileDemo /></StrictMode>);
