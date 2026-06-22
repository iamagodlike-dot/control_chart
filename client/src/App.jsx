import { useState } from 'react';
import Gantt from './components/Gantt';
import PostsMasters from './components/PostsMasters';
import JobForm from './components/JobForm';
import Logo from './components/Logo';
import './App.css';

const TABS = [
  { id: 'gantt', label: 'График', icon: '📅' },
  { id: 'job', label: 'Новый заказ', icon: '➕' },
  { id: 'config', label: 'Посты и мастера', icon: '⚙️' },
];

function App() {
  const [tab, setTab] = useState('gantt');
  const [ganttKey, setGanttKey] = useState(0);

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
              <span className="tab-icon">{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {tab === 'gantt' && <Gantt key={ganttKey} onCreateJob={() => setTab('job')} />}
        {tab === 'job' && <JobForm onCreated={() => { setGanttKey((k) => k + 1); setTab('gantt'); }} />}
        {tab === 'config' && <PostsMasters />}
      </main>
    </div>
  );
}

export default App;
