import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { firebaseConfig } from './firebase';

// Create a Firebase Auth login (email + password) for a staff member — WITHOUT
// logging the owner out. createUserWithEmailAndPassword would normally switch the
// current session to the brand-new user; doing it on a short-lived SECONDARY app
// instance keeps the primary (owner) session untouched.
//
// Returns { ok: true } or { ok: false, code, message }. A friendly message is
// provided for the cases the owner will actually hit.
const MESSAGES = {
  'auth/email-already-in-use': 'У этого сотрудника вход уже есть — создавать не нужно.',
  'auth/invalid-email': 'Некорректный email.',
  'auth/weak-password': 'Пароль слишком простой — минимум 6 символов.',
  'auth/operation-not-allowed': 'Создание входов отключено в настройках проекта.',
};

export async function createStaffLogin(email, password) {
  const key = (email || '').trim().toLowerCase();
  if (!key || !key.includes('@')) return { ok: false, code: 'auth/invalid-email', message: MESSAGES['auth/invalid-email'] };
  if (!password || password.length < 6) return { ok: false, code: 'auth/weak-password', message: MESSAGES['auth/weak-password'] };

  const app = initializeApp(firebaseConfig, `staff-mk-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(app);
    await createUserWithEmailAndPassword(secondaryAuth, key, password);
    await signOut(secondaryAuth).catch(() => {});
    return { ok: true };
  } catch (e) {
    const code = e?.code || 'unknown';
    return { ok: false, code, message: MESSAGES[code] || 'Не удалось создать вход. Попробуйте ещё раз.' };
  } finally {
    await deleteApp(app).catch(() => {});
  }
}
