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
import { roleTabs } from '../roles';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

// Same metadata as App.jsx's TABS (labels + icons) — only the owner's screens.
const TABS = [
  { id: 'approval', label: 'Согласование', icon: 'shield' },
  { id: 'gantt', label: 'График', icon: 'calendar' },
  { id: 'board', label: 'Загрузка', icon: 'chart' },
  { id: 'warehouse', label: 'Склад', icon: 'box' },
  { id: 'parts', label: 'Запчасти', icon: 'wrench' },
  { id: 'requests', label: 'Заявки', icon: 'clipboard' },
  { id: 'purchasing', label: 'Закупки', icon: 'cart' },
  { id: 'finance', label: 'Финансы', icon: 'wallet' },
  { id: 'payroll', label: 'Зарплата', icon: 'receipt' },
  { id: 'staffexpenses', label: 'Траты', icon: 'receipt' },
  { id: 'history', label: 'История', icon: 'history' },
];

const allowed = roleTabs('owner');
const label = (id) => TABS.find((t) => t.id === id)?.label || id;

function Demo() {
  const [tab, setTab] = useState('gantt');
  const [pending, setPending] = useState(3);

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
          approvalCount={pending}
        />
        <div className="app-user">
          <button className="icon-btn active" title="Настройки"><Icon name="gear" size={17} /></button>
          <div className="app-user-id">
            <span className="app-user-avatar"><Icon name="user" size={17} /></span>
            <span className="app-user-email">owner@demo</span>
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
