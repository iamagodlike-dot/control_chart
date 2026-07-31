/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the owner's grouped header nav — NO Firebase, NO auth. Uses
// the SAME <GroupedTabs> the real header renders, and the SAME allowed-tab list
// from roles.js, so this is a faithful, credential-free preview. Click a group to
// open its main screen; click the ▾ to pick another screen inside the group.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GroupedTabs } from '../components/NavGroup';
import Icon from '../components/Icon';
import Logo from '../components/Logo';
import { TABS } from '../nav';
import { ROLES, ROLE_ORDER, roleHome, roleTabs } from '../roles';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

const label = (id) => TABS.find((t) => t.id === id)?.label || id;

function Demo() {
  const [role, setRole] = useState('owner');
  const [tab, setTab] = useState('gantt');
  const [pending, setPending] = useState(3);
  const allowed = roleTabs(role);

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
        <GroupedTabs
          tabs={TABS}
          activeTab={tab}
          onSelect={setTab}
          allowed={allowed}
          home={roleHome(role)}
          approvalCount={pending}
        />
        <div className="app-user">
          <button className="icon-btn active" title="Настройки"><Icon name="gear" size={17} /></button>
          <div className="app-user-id">
            <span className="app-user-avatar"><Icon name="user" size={17} /></span>
            <select value={role} onChange={(e) => { setRole(e.target.value); setTab(roleHome(e.target.value)); }}>
            {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
          </select>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center', paddingTop: 40 }}>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: 0 }}>Открытый экран</p>
          <p style={{ color: 'var(--color-text)', fontSize: 30, fontWeight: 700, margin: '6px 0 28px' }}>{label(tab)}</p>
          <button
            onClick={() => setPending((n) => (n > 0 ? 0 : 3))}
            style={{ fontSize: 13, padding: '8px 14px', borderRadius: 9, cursor: 'pointer' }}
          >
            demo: {pending > 0 ? 'убрать счётчик согласований' : 'вернуть счётчик (3)'}
          </button>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
