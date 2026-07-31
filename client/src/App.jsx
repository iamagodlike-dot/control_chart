import { Component, useEffect, useState } from 'react';
import { api } from './api';
import Gantt from './components/Gantt';
import Approval from './components/Approval';
import PostsBoard from './components/PostsBoard';
import PostsMasters from './components/PostsMasters';
import History from './components/History';
import Finance from './components/Finance';
import Parts from './components/Parts';
import Logo from './components/Logo';
import Icon from './components/Icon';
import AuthGate from './components/AuthGate';
import RoleGate from './components/RoleGate';
import UpdateNotice from './components/UpdateNotice';
import Warehouse from './components/Warehouse';
import PartsReceiving from './components/PartsReceiving';
import ReceivingHistory from './components/ReceivingHistory';
import MyWork from './components/MyWork';
import MyEarnings from './components/MyEarnings';
import Payroll from './components/Payroll';
import MyExpenses from './components/MyExpenses';
import StaffExpenses from './components/StaffExpenses';
import Requests from './components/Requests';
import Purchasing from './components/Purchasing';
import SupplierInvoices from './components/SupplierInvoices';
import Monitor from './components/Monitor';
import Intake from './components/Intake';
import PhotoQueueRunner from './components/PhotoQueueRunner';
import { GroupedTabs } from './components/NavGroup';
import { TABS } from './nav';
import { roleTabs, roleHome, roleLabel } from './roles';
import './App.css';


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
            {/* Экран в цехе: новое обновление подхватывается тихой перезагрузкой */}
            <UpdateNotice auto />
            <TVErrorBoundary>
              <Gantt tv />
            </TVErrorBoundary>
          </div>
        )}
      </AuthGate>
    );
  }

  return (
    <>
    {/* Вне AuthGate: плашка «Вышло обновление» видна и на экране входа */}
    <UpdateNotice />
    <AuthGate>
      {({ user, signOut }) => (
        <RoleGate user={user} signOut={signOut}>
          {({ role, profile }) => (
            <Dispatcher
              user={user}
              signOut={signOut}
              role={role}
              profile={profile}
              theme={theme}
              setTheme={setTheme}
            />
          )}
        </RoleGate>
      )}
    </AuthGate>
    </>
  );
}

