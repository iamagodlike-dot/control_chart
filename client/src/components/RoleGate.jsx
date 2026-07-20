import { useEffect, useState } from 'react';
import { api } from '../api';
import { decideAccess } from '../roles';

// Sits between AuthGate (are you signed in?) and the app (what may you see?).
// Loads the access records once and decides this login's role, then hands
// { role, profile } to its children via a render prop — same pattern as AuthGate.
//
// Transitional behaviour, on purpose, so the owner can never lock themselves or
// the whole shop out while rolling this out:
//   • no access records configured yet        → everyone is treated as owner
//     (bootstrap: the first owner needs full access to open Настройки and start
//      assigning roles);
//   • records exist, and this email is among   → use its role;
//     them (and active)
//   • records exist but this email is missing  → access denied (a real outsider);
//     or explicitly deactivated
//   • the read itself fails (e.g. Firestore    → treated as owner (fail open).
//     rules not yet deployed)                    Hiding tabs is convenience here,
//                                                not the security boundary, so
//                                                failing open keeps the app usable
//                                                until rules land — it never grants
//                                                data access that rules would deny.
export default function RoleGate({ user, signOut, children }) {
  const email = (user?.email || '').trim().toLowerCase();
  // 'loading' | 'ready' | 'denied'
  const [state, setState] = useState({ status: 'loading', role: null, profile: null });

  useEffect(() => {
    let alive = true;

    // Страховка от «вечной» загрузки доступа: если чтение так и не завершилось
    // (обычно устройство не может достучаться до базы — заблокированный или
    // «глючный» интернет), через несколько секунд показываем экран «нет связи»
    // с кнопкой «Обновить», а не крутим спиннер бесконечно. ВАЖНО: по таймауту
    // роль НЕ выдаём — «fail open» ниже касается только реальной ошибки чтения
    // (например, пока не задеплоены правила), иначе на медленной сети сотрудник
    // мог бы случайно получить лишний доступ. Если чтение всё же дойдёт позже —
    // экран сам сменится на приложение.
    const timer = setTimeout(() => {
      if (alive) setState((s) => (s.status === 'loading' ? { status: 'error', role: null, profile: null } : s));
    }, 10000);

    (async () => {
      try {
        const list = await api.users.list();
        if (!alive) return;
        setState(decideAccess(list, email));
      } catch (err) {
        if (!alive) return;
        // Can't read access records (most likely: rules for `users` not deployed
        // yet). Fail open — the UI gate is convenience, not the wall.
        console.warn('[RoleGate] could not load access records, defaulting to full access:', err?.code || err);
        setState({ status: 'ready', role: 'owner', profile: null });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => { alive = false; clearTimeout(timer); };
  }, [email]);

  if (state.status === 'loading') {
    return (
      <div className="app">
        <div className="list-loading" style={{ minHeight: '60vh' }}>
          <div className="spinner" /><span>Загружаем доступ…</span>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="app">
        <div className="role-denied">
          <h2>Нет связи с сервером</h2>
          <p>Не удалось проверить доступ. Проверьте интернет на устройстве и попробуйте ещё раз. Если вы в мобильном интернете — подключитесь к Wi‑Fi.</p>
          <button className="app-logout" onClick={() => window.location.reload()}>Обновить</button>
        </div>
      </div>
    );
  }

  if (state.status === 'denied') {
    return (
      <div className="app">
        <div className="role-denied">
          <h2>Доступ не настроен</h2>
          <p>Для входа <b>{user?.email}</b> ещё не назначена роль. Обратитесь к руководителю, чтобы он добавил вас в разделе «Настройки → Сотрудники и доступ».</p>
          <button className="app-logout" onClick={signOut}>Выйти</button>
        </div>
      </div>
    );
  }

  return children({ role: state.role, profile: state.profile });
}
