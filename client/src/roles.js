// Roles & access map — the single source of truth for "who sees which tabs".
// Both the app shell (App.jsx) and the admin screen (UsersAdmin) import from
// here, so the list of tabs a role gets can never drift between the two.
//
// IMPORTANT: this map only controls what the UI SHOWS. It is convenience, not a
// hard security boundary — a determined user could still read data directly from
// the database until Firestore rules are locked down per role (the next step).
// Keep sensitive collections in mind when promoting this to real enforcement.

// Tab ids must match the ids used in App.jsx's TABS list. 'config' is the gear
// (Настройки) — only the owner gets it.
export const ROLES = {
  owner: {
    label: 'Управленец',
    hint: 'Полный доступ ко всей системе',
    tabs: ['approval', 'gantt', 'board', 'warehouse', 'parts', 'receiving-history', 'requests', 'purchasing', 'supplier-invoices', 'finance', 'payroll', 'staffexpenses', 'history', 'config'],
    home: 'gantt',
  },
  master: {
    label: 'Мастер',
    hint: 'Свои машины и сроки, свой заработок, общий график цеха, заявки на закупку',
    tabs: ['mywork', 'earnings', 'gantt', 'requests'],
    home: 'mywork',
  },
  expeditor: {
    label: 'Экспедитор',
    hint: 'Приёмка, история приёмки, закупка одобренных расходников, свои траты',
    tabs: ['receiving', 'receiving-history', 'purchasing', 'expenses'],
    home: 'receiving',
  },
  partsman: {
    label: 'Запчастист',
    hint: 'Запчасти по машинам и склад',
    tabs: ['parts', 'warehouse'],
    home: 'parts',
  },
  // Инвестор: даёт деньги на запчасти. Видит ТОЛЬКО счета поставщиков (к оплате и
  // оплаченные), отмечает оплату → позиции уходят в «Заказано». Оперативные экраны
  // и финансы цеха ему не нужны — отдельная узкая роль (не «Управленец»).
  founder: {
    label: 'Учредитель',
    hint: 'Счета поставщиков: к оплате и оплаченные',
    tabs: ['supplier-invoices'],
    home: 'supplier-invoices',
  },
};

// Order the admin screen offers roles in.
export const ROLE_ORDER = ['owner', 'master', 'expeditor', 'partsman', 'founder'];

export const isKnownRole = (r) => Object.prototype.hasOwnProperty.call(ROLES, r);

// Fall back to the widest access if a record somehow carries an unknown role
// string — better to accidentally show too much (a visible bug someone reports)
// than to silently lock a real employee out with no way in.
const resolve = (role) => ROLES[role] || ROLES.owner;

export const roleTabs = (role) => resolve(role).tabs;
export const roleHome = (role) => resolve(role).home;
export const roleLabel = (role) => (ROLES[role]?.label) || role || '—';

// Decide what a signed-in login may see, given the successfully-read list of
// access records. Pure (no Firestore/React) so the transitional rules — the
// fiddly part — can be unit-tested in isolation. Returns { status, role, profile }:
//   'ready'  → allowed; use `role`
//   'denied' → signed in but not permitted (outsider or deactivated)
// A read FAILURE is the caller's concern (it fails open); this only interprets a
// list that was read. Matching is case-insensitive and tolerates records keyed
// by doc id when the `email` field is absent.
export function decideAccess(list, email) {
  const e = (email || '').trim().toLowerCase();
  const users = Array.isArray(list) ? list : [];
  const me = users.find((u) => (((u && (u.email || u.id)) || '')).trim().toLowerCase() === e);
  if (me) {
    if (me.active === false) return { status: 'denied', role: null, profile: me };
    return { status: 'ready', role: isKnownRole(me.role) ? me.role : 'owner', profile: me };
  }
  // Nobody configured yet → bootstrap the first owner (they need in to assign
  // roles). Otherwise this email simply wasn't granted access.
  if (users.length === 0) return { status: 'ready', role: 'owner', profile: null };
  return { status: 'denied', role: null, profile: null };
}
