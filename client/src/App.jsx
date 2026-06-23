import { useState } from 'react';
import Gantt from './components/Gantt';
import PostsMasters from './components/PostsMasters';
import JobForm from './components/JobForm';
import History from './components/History';
import Logo from './components/Logo';
import AuthGate from './components/AuthGate';
import './App.css';

const TABS = [
  { id: 'gantt', label: 'График', icon: '📅' },
  { id: 'history', label: 'История', icon: '🗄️' },
  { id: 'config', label: 'Посты и мастера', icon: '⚙️' },
];

function App() {
  const [tab, setTab] = useState('gantt');
  const [ganttKey, setGanttKey] = useState(0);

  return (
    <AuthGate>
      {({ user, signOut }) => (
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
            <div className="app-user">
              <span className="app-user-email">{user.email}</span>
              <button onClick={signOut}>Выйти</button>
            </div>
          </header>

          <main className="app-main">
            {tab === 'gantt' && <Gantt key={ganttKey} onCreateJob={() => setTab('job')} />}
            {tab === 'job' && (
              <JobForm onCreated={() => { setGanttKey((k) => k + 1); setTab('gantt'); }} />
            )}
            {tab === 'history' && <History />}
            {tab === 'config' && <PostsMasters />}
          </main>
        </div>
      )}
    </AuthGate>
  );
}

export default App;
