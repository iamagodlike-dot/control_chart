import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// Exported so a throwaway secondary app instance (see staffAuth.js) can create
// staff logins without disturbing the signed-in owner's session.
export const firebaseConfig = {
  apiKey: 'AIzaSyCSgtcEIXZbyeF-pMK-1jmuRlPvl3gK7zA',
  authDomain: 'gannt-9b15d.firebaseapp.com',
  projectId: 'gannt-9b15d',
  storageBucket: 'gannt-9b15d.firebasestorage.app',
  messagingSenderId: '1086988543414',
  appId: '1:1086988543414:web:08b9cc86b2d94b95ad4d17',
};

const app = initializeApp(firebaseConfig);

// Локальный кэш (IndexedDB): переподключения и перезагрузки страницы читаются с
// устройства, а не тянут коллекции заново с сервера. Живые подписки на доске
// стоят намного меньше чтений Firestore, доска открывается мгновенно и переживает
// кратковременную потерю связи. persistentMultipleTabManager — чтобы несколько
// открытых вкладок на одном компьютере не конфликтовали за кэш.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const auth = getAuth(app);
