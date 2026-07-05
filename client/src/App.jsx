import { Component, useEffect, useState } from 'react';
import { api } from './api';
import Gantt from './components/Gantt';
import PostsBoard from './components/PostsBoard';
import PostsMasters from './components/PostsMasters';
import History from './components/History';
import Finance from './components/Finance';
import Parts from './components/Parts';
import Logo from './components/Logo';
import Icon from './components/Icon';
import AuthGate from './components/AuthGate';
import Warehouse from './components/Warehouse';
import './App.css';

const TABS = [
  { id: 'gantt', label: 'График', icon: 'calendar' },
  { id: 'board', label: 'Загрузка', icon: 'chart' },
  { id: 'warehouse', label: 'Склад', icon: 'box' },
  { id: 'parts', label: 'Запчасти', icon: 'wrench' },
  { id: 'finance', label: 'Финансы', icon: 'wallet' },
  { id: 'history', label: 'История', icon: 'history' },
];

// Unattended big-screen safety net: if a runtime error ever blanks the TV view,
// show a calm message and reload shortly after so the wall display recovers on
// its own instead of getting stuck until someone walks over to it.
class TVErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    setTimeout(() => window.location.reload(), 8000);
  }

  render() {
    if (this.state.failed) {
      return <div className="tv-error"><div className="spinner" /><span>Обновляем экран…</span></div>;
    }
    return this.props.children;
  }
}

function App() {
  // Kiosk view for the shop's wall screen: ?tv=1 renders a clean, read-only,
  // self-updating График with no app chrome.
  const isTV = new URLSearchParams(window.location.search).get('tv') === '1';
  // Deep link from a printed cell QR code (?cell=ID) should land straight on the warehouse tab.
  const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).get('cell') ? 'warehouse' : 'gantt'));
  const [openJobId, setOpenJobId] = useState(null);

  function openJobFromWarehouse(jobId) {
    setOpenJobId(jobId);
    setTab('gantt');
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
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

  if (isTV) {
    return (
      <AuthGate>
        {() => (
          <div className="app app--tv">
            <TVErrorBoundary>
              <Gantt tv />
            </TVErrorBoundary>
          </div>
        )}
      </AuthGate>
    );
  }

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
                  <Icon name={t.icon} size={16} />{t.label}
                </button>
              ))}
            </nav>
            <div className="app-user">
              <button
                className={`icon-btn${tab === 'config' ? ' active' : ''}`}
                onClick={() => setTab('config')}
                title="Настройки — посты, мастера, страховые, реквизиты, экономика"
              >
                <Icon name="gear" size={17} />
              </button>
              <button className="icon-btn" onClick={toggleFullscreen} title="Полноэкранный режим">
                <Icon name="maximize" size={17} />
              </button>
              <button
                className="icon-btn"
                onClick={() => window.open(`${window.location.pathname}?tv=1`, '_blank')}
                title="Открыть режим для экрана в цехе (ТВ)"
              >
                <Icon name="tv" size={17} />
              </button>
              <button
                className="icon-btn is-theme"
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              >
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
              </button>
              <div className="app-user-id">
                <span className="app-user-avatar"><Icon name="user" size={17} /></span>
                <span className="app-user-email">{user.email}</span>
              </div>
              <button className="app-logout" onClick={signOut}>
                <Icon name="power" size={15} strokeWidth={1.8} />Выйти
              </button>
            </div>
          </header>

          <main className={`app-main${tab === 'gantt' ? ' app-main--flush' : ''}`}>
            {tab === 'gantt' && (
              <Gantt
                openJobId={openJobId}
                onOpenJobHandled={() => setOpenJobId(null)}
              />
            )}
            {tab === 'board' && <PostsBoard />}
            {tab === 'warehouse' && <Warehouse onOpenJob={openJobFromWarehouse} />}
            {tab === 'parts' && <Parts />}
            {tab === 'finance' && <Finance />}
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
