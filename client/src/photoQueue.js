// Очередь отправки фотографий — чтобы дефектовку можно было делать без связи.
//
// ЗАЧЕМ. Приёмщик обходит машину на площадке, где интернет то есть, то нет. Раньше
// снимок уходил на сервер прямо в момент съёмки (см. photos.js): нет сети — ошибка,
// файл нигде не сохранён, надо переснимать. Теперь снимок сначала ложится СЮДА,
// в хранилище самого телефона, и виден на экране сразу; отправкой занимается
// фоновый рабочий цикл, который сам просыпается, когда связь вернулась.
//
// ГДЕ ЛЕЖИТ. IndexedDB, база `autoacademy-photos`, хранилище `queue`. Именно она,
// а не localStorage: снимки — это бинарные Blob по 150–400 КБ, в localStorage они
// не помещаются (там строки и ~5 МБ на весь домен).
//
// ЧТО ГАРАНТИРУЕМ. Снимок не пропадает: он удаляется из очереди только после того,
// как сервер принял файл И запись легла в машину. Перезагрузка страницы, закрытие
// вкладки и перезапуск телефона очередь переживает.
//
// Без зависимостей и без React — модуль дёргают и экран, и тесты.

const DB_NAME = 'autoacademy-photos';
const DB_VERSION = 1;
const STORE = 'queue';

// Пауза перед повторной попыткой после сбоя. Растёт от попытки к попытке, чтобы на
// «лежащем» сервере не долбить его каждую секунду, но не превышает минуты —
// приёмщик ждёт отправки, а не сутки.
const RETRY_MS = [2000, 5000, 15000, 30000, 60000];
const retryDelay = (tries) => RETRY_MS[Math.min(tries, RETRY_MS.length - 1)];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('job', 'jobId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Не открылось хранилище телефона'));
  });
  return dbPromise;
}

function tx(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try { result = run(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Запись в хранилище прервана'));
  }));
}

const wrap = (req) => ({ __req: req });

const uid = () => (crypto.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e9)}`);

// ─── Чтение и запись очереди ─────────────────────────────────────────────────

export async function allQueued() {
  const list = await tx('readonly', (store) => wrap(store.getAll()));
  return (list || []).sort((a, b) => a.created_at - b.created_at);
}

export async function queuedFor(jobId) {
  return (await allQueued()).filter((it) => it.jobId === jobId);
}

export async function enqueue({ jobId, slot, blob, w = 0, h = 0, name = 'photo.jpg' }) {
  const item = {
    id: uid(),
    jobId: String(jobId),
    slot: String(slot),
    blob,
    w,
    h,
    name,
    size: blob?.size || 0,
    created_at: Date.now(),
    tries: 0,
    error: '',
    next_try_at: 0,
  };
  await tx('readwrite', (store) => store.put(item));
  notify();
  kick();
  return item;
}

export async function dequeue(id) {
  await tx('readwrite', (store) => store.delete(id));
  notify();
}

async function markFailed(item, message) {
  const tries = (item.tries || 0) + 1;
  const next = { ...item, tries, error: message || 'Не удалось отправить', next_try_at: Date.now() + retryDelay(tries) };
  await tx('readwrite', (store) => store.put(next));
  notify();
}

// ─── Подписка для интерфейса ─────────────────────────────────────────────────
// Экран показывает снимки из очереди наравне с загруженными и счётчик «ждут
// отправки», поэтому ему нужно знать о каждом изменении.

const listeners = new Set();

async function notify() {
  if (!listeners.size) return;
  let list = [];
  try { list = await allQueued(); } catch { /* хранилище недоступно — считаем пустым */ }
  for (const fn of listeners) {
    try { fn(list); } catch { /* обработчик экрана не должен ронять очередь */ }
  }
}

export function subscribeQueue(fn) {
  listeners.add(fn);
  allQueued().then(fn).catch(() => fn([]));
  return () => listeners.delete(fn);
}

// ─── Рабочий цикл ────────────────────────────────────────────────────────────
// Один общий на всё приложение: несколько экранов не должны отправлять один и тот
// же снимок дважды. Отправляем ПО ОДНОМУ — на слабой мобильной сети параллельные
// загрузки только мешают друг другу.

let running = false;
let timer = null;
let sendFn = null;      // (item) => Promise<void>  — задаёт приложение (см. installSender)
let stopped = false;

// Отправку внедряет приложение, а не модуль: здесь нельзя знать ни про Firebase,
// ни про адрес фотосервера — иначе очередь было бы не прогнать тестами.
export function installSender(fn) {
  sendFn = fn;
  kick();
}

export function kick() {
  if (stopped || running || !sendFn) return;
  if (timer) { clearTimeout(timer); timer = null; }
  running = true;
  drain().finally(() => { running = false; });
}

async function drain() {
  let list;
  try { list = await allQueued(); } catch { return; }
  const now = Date.now();
  const ready = list.filter((it) => !it.next_try_at || it.next_try_at <= now);
  if (!ready.length) {
    // Есть отложенные — проснёмся к ближайшему сроку.
    const soonest = list.reduce((min, it) => Math.min(min, it.next_try_at || Infinity), Infinity);
    if (Number.isFinite(soonest)) schedule(Math.max(1000, soonest - now));
    return;
  }
  // Сеть заведомо недоступна — не тратим попытки, дождёмся события online.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  for (const item of ready) {
    try {
      await sendFn(item);
      await dequeue(item.id);
    } catch (e) {
      await markFailed(item, e?.message);
      schedule(retryDelay((item.tries || 0) + 1));
      return;   // сеть, похоже, легла — остальные подождут
    }
  }
}

function schedule(ms) {
  if (stopped || timer) return;
  timer = setTimeout(() => { timer = null; kick(); }, ms);
}

// Связь вернулась — пробуем сразу, не дожидаясь таймера. Возврат на вкладку тоже
// повод: телефон мог спать, и таймеры в фоне не срабатывали.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => kick());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
}

// Для тестов: остановить фоновые попытки.
export function stopQueue() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } }
export function startQueue() { stopped = false; kick(); }

// ─── Вспомогательное для экрана ──────────────────────────────────────────────

// Снимок из очереди в виде, пригодном для показа рядом с уже загруженными:
// картинку берём прямо из локального Blob, поэтому превью видно и без сети.
export function queuedPreview(item) {
  return {
    id: item.id,
    slot: item.slot,
    url: URL.createObjectURL(item.blob),
    pending: true,
    error: item.error || '',
    tries: item.tries || 0,
  };
}

// Сводка для шапки экрана: сколько ждёт отправки и есть ли застрявшие.
export function queueSummary(list, jobId = null) {
  const items = jobId ? (list || []).filter((it) => it.jobId === jobId) : (list || []);
  return {
    waiting: items.length,
    failing: items.filter((it) => (it.tries || 0) >= 2).length,
  };
}
