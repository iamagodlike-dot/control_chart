import { useEffect, useState } from 'react';
import { api } from './api';
import Gantt from './components/Gantt';
import PostsBoard from './components/PostsBoard';
import PostsMasters from './components/PostsMasters';
import History from './components/History';
import Logo from './components/Logo';
import AuthGate from './components/AuthGate';
import Warehouse from './components/Warehouse';
import './App.css';

const TABS = [
  { id: 'gantt', label: 'График', icon: '📅' },
  { id: 'board', label: 'Загрузка', icon: '📊' },
  { id: 'warehouse', label: 'Склад', icon: '📦' },
  { id: 'history', label: 'История', icon: '🗄️' },
  { id: 'config', label: 'Посты и мастера', icon: '⚙️' },
];

function App() {
  // Deep link from a printed cell QR code (?cell=ID) should land straight on the warehouse tab.
  const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).get('cell') ? 'warehouse' : 'gantt'));
  const [openJobId, setOpenJobId] = useState(null);

  function openJobFromWarehouse(jobId) {
    setOpenJobId(jobId);
    setTab('gantt');
  }
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('auto-academy-theme') || 'dark';
    document.documentElement.dataset.theme = saved;
    return saved;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('auto-academy-theme', theme);
  }, [theme]);

  return (
    <AuthGate>
      {({ user, signOut }) => (
        <div className="app">
          <SeedDefaults />
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
              <button
                className="theme-toggle"
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              >
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
              <span className="app-user-email">{user.email}</span>
              <button onClick={signOut}>Выйти</button>
            </div>
          </header>

          <main className="app-main">
            {tab === 'gantt' && (
              <Gantt
                openJobId={openJobId}
                onOpenJobHandled={() => setOpenJobId(null)}
              />
            )}
            {tab === 'board' && <PostsBoard />}
            {tab === 'warehouse' && <Warehouse onOpenJob={openJobFromWarehouse} />}
            {tab === 'history' && <History />}
            {tab === 'config' && <PostsMasters />}
          </main>
        </div>
      )}
    </AuthGate>
  );
}

// Seeds the insurer list once, after the user is authenticated (so Firestore
// rules allow the write). Runs regardless of which tab is open first.
function SeedDefaults() {
  useEffect(() => { api.insurers.ensureSeeded().catch(() => {}); }, []);
  return null;
}

export default App;
