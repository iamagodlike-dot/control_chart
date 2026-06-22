import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCSgtcEIXZbyeF-pMK-1jmuRlPvl3gK7zA',
  authDomain: 'gannt-9b15d.firebaseapp.com',
  projectId: 'gannt-9b15d',
  storageBucket: 'gannt-9b15d.firebasestorage.app',
  messagingSenderId: '1086988543414',
  appId: '1:1086988543414:web:08b9cc86b2d94b95ad4d17',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
