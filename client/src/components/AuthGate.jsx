import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../firebase';

const ERROR_MESSAGES = {
  'auth/invalid-credential': 'Неверный email или пароль',
  'auth/invalid-email': 'Некорректный email',
  'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже',
};

// Золотой пин с радар-пульсом — тот же, что на заставке основного сайта.
function Pin() {
  return (
    <div className="auth-pin-wrap">
      <span className="auth-ping" />
      <svg className="auth-pin" width="40" height="54" viewBox="0 0 40 54" xmlns="http://www.w3.org/2000/svg" fill="none">
        <defs>
          <radialGradient id="authPinG" cx="50%" cy="34%" r="70%">
            <stop offset="0%" stopColor="#f6dca2" />
            <stop offset="100%" stopColor="#e6c079" />
          </radialGradient>
        </defs>
        <path d="M20 1.5C10.6 1.5 3 9 3 18.4c0 11.8 17 33.6 17 33.6s17-21.8 17-33.6C37 9 29.4 1.5 20 1.5z" fill="url(#authPinG)" stroke="rgba(0,0,0,.35)" strokeWidth="1" />
        <circle cx="20" cy="18" r="5.6" fill="#12140f" />
      </svg>
    </div>
  );
}

// Общий каркас: тёмная карта района, уголки-видоискатель и карточка по центру.
function AuthShell({ children }) {
  return (
    <div className="auth-map">
      <span className="auth-tick auth-tl" /><span className="auth-tick auth-tr" />
      <span className="auth-tick auth-bl" /><span className="auth-tick auth-br" />
      <div className="auth-card">
        <Pin />
        <div className="auth-wordmark">Авто Академия</div>
        <div className="auth-sub">Кузов · Покраска · Детейлинг</div>
        <div className="auth-addr">Северное шоссе, 17Д стр 19 · Красноярск</div>
        {children}
      </div>
      <div className="auth-attr">© OpenStreetMap · CARTO</div>
    </div>
  );
}

export default function AuthGate({ children }) {
  const [user, setUser] = useState(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(ERROR_MESSAGES[err.code] || 'Не удалось войти');
    } finally {
      setSubmitting(false);
    }
  }

  // Пока проверяем сохранённый вход — та же заставка с полосой загрузки.
  if (user === undefined) {
    return (
      <AuthShell>
        <div className="auth-bar"><i /></div>
        <div className="auth-hint">Проверяем вход…</div>
      </AuthShell>
    );
  }

  if (!user) {
    return (
      <AuthShell>
        <div className="auth-role">Вход для сотрудников</div>
        <form className="auth-form" onSubmit={submit}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Входим…' : 'Войти'}</button>
        </form>
      </AuthShell>
    );
  }

  return children({ user, signOut: () => signOut(auth) });
}