// The signed-in app, scoped to what the current role may see. Which tabs exist,
// which one opens first, and whether the gear/ТВ buttons show are all derived
// from `role` (see roles.js) — the owner gets everything, line staff get a
// narrowed set. NOTE: this only hides UI; real data protection comes with the
// per-role Firestore rules step.
function Dispatcher({ user, signOut, role, profile, theme, setTheme }) {
  const allowed = roleTabs(role);
  const isOwner = role === 'owner';
  const visibleTabs = TABS.filter((t) => allowed.includes(t.id));

  // Deep link from a printed cell QR code (?cell=ID) should land on the склад
  // tab — but only if this role may see it; otherwise fall back to the role's home.
  const [tab, setTab] = useState(() => {
    const cell = new URLSearchParams(window.location.search).get('cell');
    const wanted = cell && allowed.includes('warehouse') ? 'warehouse' : roleHome(role);
    return allowed.includes(wanted) ? wanted : allowed[0];
  });
  const [openJobId, setOpenJobId] = useState(null);
  const [approvalCount, setApprovalCount] = useState(0);

  // Guard against ever rendering a tab this role can't see (e.g. a stale value).
  const effectiveTab = allowed.includes(tab) ? tab : (allowed.includes(roleHome(role)) ? roleHome(role) : allowed[0]);

  // Open a car's detail card (CarCard) from any tab: remember which job and jump
  // to the График tab — but only for roles that actually have it.
  function openJobDetail(jobId) {
    if (!allowed.includes('gantt')) return;
    setOpenJobId(jobId);
    setTab('gantt');
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  }

  return (
    <div className="app">
      {isOwner && <SeedDefaults />}
      {allowed.includes('approval') && <ApprovalCounter onCount={setApprovalCount} />}
      {/* Досылка снятых без связи фото — на уровне приложения, а не экрана:
          приёмщик закрывает дефектовку раньше, чем снимки успевают уйти. */}
      {allowed.includes('intake') && <PhotoQueueRunner />}
      <header className="app-header">
        <div className="app-brand">
          <Logo size={38} />
          <div className="app-brand-text">
            <span className="app-brand-title">Авто Академия</span>
            <span className="app-brand-subtitle">Кузовной ремонт — диспетчерская</span>
          </div>
        </div>
        {/* Плоский ряд хорош до пяти-шести вкладок, дальше он не влезает в шапку.
            Приёмщику доступны цех и запчасти целиком, поэтому меню у него тоже
            сворачивается в группы. Ничего не теряется: вкладки вне групп
            GroupedTabs рисует отдельными кнопками. */}
        {visibleTabs.length > 1 && (
          isOwner || visibleTabs.length > 5 ? (
            <GroupedTabs
              tabs={TABS}
              activeTab={effectiveTab}
              onSelect={setTab}
              allowed={allowed}
              home={roleHome(role)}
              approvalCount={approvalCount}
            />
          ) : (
            <nav className="tabs">
              {visibleTabs.map((t) => (
                <button key={t.id} className={effectiveTab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                  <Icon name={t.icon} size={16} />{t.label}
                  {t.id === 'approval' && approvalCount > 0 && (
                    <span className="tab-badge">{approvalCount}</span>
                  )}
                </button>
              ))}
            </nav>
          )
        )}
        <div className="app-user">
          {isOwner && (
            <button
              className={`icon-btn${effectiveTab === 'config' ? ' active' : ''}`}
              onClick={() => setTab('config')}
              title="Настройки — сотрудники, посты, мастера, страховые, реквизиты, экономика"
            >
              <Icon name="gear" size={17} />
            </button>
          )}
          <button className="icon-btn icon-btn--hide-mobile" onClick={toggleFullscreen} title="Полноэкранный режим">
            <Icon name="maximize" size={17} />
          </button>
          {isOwner && (
            <button
              className="icon-btn icon-btn--hide-mobile"
              onClick={() => window.open(`${window.location.pathname}?tv=1`, '_blank')}
              title="Открыть режим для экрана в цехе (ТВ)"
            >
              <Icon name="tv" size={17} />
            </button>
          )}
          <button
            className="icon-btn is-theme"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
          <div className="app-user-id">
            <span className="app-user-avatar"><Icon name="user" size={17} /></span>
            <span className="app-user-email">{profile?.name || user.email}</span>
            {!isOwner && <span className="app-user-role">{roleLabel(role)}</span>}
          </div>
          <button className="app-logout" onClick={signOut}>
            <Icon name="power" size={15} strokeWidth={1.8} />Выйти
          </button>
        </div>
      </header>

      <main className={`app-main${effectiveTab === 'gantt' ? ' app-main--flush' : ''}`}>
        {effectiveTab === 'mywork' && <MyWork masterId={profile?.masterId} />}
        {effectiveTab === 'earnings' && <MyEarnings masterId={profile?.masterId} />}
        {effectiveTab === 'gantt' && (
          <Gantt
            openJobId={openJobId}
            onOpenJobHandled={() => setOpenJobId(null)}
            isOwner={isOwner}
          />
        )}
        {effectiveTab === 'approval' && <Approval isOwner={isOwner} />}
        {effectiveTab === 'intake' && <Intake profile={profile} />}
        {effectiveTab === 'board' && <PostsBoard />}
        {effectiveTab === 'monitor' && <Monitor isOwner={isOwner} />}
        {effectiveTab === 'warehouse' && <Warehouse onOpenJob={openJobDetail} />}
        {effectiveTab === 'parts' && <Parts role={role} profile={profile} />}
        {effectiveTab === 'receiving' && <PartsReceiving />}
        {effectiveTab === 'receiving-history' && <ReceivingHistory />}
        {effectiveTab === 'requests' && <Requests role={role} />}
        {effectiveTab === 'purchasing' && <Purchasing />}
        {effectiveTab === 'supplier-invoices' && <SupplierInvoices role={role} profile={profile} />}
        {effectiveTab === 'expenses' && <MyExpenses />}
        {effectiveTab === 'finance' && <Finance />}
        {effectiveTab === 'payroll' && <Payroll />}
        {effectiveTab === 'staffexpenses' && <StaffExpenses />}
        {effectiveTab === 'history' && <History />}
        {effectiveTab === 'config' && <PostsMasters />}
      </main>
    </div>
  );
}

// Seeds the insurer and supplier lists once, after the user is authenticated (so
// Firestore rules allow the write). Runs regardless of which tab is open first.
function SeedDefaults() {
  useEffect(() => {
    api.insurers.ensureSeeded().catch(() => {});
    api.suppliers.ensureSeeded().catch(() => {});
  }, []);
  return null;
}

// Live badge for the «Согласование» tab. Mounted inside <AuthGate>, so the
// Firestore subscription starts only after sign-in (rules require auth).
function ApprovalCounter({ onCount }) {
  useEffect(() => {
    const unsub = api.jobs.subscribeApproval((list) => onCount(list.length), () => {});
    return () => unsub();
  }, [onCount]);
  return null;
}

export default App;
