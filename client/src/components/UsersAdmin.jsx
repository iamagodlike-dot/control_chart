import { useEffect, useState } from 'react';
import { api } from '../api';
import { auth } from '../firebase';
import { ROLES, ROLE_ORDER } from '../roles';
import { createStaffLogin } from '../staffAuth';
import Icon from './Icon';

// «Сотрудники и доступ» — the owner-facing screen that hands out roles. Records
// are keyed by email, so granting access is just: type the person's login email,
// pick a role, done — even before they first sign in. Editing a row saves
// immediately (no separate «сохранить»), matching how the rest of Настройки
// feels. Your own row is locked so you can never accidentally strip your own
// access and lock yourself out.
export default function UsersAdmin() {
  const myEmail = (auth.currentUser?.email || '').trim().toLowerCase();
  const [users, setUsers] = useState([]);
  const [masters, setMasters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: '', name: '', role: 'master', masterId: '', password: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busyLogin, setBusyLogin] = useState(null);

  const load = async () => {
    const [u, m] = await Promise.all([api.users.list(), api.masters.list()]);
    // Stable, readable order: owners first, then by email.
    u.sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || (a.email || a.id || '').localeCompare(b.email || b.id || ''));
    setUsers(u);
    setMasters(m);
    setLoading(false);
    // First run: nobody configured yet → pre-fill the form with the current
    // login as owner so the very first step is a single click.
    if (u.length === 0 && myEmail) setForm((f) => (f.email ? f : { email: myEmail, name: '', role: 'owner', masterId: '', password: '' }));
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const masterName = (id) => masters.find((m) => m.id === id)?.name || '';

  async function addUser() {
    const email = form.email.trim().toLowerCase();
    setErr(''); setMsg('');
    if (!email || !email.includes('@')) { setErr('Введите email сотрудника (тот, которым он входит в систему).'); return; }
    const password = form.password.trim();
    if (password && password.length < 6) { setErr('Пароль слишком простой — минимум 6 символов (или оставьте поле пустым).'); return; }
    await api.users.upsert(email, {
      name: form.name.trim() || null,
      role: form.role,
      masterId: form.role === 'master' ? (form.masterId || null) : null,
      active: true,
    });
    // Роль записана. Если задан пароль — сразу создаём и сам вход (логин),
    // чтобы сотрудник мог войти. Без пароля создастся только роль (вход можно
    // добавить позже кнопкой-ключом у строки).
    if (password) {
      const res = await createStaffLogin(email, password);
      if (res.ok) setMsg(`Готово: доступ выдан и вход создан. Передайте сотруднику email «${email}» и пароль.`);
      else if (res.code === 'auth/email-already-in-use') setMsg('Доступ выдан. Вход у этого сотрудника уже был — новый пароль не понадобился.');
      else { setErr(res.message); setForm({ ...form, password: '' }); load(); return; }
    } else {
      setMsg(`Роль выдана. Чтобы ${email} смог войти — задайте ему пароль кнопкой-ключом у строки.`);
    }
    setForm({ email: '', name: '', role: 'master', masterId: '', password: '' });
    load();
  }

  // Create (or note the existence of) a login for an already-added employee —
  // the fix for «добавил роль, а войти не может».
  async function createLogin(u) {
    const email = (u.email || u.id || '').trim().toLowerCase();
    const password = window.prompt(`Пароль для входа сотрудника ${email} (минимум 6 символов).\nЗапишите его — этот пароль вы передадите сотруднику:`);
    if (password == null) return; // отмена
    setErr(''); setMsg('');
    setBusyLogin(email);
    const res = await createStaffLogin(email, password.trim());
    setBusyLogin(null);
    if (res.ok) setMsg(`Вход создан для ${email}. Передайте сотруднику этот email и пароль — он сможет войти.`);
    else setErr(res.message);
  }

  async function changeRole(u, role) {
    await api.users.upsert(u.email || u.id, { role, masterId: role === 'master' ? (u.masterId || null) : null });
    load();
  }

  async function changeMaster(u, masterId) {
    await api.users.upsert(u.email || u.id, { masterId: masterId || null });
    load();
  }

  async function toggleActive(u) {
    await api.users.upsert(u.email || u.id, { active: u.active === false });
    load();
  }

  async function removeUser(u) {
    if (!confirm(`Убрать доступ для ${u.email || u.id}? Сам аккаунт (логин/пароль) при этом не удаляется, но в систему он больше не войдёт.`)) return;
    await api.users.remove(u.email || u.id);
    load();
  }

  if (loading) {
    return (
      <div className="panel">
        <h3>Сотрудники и доступ</h3>
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Сотрудники и доступ</h3>
      <p className="panel-hint">
        Кто и что видит в системе. Управленец видит всё; мастер и экспедитор — только свои разделы.
        <b> Роль — это ещё не вход:</b> чтобы сотрудник смог войти, задайте ему пароль (поле при добавлении
        или кнопка-ключ <Icon name="key" size={12} /> у строки) — тогда создастся логин. Роль меняется сразу при выборе.
      </p>

      {users.length === 0 ? (
        <div className="list-empty">Пока никто не добавлен. Добавьте сначала себя как управленца, затем остальных.</div>
      ) : (
        <ul className="list">
          {users.map((u) => {
            const uEmail = (u.email || u.id || '').trim().toLowerCase();
            const isMe = uEmail === myEmail;
            const inactive = u.active === false;
            return (
              <li key={u.id || u.email} className={inactive ? 'list-item-muted' : ''}>
                <span className="list-icon list-icon--letter">{(u.name || u.email || u.id || '?').trim().charAt(0).toUpperCase()}</span>
                <span className="list-label">
                  {u.email || u.id}
                  {u.name ? <span className="list-sub"> — {u.name}</span> : ''}
                  {isMe ? <span className="user-you">вы</span> : ''}
                  {inactive ? <span className="user-off">отключён</span> : ''}
                  {u.role === 'master' && u.masterId ? <span className="list-sub"> · мастер: {masterName(u.masterId) || '—'}</span> : ''}
                </span>
                <span className="list-actions user-actions">
                  <select
                    value={u.role || 'owner'}
                    disabled={isMe}
                    title={isMe ? 'Нельзя изменить собственную роль' : 'Роль сотрудника'}
                    onChange={(e) => changeRole(u, e.target.value)}
                  >
                    {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
                  </select>
                  {u.role === 'master' && (
                    <select
                      value={u.masterId || ''}
                      title="К какому мастеру привязан этот вход"
                      onChange={(e) => changeMaster(u, e.target.value)}
                    >
                      <option value="">Мастер — не привязан</option>
                      {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  )}
                  <button
                    className="list-action-btn"
                    title="Создать вход (логин и пароль) для этого сотрудника"
                    disabled={busyLogin === uEmail}
                    onClick={() => createLogin(u)}
                  >
                    <Icon name="key" size={14} />
                  </button>
                  <button
                    className="list-action-btn"
                    title={isMe ? 'Нельзя отключить свой доступ' : (inactive ? 'Включить доступ' : 'Отключить доступ')}
                    disabled={isMe}
                    onClick={() => toggleActive(u)}
                  >
                    <Icon name="power" size={14} />
                  </button>
                  <button
                    className="list-action-btn danger"
                    title={isMe ? 'Нельзя убрать себя' : 'Убрать доступ'}
                    disabled={isMe}
                    onClick={() => removeUser(u)}
                  >×</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="inline-form column">
        <input
          placeholder="Email сотрудника (логин)"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') addUser(); }}
        />
        <input
          placeholder="Имя (необязательно)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') addUser(); }}
        />
        <input
          type="text"
          placeholder="Пароль для входа (мин. 6 симв.; можно задать позже)"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') addUser(); }}
        />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, masterId: '' })}>
          {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLES[r].label} — {ROLES[r].hint}</option>)}
        </select>
        {form.role === 'master' && (
          <select value={form.masterId} onChange={(e) => setForm({ ...form, masterId: e.target.value })}>
            <option value="">Привязать к мастеру (можно позже)</option>
            {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {err && <div className="auth-error">{err}</div>}
        {msg && <div className="user-msg">{msg}</div>}
        <button className="primary" onClick={addUser}>Дать доступ</button>
      </div>
    </div>
  );
}
