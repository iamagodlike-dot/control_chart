// One-off migration: copies cells/config/log from the old standalone
// warehouse app (Firestore project warehouse-a1b6c) into the dispatcher's
// Firestore project (gannt-9b15d), under the new collection names
// cells/warehouseConfig/warehouseLog, renaming part.article -> part.code.
//
// Run once from autoservice-gantt/client:
//   node scripts/migrate-warehouse-data.mjs
//
// You'll be prompted for the email/password of a user who can already log
// into the diспетчерская (target project) — this is typed locally into your
// terminal and never leaves your machine.
import { createInterface } from 'node:readline/promises';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

const sourceApp = initializeApp({
  apiKey: 'AIzaSyCYK7Jftv6LcgiGqxDkH0IcWHIqb5tcXUQ',
  authDomain: 'warehouse-a1b6c.firebaseapp.com',
  projectId: 'warehouse-a1b6c',
}, 'source');
const sourceDb = getFirestore(sourceApp);

const targetApp = initializeApp({
  apiKey: 'AIzaSyCSgtcEIXZbyeF-pMK-1jmuRlPvl3gK7zA',
  authDomain: 'gannt-9b15d.firebaseapp.com',
  projectId: 'gannt-9b15d',
}, 'target');
const targetDb = getFirestore(targetApp);
const targetAuth = getAuth(targetApp);

function convertParts(parts) {
  return (parts || []).map(({ article, ...rest }) => ({ ...rest, code: article || rest.code || '' }));
}

function convertCell(data) {
  const converted = { ...data, parts: convertParts(data.parts) };
  if (converted._archive) {
    converted._archive = converted._archive.map((entry) => ({ ...entry, parts: convertParts(entry.parts) }));
  }
  return converted;
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = await rl.question('Email (диспетчерская, gannt-9b15d): ');
  const password = await rl.question('Пароль: ');
  rl.close();
  await signInWithEmailAndPassword(targetAuth, email, password);

  const [configSnap, cellsSnap, logSnap] = await Promise.all([
    getDoc(doc(sourceDb, 'config', 'main')),
    getDocs(collection(sourceDb, 'cells')),
    getDocs(collection(sourceDb, 'log')),
  ]);

  if (configSnap.exists()) {
    await setDoc(doc(targetDb, 'warehouseConfig', 'main'), configSnap.data());
    console.log('Перенесена конфигурация склада (зоны).');
  }

  let cellCount = 0;
  for (const d of cellsSnap.docs) {
    await setDoc(doc(targetDb, 'cells', d.id), convertCell(d.data()));
    cellCount++;
  }
  console.log(`Перенесено ячеек: ${cellCount}`);

  let logCount = 0;
  for (const d of logSnap.docs) {
    await setDoc(doc(targetDb, 'warehouseLog', d.id), d.data());
    logCount++;
  }
  console.log(`Перенесено записей журнала: ${logCount}`);

  console.log('Готово.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Ошибка миграции:', err);
  process.exit(1);
});
