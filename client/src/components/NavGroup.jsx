import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

// The owner sees ~11 screens; a flat row of that many tabs is a wall. Fold them
// into a few labelled groups so the header stays scannable. Each group's FIRST
// listed tab is its "main" screen — clicking the group opens it, the ▾ reveals
// the rest. A group lists every tab id that could belong to it; only the ids the
// current role may see actually render, so a group with one visible screen
// collapses to a plain tab and an all-hidden group disappears. Ids must match the
// TABS list in App.jsx. Only the owner gets grouping — other roles have few tabs.
const NAV_GROUPS = [
  { id: 'shop', label: 'Цех', icon: 'car', tabs: ['gantt', 'approval', 'intake', 'board', 'monitor'] },
  { id: 'parts', label: 'Запчасти', icon: 'wrench', tabs: ['parts', 'warehouse', 'receiving', 'receiving-history', 'requests', 'purchasing'] },
  { id: 'money', label: 'Деньги', icon: 'wallet', tabs: ['finance', 'payroll', 'staffexpenses', 'expenses'] },
  { id: 'archive', label: 'История', icon: 'history', tabs: ['history'] },
];

// Grouped header nav. Resolves each group's visible members from the tab metadata
// + the role's allowed list, drops empty groups, and coordinates so only one
// dropdown is open at a time. The «Согласование» badge rides on whichever group
// contains it (Цех), so a pending count stays visible without opening the menu.
export function GroupedTabs({ tabs, activeTab, onSelect, allowed, approvalCount = 0 }) {
  const [openGroup, setOpenGroup] = useState(null);
  const navRef = useRef(null);
  const byId = Object.fromEntries(tabs.map((t) => [t.id, t]));
  const groups = NAV_GROUPS
    .map((g) => ({ ...g, members: g.tabs.filter((id) => allowed.includes(id)).map((id) => byId[id]).filter(Boolean) }))
    .filter((g) => g.members.length > 0);

  // Close the open dropdown on an outside click or Esc. A pointerdown INSIDE the
  // nav (another group, the caret, a menu row) is left alone so switching groups
  // or picking an item works in a single click.
  useEffect(() => {
    if (!openGroup) return undefined;
    const onDown = (e) => { if (navRef.current && !navRef.current.contains(e.target)) setOpenGroup(null); };
    const onKey = (e) => { if (e.key === 'Escape') setOpenGroup(null); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [openGroup]);

  return (
    <nav className="tabs tabs--grouped" ref={navRef}>
      {groups.map((g) => (
        <NavGroup
          key={g.id}
          group={g}
          members={g.members}
          activeTab={activeTab}
          onSelect={onSelect}
          badge={g.members.some((m) => m.id === 'approval') ? approvalCount : 0}
          open={openGroup === g.id}
          onToggle={() => setOpenGroup((o) => (o === g.id ? null : g.id))}
          onClose={() => setOpenGroup(null)}
        />
      ))}
    </nav>
  );
}

// One entry in the header nav. A group with a single visible screen renders as a
// plain tab (indistinguishable from the old flat tabs); a group with several
// renders as a split button — clicking the label opens the group's MAIN screen
// (its first member), the ▾ opens a menu with the rest.
export default function NavGroup({ group, members, activeTab, onSelect, badge = 0, open, onToggle, onClose }) {
  // Single-screen group behaves exactly like an old flat tab.
  if (members.length === 1) {
    const only = members[0];
    return (
      <button className={activeTab === only.id ? 'active' : ''} onClick={() => { onClose(); onSelect(only.id); }}>
        <Icon name={only.icon} size={16} />{only.label}
        {badge > 0 && <span className="tab-badge">{badge}</span>}
      </button>
    );
  }

  const primary = members[0];
  const isActive = members.some((m) => m.id === activeTab);

  return (
    <div className={`tab-group${open ? ' is-open' : ''}`}>
      <button
        className={`tab-group-main${isActive ? ' active' : ''}`}
        onClick={() => { onClose(); onSelect(primary.id); }}
        title={`Открыть: ${primary.label}`}
      >
        <Icon name={group.icon} size={16} />{group.label}
        {badge > 0 && <span className="tab-badge">{badge}</span>}
      </button>
      <button
        className={`tab-group-caret${isActive ? ' active' : ''}`}
        onClick={onToggle}
        aria-label={`${group.label}: показать разделы`}
        aria-expanded={open}
      >
        <Icon name="chevron-down" size={15} />
      </button>
      {open && (
        <div className="tab-menu" role="menu">
          {members.map((m) => (
            <button
              key={m.id}
              role="menuitem"
              className={activeTab === m.id ? 'active' : ''}
              onClick={() => { onClose(); onSelect(m.id); }}
            >
              <Icon name={m.icon} size={16} />{m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
