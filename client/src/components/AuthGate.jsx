import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../firebase';

const ERROR_MESSAGES = {
  'auth/invalid-credential': 'Неверный email или пароль',
  'auth/invalid-email': 'Некорректный email',
  'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже',
};

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

  if (user === undefined) {
    return (
      <div className="gantt-loading" style={{ height: '100vh' }}>
        <div className="spinner" />
        <span>Проверяем вход…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={submit}>
          <h2>Авто Академия</h2>
          <p className="panel-hint">Вход для сотрудников</p>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <div className="login-error">{error}</div>}
          <button className="primary" type="submit" disabled={submitting}>{submitting ? 'Входим…' : 'Войти'}</button>
        </form>
      </div>
    );
  }

  return children({ user, signOut: () => signOut(auth) });
}
