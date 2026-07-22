import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, setDoc,
  query, orderBy, where, writeBatch, onSnapshot, runTransaction,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { DEFAULT_INSURERS } from './insurance';
import { PHASE, isRepair, isApproval } from './phase';
import { withPartIds } from './parts';
import { deletePhotoFile } from './photos';
import { formatDocNumber } from './orderDoc';
import { STREAM_INSURANCE, claimsOf, genClaimId } from './billing';

const postsCol = collection(db, 'posts');
const mastersCol = collection(db, 'masters');
const insurersCol = collection(db, 'insurers');
const suppliersCol = collection(db, 'suppliers');

// Первичное наполнение справочника поставщиков — то, чем сервис уже пользуется.
// Управленец потом добавляет/убирает своих в «Настройках».
const DEFAULT_SUPPLIERS = ['Exist', 'Emex', 'Разборка', 'Химснаб'];

// Dedupes concurrent ensureSeeded() calls (React StrictMode double-invokes the
// mount effect in dev; also guards against parallel callers) so defaults are
// never seeded twice. Reset on failure so a transient error can be retried.
let insurerSeedPromise = null;
let supplierSeedPromise = null;
const jobsCol = collection(db, 'jobs');
const stagesCol = collection(db, 'stages');
const settingsCol = collection(db, 'settings');
const cellsCol = collection(db, 'cells');
const warehouseConfigCol = collection(db, 'warehouseConfig');
const warehouseLogCol = collection(db, 'warehouseLog');
const orderDocsCol = collection(db, 'orderDocuments');
const countersCol = collection(db, 'counters');
const transactionsCol = collection(db, 'transactions');
const usersCol = collection(db, 'users');
const expensesCol = collection(db, 'expenses');
const purchaseRequestsCol = collection(db, 'purchaseRequests');
const salaryPaymentsCol = collection(db, 'salaryPayments');
const supplierInvoicesCol = collection(db, 'supplierInvoices');

function withId(snap) {
  return { id: snap.id, ...snap.data() };
}

function stripUndefined(obj) {
  const out = {};
  for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// Плоские страховые поля машины = ЗЕРКАЛО убытка №1 (claims[0]). Держим их, чтобы
// весь непереписанный код (телеграм-бот и его собранный bundle.cjs, История, Финансы
// byInsurer, сайдбар Гантта, доска «Согласование») продолжал работать без правок:
// он читает убыток №1 и просто не знает про остальные — недоговаривает, но не врёт.
//
// SERVER-OWNED, как receiving_log: пересчитывается ТОЛЬКО внутри транзакций
// addClaim/saveClaim/removeClaim. Никакой другой писатель этих полей не допускается —
// иначе зеркало и claims станут двумя источниками правды и разойдутся (прецедент в
// проекте уже есть: у splus-машин insurer_name без insurer_id, и пикер страховой
// показывает пустоту при заполненном имени в документах).
// ВАЖНО: null, а не undefined — stripUndefined выбросил бы ключ, и старое значение
// осталось бы в базе висеть (например, франшиза удалённого убытка).
export const CLAIM_MIRROR_KEYS = [
  'claim_number', 'insurer_id', 'insurer_name', 'policy_type',
  'franchise', 'order_number', 'discount',
];
function claimMirror(claims) {
  const c = (claims && claims[0]) || {};
  return {
    claim_number: c.claim_number || '',
    insurer_id: c.insurer_id || '',
    insurer_name: c.insurer_name || '',
    policy_type: c.policy_type || '',
    franchise: c.franchise ?? null,
    order_number: c.order_number || '',
    discount: Number(c.discount) || 0,
  };
}

// Statuses whose transitions are recorded in a part's приёмка history
// (part.receiving_log). «Заказано» → «Приехало в ТК» → «На складе» are the
// receiving milestones the «История приёмки» screen shows. 'need' and 'issued'
// are not receiving events, so they are deliberately not logged.
const RECEIVING_LOG_STATUSES = ['ordered', 'arrived', 'in'];

// Given a part's stored log and a status transition, return the log with one
// entry appended IFF the status actually changed INTO a tracked приёмка step.
// Always derived from the SERVER's stored log (never the caller's snapshot), so
// two people advancing parts on the same car can't wipe each other's history.
function appendReceivingLog(prevLog, prevStatus, nextStatus, by, at) {
  const log = Array.isArray(prevLog) ? prevLog.slice() : [];
  if (nextStatus && nextStatus !== prevStatus && RECEIVING_LOG_STATUSES.includes(nextStatus)) {
    log.push(stripUndefined({ status: nextStatus, at, by: by || null }));
  }
  return log;
}

// ─── Дневник переходов машины (job.status_log) — Этап 2 «Монитора» ─────────
// С этого момента КАЖДАЯ смена этапа/статуса машины дописывается в её
// status_log: [{ kind, from, to, at(ms), by }], kind ∈ 'approval' (под-статус
// согласования) | 'phase' (согласование↔ремонт, архивация) | 'stage' (этап
// маршрута; несёт ещё stage_title). Пишется ЦЕНТРАЛИЗОВАННО здесь — UI-код не
// меняется. Не деструктивно: у старых машин поля нет, «Монитор» (Этап 1)
// продолжает считать простой приблизительно; Этап 3 перейдёт на точную историю.
// Ключи job-документа, смена которых считается событием жизни машины.
const STATUS_LOG_JOB_KEYS = ['approval_status', 'phase', 'archived'];

// Близнец appendReceivingLog: дописать одно событие, если статус реально
// сменился. Возвращает ПРЕЖНИЙ массив (по ссылке), когда писать нечего, — так
// вызывающий отличает «есть что сохранять» простым сравнением ссылок.
function appendStatusLog(prevLog, { kind, from, to, at, by, stage_title }) {
  const log = Array.isArray(prevLog) ? prevLog : [];
  if (to === undefined || to === from) return log;
  return [...log, stripUndefined({ kind, from: from ?? null, to, at, by: by || null, stage_title })];
}

// Access records are keyed by the login's email (lowercased) — so the owner can
// grant a role by typing an email in Settings, before that person ever logs in,
// and no Firebase UID juggling is needed. Keep normalization in one place so the
// key written by the admin screen always matches the key read at sign-in.
const normEmail = (e) => (e || '').trim().toLowerCase();

async function stagesForJob(jobId) {
  const snap = await getDocs(query(stagesCol, where('job_id', '==', jobId)));
  return snap.docs.map(withId).sort((a, b) => (a.sequence - b.sequence) || (a.start_at > b.start_at ? 1 : -1));
}

// Joins raw collection arrays into the shape the Gantt screen needs. Kept as a
// pure function so both gantt() (one-time fetch) and subscribeGantt() (live)
// produce byte-for-byte identical output — the live screen and a refreshed one
// can never disagree.
function buildGantt(posts, allStages, jobsList, mastersList) {
  const jobsById = new Map(jobsList.map((j) => [j.id, j]));
  const mastersById = new Map(mastersList.map((m) => [m.id, m]));
  const stagesByJob = new Map();
  for (const s of allStages) {
    if (!stagesByJob.has(s.job_id)) stagesByJob.set(s.job_id, []);
    stagesByJob.get(s.job_id).push(s);
  }

  const stages = allStages
    // Машины на согласовании со страховой на таймлайн не попадают (этапов у них
    // ещё нет; фильтр — страховка на случай, если этап всё же оказался назначен).
    .filter((s) => { const j = jobsById.get(s.job_id); return !j?.archived && !isApproval(j); })
    .map((s) => {
      const job = jobsById.get(s.job_id) || {};
      const master = s.master_id ? mastersById.get(s.master_id) : null;
      return {
        ...s,
        car_model: job.car_model,
        plate_number: job.plate_number,
        client_name: job.client_name,
        order_number: job.order_number,
        storage_location: job.storage_location,
        deadline: job.deadline,
        master_name: master ? master.name : null,
      };
    })
    .sort((a, b) => (a.start_at > b.start_at ? 1 : -1));

  // Full job list (including jobs with no stages yet, i.e. queued cars), for the sidebar.
  // Машины на согласовании со страховой в очередь Графика не показываем.
  const jobs = jobsList
    .filter((j) => !j.archived && isRepair(j))
    .map((j) => ({
      ...j,
      job_id: j.id,
      stages: (stagesByJob.get(j.id) || []).sort((a, b) => (a.sequence - b.sequence) || (a.start_at > b.start_at ? 1 : -1)),
    }))
    .sort((a, b) => {
      const aTime = a.stages[0]?.start_at || a.expected_at || '';
      const bTime = b.stages[0]?.start_at || b.expected_at || '';
      return aTime > bTime ? 1 : -1;
    });

  return { posts, stages, jobs };
}

// Перевести позиции счёта поставщика в целевой статус — 'invoiced' при создании
// счёта, 'ordered' при отметке оплаты. Позиции могут быть с РАЗНЫХ машин, поэтому
// группируем по job_id и на каждую машину идёт своя транзакция (мерж по id —
// безопасно к параллельным правкам, как savePart). Переход разрешён только из
// «правильного» исходного статуса → идемпотентно (повторная оплата ничего не
// двигает) и без регресса. Возвращает список затронутых машин (для синка склада).
async function setInvoiceParts(items, targetStatus, { invoiceId, supplier } = {}) {
  const by = normEmail(auth.currentUser?.email);
  const at = Date.now();
  const orderedAt = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  const from = targetStatus === 'ordered' ? ['need', 'invoiced'] : ['need', 'invoiced'];
  const sup = String(supplier || '').trim();
  const byJob = new Map();
  for (const it of (items || [])) {
    if (!it || !it.job_id || !it.part_id) continue;
    if (!byJob.has(it.job_id)) byJob.set(it.job_id, new Set());
    byJob.get(it.job_id).add(it.part_id);
  }
  const affected = [];
  for (const [jobId, partIds] of byJob.entries()) {
    const jref = doc(jobsCol, jobId);
    const synced = await runTransaction(db, async (tx) => {
      const js = await tx.get(jref);
      if (!js.exists()) return null;
      const data = js.data();
      const parts = (data.parts || []).slice();
      let changed = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        // Пустой статус = «Требуется» (как в normalizePart): позиции без статуса
        // (импорт/ручной ввод) тоже должны переводиться в счёт, а не игнорироваться.
        const curStatus = p.status || 'need';
        if (!partIds.has(p.id) || !from.includes(curStatus) || curStatus === targetStatus) continue;
        const merged = { ...p, status: targetStatus };
        if (targetStatus === 'ordered') merged.orderedAt = p.orderedAt || orderedAt;
        if (targetStatus === 'invoiced' && invoiceId !== undefined) merged.supplier_invoice_id = invoiceId;
        // Поставщик счёта — авторитетный: проставляем его на позиции при выставлении,
        // чтобы у заказанных позиций был поставщик (в «Заказано» уходят через оплату,
        // минуя ручной ввод §13).
        if (targetStatus === 'invoiced' && sup) merged.supplier = sup;
        // Приёмка server-owned: лог пишется только при входе в receiving-статус
        // ('ordered'/'arrived'/'in'); переход в 'invoiced' историю не трогает.
        merged.receiving_log = appendReceivingLog(p.receiving_log, p.status, targetStatus, by, at);
        parts[i] = merged;
        changed = true;
      }
      if (!changed) return null;
      tx.update(jref, { parts });
      return { id: jobId, ...data, parts };
    });
    if (synced) affected.push(synced);
  }
  for (const j of affected) if (jobCellIds(j).length) await api.warehouse.syncParts(j);
  return affected;
}

export const api = {
  posts: {
    async list() {
      const snap = await getDocs(query(postsCol, orderBy('sort_order')));
      return snap.docs.map(withId);
    },
    async create(data) {
      const ref = await addDoc(postsCol, stripUndefined({ sort_order: 0, ...data }));
      return withId(await getDoc(ref));
    },
    async update(id, data) {
      await updateDoc(doc(postsCol, id), stripUndefined(data));
      return withId(await getDoc(doc(postsCol, id)));
    },
    // Deleting a post cascades its stages atomically — matching the confirm dialog's
    // promise and preventing orphan stages that would vanish from the график.
    async remove(id) {
      const snap = await getDocs(query(stagesCol, where('post_id', '==', id)));
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(postsCol, id));
      await batch.commit();
      return { ok: true };
    },
  },

  masters: {
    async list() {
      const snap = await getDocs(mastersCol);
      return snap.docs.map(withId);
    },
    async create(data) {
      const ref = await addDoc(mastersCol, stripUndefined(data));
      return withId(await getDoc(ref));
    },
    async update(id, data) {
      await updateDoc(doc(mastersCol, id), stripUndefined(data));
      return withId(await getDoc(doc(mastersCol, id)));
    },
    // Deleting a master unassigns them from their stages (the scheduled work stays,
    // just «не назначен») instead of leaving a dangling master_id no one can resolve.
    async remove(id) {
      const snap = await getDocs(query(stagesCol, where('master_id', '==', id)));
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.update(d.ref, { master_id: null }));
      batch.delete(doc(mastersCol, id));
      await batch.commit();
      return { ok: true };
    },
  },

  // Access control: one doc per login, keyed by email. { email, name, role,
  // masterId?, active }. role ∈ owner | master | expeditor. `owner` sees the
  // whole app; the others get a restricted set of tabs (and, later, their own
  // personalized screens). This only decides what the UI SHOWS — it is not yet a
  // hard wall (that comes with Firestore rules in the next step).
  users: {
    async list() {
      const snap = await getDocs(usersCol);
      return snap.docs.map(withId);
    },
    subscribe(onData, onError) {
      return onSnapshot(usersCol, (s) => onData(s.docs.map(withId)), onError);
    },
    async get(email) {
      const key = normEmail(email);
      if (!key) return null;
      const snap = await getDoc(doc(usersCol, key));
      return snap.exists() ? withId(snap) : null;
    },
    // setDoc(merge) with a deterministic email key: re-granting the same email
    // updates the existing record instead of creating a duplicate.
    async upsert(email, data) {
      const key = normEmail(email);
      await setDoc(doc(usersCol, key), stripUndefined({ email: key, active: true, ...data }), { merge: true });
      return withId(await getDoc(doc(usersCol, key)));
    },
    async remove(email) {
      await deleteDoc(doc(usersCol, normEmail(email)));
      return { ok: true };
    },
  },

  insurers: {
    async list() {
      const snap = await getDocs(query(insurersCol, orderBy('sort_order')));
      return snap.docs.map(withId);
    },
    async create(data) {
      const ref = await addDoc(insurersCol, stripUndefined({ sort_order: 0, ...data }));
      return withId(await getDoc(ref));
    },
    async update(id, data) {
      await updateDoc(doc(insurersCol, id), stripUndefined(data));
      return withId(await getDoc(doc(insurersCol, id)));
    },
    async remove(id) {
      await deleteDoc(doc(insurersCol, id));
      return { ok: true };
    },
    // Fill the list with common Russian insurers the first time only. A flag in
    // settings/company prevents re-seeding after the shop curates the list.
    // Seeded atomically with DETERMINISTIC ids (`default-N`) in one writeBatch so
    // that (a) two clients seeding a fresh install concurrently overwrite the
    // same 12 ids instead of creating 24 duplicates, and (b) a partial failure
    // can never leave orphan docs that block a retry — it's all-or-nothing.
    ensureSeeded() {
      if (insurerSeedPromise) return insurerSeedPromise;
      insurerSeedPromise = (async () => {
        const snap = await getDocs(insurersCol);
        if (!snap.empty) return;
        const company = await api.settings.getCompany();
        if (company.insurersSeeded) return;
        const now = Date.now();
        const batch = writeBatch(db);
        DEFAULT_INSURERS.forEach((name, i) => {
          batch.set(doc(insurersCol, `default-${i}`), { name, sort_order: i, created_at: now });
        });
        batch.set(doc(settingsCol, 'company'), { insurersSeeded: true }, { merge: true });
        await batch.commit();
      })().catch((e) => { insurerSeedPromise = null; throw e; });
      return insurerSeedPromise;
    },
  },

  // Справочник поставщиков запчастей. Управляет им только управленец (в «Настройках»),
  // а на экране «Запчасти» имена подставляются как подсказки в поле «Поставщик».
  // Устроен так же, как insurers: сортировка по sort_order, разовое наполнение
  // текущими поставщиками при первом запуске (флаг в settings/company).
  suppliers: {
    async list() {
      const snap = await getDocs(query(suppliersCol, orderBy('sort_order')));
      return snap.docs.map(withId);
    },
    async create(data) {
      const ref = await addDoc(suppliersCol, stripUndefined({ sort_order: 0, ...data }));
      return withId(await getDoc(ref));
    },
    async update(id, data) {
      await updateDoc(doc(suppliersCol, id), stripUndefined(data));
      return withId(await getDoc(doc(suppliersCol, id)));
    },
    async remove(id) {
      await deleteDoc(doc(suppliersCol, id));
      return { ok: true };
    },
    // Наполняем справочник теми поставщиками, что уже были зашиты в код, — один
    // раз. Флаг в settings/company не даёт заново засеять список после того, как
    // сервис его отредактировал. Детерминированные id (`default-N`) в одном
    // writeBatch: два клиента на чистой базе перезапишут те же документы, а не
    // создадут дубли, и частичный сбой не оставит осиротевших записей.
    ensureSeeded() {
      if (supplierSeedPromise) return supplierSeedPromise;
      supplierSeedPromise = (async () => {
        const snap = await getDocs(suppliersCol);
        if (!snap.empty) return;
        const company = await api.settings.getCompany();
        if (company.suppliersSeeded) return;
        const now = Date.now();
        const batch = writeBatch(db);
        DEFAULT_SUPPLIERS.forEach((name, i) => {
          batch.set(doc(suppliersCol, `default-${i}`), { name, sort_order: i, created_at: now });
        });
        batch.set(doc(settingsCol, 'company'), { suppliersSeeded: true }, { merge: true });
        await batch.commit();
      })().catch((e) => { supplierSeedPromise = null; throw e; });
      return supplierSeedPromise;
    },
  },

  jobs: {
    async list() {
      const snap = await getDocs(query(jobsCol, orderBy('created_at', 'desc')));
      const jobs = snap.docs.map(withId);
      for (const job of jobs) job.stages = await stagesForJob(job.id);
      return jobs;
    },
    // Every job (active + archived) with all its own fields but NO stages — one
    // query, no N+1. Used by the finance/analytics screen which only needs
    // costing / payment_type / dates, not the route.
    async listAllBrief() {
      const snap = await getDocs(jobsCol);
      return snap.docs.map(withId);
    },
    async get(id) {
      const snap = await getDoc(doc(jobsCol, id));
      if (!snap.exists()) return null;
      const job = withId(snap);
      job.stages = await stagesForJob(job.id);
      return job;
    },
    async create(data) {
      const { stages = [], ...jobFields } = data;
      // Every part must carry a stable id (imports arrive без id) — else per-part
      // delete/save on the Запчасти screen can't match the stored position.
      if (Array.isArray(jobFields.parts)) jobFields.parts = withPartIds(jobFields.parts);
      // Автономер заказ-наряда: номер не вписан вручную → берём следующий из счётчика
      // ЗН текущего года (ЗН-2026-0001, 0002…). Массовый импорт из Splus (importOne)
      // сюда не заходит и сохраняет свои исходные номера. Сбой счётчика (напр. правила
      // Firestore ещё не задеплоены) НЕ должен мешать заведению машины — тогда просто
      // оставляем номер пустым (поле и раньше было необязательным).
      //
      // НОВАЯ МАШИНА НЕ ПИШЕТ claims[] — и не должна. Плоские поля (order_number,
      // claim_number, franchise…) И ЕСТЬ убыток №1: claimsOf соберёт его на лету, как
      // phase.js трактует отсутствие job.phase. Массив материализуется только при
      // заведении ВТОРОГО дела (api.jobs.addClaim). Это и есть ленивая миграция:
      // в базе не меняется ничего, пока второй убыток реально не понадобился.
      if (!String(jobFields.order_number || '').trim()) {
        try {
          const year = new Date().getFullYear();
          jobFields.order_number = formatDocNumber('order', year, await api.counters.next('order', year));
        } catch (e) {
          console.warn('Не удалось получить номер заказ-наряда из счётчика:', e);
        }
      }
      const jobRef = await addDoc(jobsCol, stripUndefined({ ...jobFields, created_at: Date.now() }));
      await Promise.all(stages.map((s, i) => addDoc(stagesCol, stripUndefined({
        job_id: jobRef.id,
        post_id: s.post_id,
        master_id: s.master_id ?? null,
        sequence: s.sequence ?? i,
        title: s.title || null,
        start_at: s.start_at,
        end_at: s.end_at,
        status: s.status || 'planned',
      }))));
      const job = withId(await getDoc(jobRef));
      job.stages = await stagesForJob(job.id);
      return job;
    },
    // Массовый импорт одного заказа «как есть» (для переноса из Splus). В отличие
    // от create(): пишет переданный created_at (чтобы сохранить исходную дату
    // заказа) и не создаёт этапов маршрута. Возвращает id новой записи.
    async importOne(fields) {
      const ref = await addDoc(jobsCol, stripUndefined(fields));
      return ref.id;
    },
    async update(id, data) {
      // Only when parts are part of this update (e.g. a fresh Audatex import) —
      // give them ids. Plain edits omit `parts` and leave the stored array as-is.
      const payload = Array.isArray(data.parts) ? { ...data, parts: withPartIds(data.parts) } : data;
      // ЗЕРКАЛО claims[0] ↔ плоские страховые поля. Штатное сохранение карточки шлёт
      // {claim_number, franchise, …} целиком — у машины С НЕСКОЛЬКИМИ убытками это
      // разъехалось бы с claims[0] и стало вторым источником правды. Поэтому если в
      // payload есть зеркальные ключи И у машины уже материализован claims[] —
      // дописываем те же значения в claims[0] в ОДНОЙ транзакции.
      //
      // У машин без claims[] (все ~100 машин прода до первого второго убытка) ветка
      // не срабатывает вообще: update ведёт себя ровно как раньше. Плюс это делает
      // правку убытка №1 самолечащейся — карточке не нужно особого случая для него.
      const touchesMirror = CLAIM_MIRROR_KEYS.some((k) => k in payload);
      // Дневник переходов: смена под-статуса согласования, фазы или архивация —
      // событие жизни машины, дописываем в job.status_log. Прежнее значение
      // берём из ХРАНИМОГО документа внутри транзакции (не из снапшота вызывающего).
      const touchesLog = STATUS_LOG_JOB_KEYS.some((k) => k in payload);
      if (touchesMirror || touchesLog) {
        const ref = doc(jobsCol, id);
        // Кто/когда — один раз ВНЕ транзакции, чтобы ретрай не сдвигал время
        // (тот же приём, что в savePart).
        const by = auth.currentUser?.email || null;
        const at = Date.now();
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error('Машина не найдена');
          const stored = snap.data();
          const clean = stripUndefined(payload);
          const update = { ...clean };
          if (touchesMirror && Array.isArray(stored.claims) && stored.claims.length) {
            const claims = stored.claims.map((c) => ({ ...c }));
            for (const k of CLAIM_MIRROR_KEYS) if (k in clean) claims[0][k] = clean[k];
            Object.assign(update, { claims, ...claimMirror(claims) });
          }
          if (touchesLog) {
            let log = Array.isArray(stored.status_log) ? stored.status_log : [];
            if ('approval_status' in clean) {
              log = appendStatusLog(log, { kind: 'approval', from: stored.approval_status, to: clean.approval_status, at, by });
            }
            if ('phase' in clean) {
              // Отсутствие phase у старых машин = ремонт (см. phase.js) — так и логируем.
              log = appendStatusLog(log, { kind: 'phase', from: stored.phase || PHASE.REPAIR, to: clean.phase, at, by });
            }
            if ('archived' in clean) {
              log = appendStatusLog(log, {
                kind: 'phase',
                from: stored.archived ? 'archived' : 'active',
                to: clean.archived ? 'archived' : 'active',
                at,
                by,
              });
            }
            if (log !== stored.status_log && log.length) update.status_log = log;
          }
          tx.update(ref, update);
        });
      } else {
        await updateDoc(doc(jobsCol, id), stripUndefined(payload));
      }
      const job = withId(await getDoc(doc(jobsCol, id)));
      job.stages = await stagesForJob(id);
      return job;
    },
    // Delete a job with everything that belongs ONLY to it: its stages AND its
    // issued documents (заказ-наряд/счёт/акт/ПП). Without the latter, an unpaid счёт
    // would keep inflating «Долг клиентов» forever with no car to open. One batch.
    async remove(id) {
      const [jobSnap, stagesSnap, docsSnap] = await Promise.all([
        getDoc(doc(jobsCol, id)),
        getDocs(query(stagesCol, where('job_id', '==', id))),
        getDocs(query(orderDocsCol, where('job_id', '==', id))),
      ]);
      const batch = writeBatch(db);
      stagesSnap.docs.forEach((d) => batch.delete(d.ref));
      docsSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(jobsCol, id));
      await batch.commit();
      // Best-effort: wipe the car's photo files so the server disk doesn't keep
      // orphans. Never blocks the delete — a server hiccup just leaves stray files.
      const photos = jobSnap.exists() ? (jobSnap.data().photos || []) : [];
      await Promise.all(photos.map((p) => deletePhotoFile(p.path).catch(() => {})));
      return { ok: true };
    },
    async archive(id) {
      return api.jobs.update(id, { archived: true, archived_at: Date.now() });
    },
    async unarchive(id) {
      return api.jobs.update(id, { archived: false, archived_at: null });
    },

    // Live list of active jobs — fires on any change from any device. Returns an
    // unsubscribe fn. Used by the Запчасти screen so several users editing the
    // same shop see each other's changes without a refresh.
    subscribeActive(onData, onError = () => {}) {
      return onSnapshot(jobsCol, (s) => onData(s.docs.map(withId).filter((j) => !j.archived)), onError);
    },

    // Live list of cars currently in the «Согласование со страховой» phase — used
    // by the Approval board. Same shape as subscribeActive, filtered to phase.
    subscribeApproval(onData, onError = () => {}) {
      return onSnapshot(jobsCol, (s) => onData(s.docs.map(withId).filter((j) => !j.archived && isApproval(j))), onError);
    },

    // Concurrency-safe write of ONE part inside job.parts. A transaction re-reads
    // the current array on the server and merges just this part by id, so two
    // users editing the same car never clobber each other's parts (the old
    // whole-array update did). Upserts: replaces the part if present, else appends.
    async savePart(jobId, part) {
      const ref = doc(jobsCol, jobId);
      const clean = stripUndefined({ ...part, qty: Number(part.qty) || 1, cost: Number(part.cost) || 0, price: Number(part.price) || 0 });
      // Who/when for the приёмка history entry, captured once outside the retryable
      // transaction so a retry doesn't shift the timestamp.
      const by = auth.currentUser?.email || null;
      const at = Date.now();
      const synced = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        const parts = (data.parts || []).slice();
        const i = parts.findIndex((p) => p.id === part.id);
        if (i >= 0) {
          const prev = parts[i];
          const merged = { ...prev, ...clean };
          // Receiving history is server-owned: recompute from the stored log,
          // ignoring whatever receiving_log the caller may have carried in.
          merged.receiving_log = appendReceivingLog(prev.receiving_log, prev.status, merged.status, by, at);
          parts[i] = merged;
        } else {
          // A part created straight into a receiving status (e.g. «Заказано») gets
          // its first history entry too.
          clean.receiving_log = appendReceivingLog([], undefined, clean.status, by, at);
          parts.push(clean);
        }
        tx.update(ref, { parts });
        return { id: jobId, ...data, parts };
      });
      // Keep any linked warehouse cell in step: cells hold a COPY of the car's
      // parts, so every part edit must refresh them (else the Склад shows a stale list).
      if (synced && jobCellIds(synced).length) await api.warehouse.syncParts(synced);
    },

    // То же, что savePart, но для СПИСКА позиций: одна транзакция и одна синхронизация
    // склада на всех. Нужно импорту калькуляции Audatex — в смете 20–40 запчастей, а
    // по одной это 20–40 круговых поездок: сохранение карточки висело бы минуту и
    // могло оборваться на середине (половина позиций записана, половина нет).
    //
    // Семантика ОДИН В ОДИН с savePart, иначе вызывающему пришлось бы держать в голове
    // два разных поведения: транзакция перечитывает массив на сервере, каждая позиция
    // мержится по id (upsert), а receiving_log пересчитывается из ХРАНИМОГО лога —
    // поэтому параллельная правка чужих позиций на экране «Запчасти» не теряется, а
    // повторное сохранение той же строки обновляет её, а не пропускает.
    async saveParts(jobId, list = []) {
      const incoming = (Array.isArray(list) ? list : []).filter((p) => p && typeof p === 'object');
      if (!incoming.length) return;
      // Как в savePart: кто/когда фиксируем ОДИН раз вне транзакции, чтобы ретрай
      // не сдвинул время в истории приёмки.
      const by = auth.currentUser?.email || null;
      const at = Date.now();
      const ref = doc(jobsCol, jobId);
      const synced = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        const parts = (data.parts || []).slice();
        for (const raw of withPartIds(incoming)) {
          const clean = stripUndefined({
            ...raw,
            qty: Number(raw.qty) || 1,
            cost: Number(raw.cost) || 0,
            price: Number(raw.price) || 0,
          });
          const i = parts.findIndex((p) => p.id === clean.id);
          if (i >= 0) {
            const prev = parts[i];
            const merged = { ...prev, ...clean };
            merged.receiving_log = appendReceivingLog(prev.receiving_log, prev.status, merged.status, by, at);
            parts[i] = merged;
          } else {
            clean.receiving_log = appendReceivingLog([], undefined, clean.status, by, at);
            parts.push(clean);
          }
        }
        tx.update(ref, { parts });
        return { id: jobId, ...data, parts };
      });
      if (synced && jobCellIds(synced).length) await api.warehouse.syncParts(synced);
    },
    // ===== Убытки (страховые дела) =====
    // По одной машине страховая может завести НЕСКОЛЬКО дел. Каждое — свой поток
    // биллинга со своими реквизитами и своим номером ЗН (см. billing.js).
    //
    // ЗЕРКАЛО: claims[0] дублируется в плоские поля машины (claim_number, insurer_id,
    // insurer_name, policy_type, franchise, order_number, discount). Оно SERVER-OWNED —
    // пересчитывается ТОЛЬКО здесь, внутри транзакции, по образцу receiving_log. Ввод
    // вызывающего игнорируется. Благодаря зеркалу весь непереписанный код (телеграм-бот,
    // История, Финансы, сайдбар Гантта) продолжает работать без единой правки: он
    // читает убыток №1 и просто не знает про остальные.
    async addClaim(jobId, claim = {}) {
      const ref = doc(jobsCol, jobId);
      // Номер ЗН нового дела — следующий из годовой очереди. Страховая заводит дело
      // по номеру заказ-наряда, поэтому два дела с одним номером недопустимы. Берём
      // номер ДО транзакции: счётчик — своя транзакция, вложить её нельзя.
      let orderNumber = String(claim.order_number || '').trim();
      if (!orderNumber) {
        const year = new Date().getFullYear();
        orderNumber = formatDocNumber('order', year, await api.counters.next('order', year));
      }
      const id = claim.id && claim.id !== STREAM_INSURANCE ? String(claim.id) : genClaimId();
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Машина не найдена');
        const data = snap.data();
        // claimsOf материализует убыток №1 из плоских полей, если claims ещё нет —
        // ленивая миграция происходит ровно здесь, при заведении ВТОРОГО дела.
        const claims = claimsOf({ id: jobId, ...data }).map((c) => ({ ...c }));
        if (claims.some((c) => c.id === id)) throw new Error('Убыток с таким id уже есть');
        claims.push(stripUndefined({
          id,
          claim_number: claim.claim_number || '',
          insurer_id: claim.insurer_id || '',
          insurer_name: claim.insurer_name || '',
          policy_type: claim.policy_type || '',
          franchise: claim.franchise ?? null,
          order_number: orderNumber,
          discount: Number(claim.discount) || 0,
          deadline: claim.deadline || null,
          approval_status: claim.approval_status || null,
          approval_since: claim.approval_since || null,
        }));
        tx.update(ref, { claims, ...claimMirror(claims) });
        return { id: jobId, ...data, claims };
      });
    },
    // Правка реквизитов ОДНОГО дела (мерж по id, как savePart по позиции): двое
    // правят разные убытки одной машины и не затирают друг друга.
    async saveClaim(jobId, claim = {}) {
      const ref = doc(jobsCol, jobId);
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Машина не найдена');
        const data = snap.data();
        const claims = claimsOf({ id: jobId, ...data }).map((c) => ({ ...c }));
        const i = claims.findIndex((c) => c.id === claim.id);
        if (i < 0) throw new Error('Убыток не найден');
        // id менять нельзя НИКОГДА: он же лежит меткой в payer у позиций. Смена id
        // осиротила бы все позиции этого дела (itemsForStream матчит точным равенством).
        const patch = { ...claim };
        delete patch.id;
        claims[i] = { ...claims[i], ...stripUndefined(patch) };
        tx.update(ref, { claims, ...claimMirror(claims) });
        return { id: jobId, ...data, claims };
      });
    },
    // Удаление дела. Позиции удаляемого убытка ПЕРЕЕЗЖАЮТ в убыток №1 (меняем только
    // payer — id позиции, история приёмки, закупка и фото сохраняются), иначе они
    // осиротели бы: их метка перестала бы совпадать с любым существующим потоком, и
    // они молча исчезли бы из всех документов и из себестоимости.
    async removeClaim(jobId, claimId) {
      // ЗАПРЕТ, ЗАКРЕПЛЁННЫЙ ТЕСТОМ. 'insurance' — одновременно id убытка №1 И дефолт
      // для всех нетегированных позиций (streamOf). Его удаление осиротило бы легаси-
      // позиции ВСЕХ машин разом. Ниоткуда больше защиты нет: firestore.rules пускает
      // любую запись в jobs без валидации полей, а бот ходит мимо правил через admin SDK.
      if (claimId === STREAM_INSURANCE) throw new Error('Убыток №1 удалить нельзя — к нему относятся все позиции без метки');
      const ref = doc(jobsCol, jobId);
      const synced = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Машина не найдена');
        const data = snap.data();
        const claims = claimsOf({ id: jobId, ...data }).filter((c) => c.id !== claimId);
        const move = (arr) => (arr || []).map((x) => (x && x.payer === claimId ? { ...x, payer: STREAM_INSURANCE } : x));
        const parts = move(data.parts);
        const services = move(data.services);
        tx.update(ref, { claims, parts, services, ...claimMirror(claims) });
        return { id: jobId, ...data, claims, parts, services };
      });
      // Ячейки склада держат КОПИЮ списка запчастей — обновляем, как в savePart.
      if (synced && jobCellIds(synced).length) await api.warehouse.syncParts(synced);
      return synced;
    },
    // One-shot backfill for cars imported before parts carried ids. Without an id
    // the Запчасти screen minted a throwaway id per snapshot that never matched
    // the stored part, so delete/edit silently no-op'd. Transaction-safe and
    // idempotent: writes only if a part is missing an id, and touches ids only —
    // every other field (unit/price/…) stays exactly as stored. Returns the
    // synced job (or null if nothing to do / job gone) so callers can react.
    async ensurePartIds(jobId) {
      const ref = doc(jobsCol, jobId);
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        const parts = data.parts || [];
        if (!parts.length || parts.every((p) => p && p.id)) return null; // already consistent
        const next = withPartIds(parts);
        tx.update(ref, { parts: next });
        return { id: jobId, ...data, parts: next };
      });
    },
    // Remove ONE part by id (transaction — keeps every other part intact). Its
    // receiving photos (job.photos entries with partId === this part) are dropped
    // in the SAME transaction, so the DB never shows photos for a part that's gone.
    // Their files are wiped from the photo server afterwards — best-effort, mirrors
    // jobs.remove: a server hiccup just leaves stray files, it never blocks.
    async removePart(jobId, partId) {
      const ref = doc(jobsCol, jobId);
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        const parts = (data.parts || []).filter((p) => p.id !== partId);
        const allPhotos = data.photos || [];
        const removedPhotos = allPhotos.filter((ph) => ph && ph.partId === partId);
        const photos = allPhotos.filter((ph) => !(ph && ph.partId === partId));
        const update = { parts };
        if (removedPhotos.length) update.photos = photos;
        tx.update(ref, update);
        return { job: { id: jobId, ...data, parts, photos }, removedPhotos };
      });
      const synced = result && result.job;
      if (synced && jobCellIds(synced).length) await api.warehouse.syncParts(synced);
      if (result && result.removedPhotos.length) {
        await Promise.all(result.removedPhotos.map((ph) => deletePhotoFile(ph.path).catch(() => {})));
      }
    },
    // Paint is a single field (0..1 per car) — a plain field write is enough; it
    // only ever contends paint-vs-paint, never the parts array.
    async savePaint(jobId, paint) {
      await updateDoc(doc(jobsCol, jobId), stripUndefined({ paint: paint ? { ...paint, cost: Number(paint.cost) || 0 } : null }));
    },

    // Append ONE photo to job.photos (transaction — same reason as savePart: two
    // users adding photos to the same car must not clobber each other's array).
    // The file itself already lives on the server; here we only record its
    // metadata { id, url, path, size, w, h, uploaded_at, uploaded_by }.
    async addPhoto(jobId, photo) {
      const ref = doc(jobsCol, jobId);
      const clean = stripUndefined(photo);
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        const photos = (data.photos || []).slice();
        photos.push(clean);
        tx.update(ref, { photos });
        return { id: jobId, ...data, photos };
      });
    },
    // Remove ONE photo by id from job.photos. The caller deletes the file from the
    // server separately (best-effort) — the DB record is the source of truth for
    // what the card shows, so we drop it here regardless of file cleanup.
    async removePhoto(jobId, photoId) {
      const ref = doc(jobsCol, jobId);
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        const photos = (data.photos || []).filter((p) => p.id !== photoId);
        tx.update(ref, { photos });
        return { id: jobId, ...data, photos };
      });
    },
  },

  stages: {
    // Stages that reference a given post / master — used to warn before deleting one.
    async listByPost(postId) {
      const snap = await getDocs(query(stagesCol, where('post_id', '==', postId)));
      return snap.docs.map(withId);
    },
    async listByMaster(masterId) {
      const snap = await getDocs(query(stagesCol, where('master_id', '==', masterId)));
      return snap.docs.map(withId);
    },
    async create(jobId, data) {
      const ref = await addDoc(stagesCol, stripUndefined({
        job_id: jobId,
        post_id: data.post_id,
        master_id: data.master_id ?? null,
        sequence: data.sequence ?? 0,
        title: data.title || null,
        start_at: data.start_at,
        end_at: data.end_at,
        status: data.status || 'planned',
      }));
      return withId(await getDoc(ref));
    },
    async update(id, data) {
      const clean = stripUndefined(data);
      // Дневник переходов («Монитор», Этап 2): одно-тапное продвижение этапа
      // (Запланировано → В работе → Готово) — событие жизни машины. Прежний
      // статус и job_id читаем ДО правки, чтобы взять честный from.
      let prev = null;
      if ('status' in clean) {
        const snap = await getDoc(doc(stagesCol, id));
        prev = snap.exists() ? snap.data() : null;
      }
      await updateDoc(doc(stagesCol, id), clean);
      if (prev && prev.job_id && clean.status !== prev.status) {
        const by = auth.currentUser?.email || null;
        const at = Date.now();
        const jref = doc(jobsCol, prev.job_id);
        // Журнал — best-effort: его сбой не должен ронять основную правку этапа.
        await runTransaction(db, async (tx) => {
          const js = await tx.get(jref);
          if (!js.exists()) return;
          const storedLog = js.data().status_log;
          const log = appendStatusLog(storedLog, {
            kind: 'stage', from: prev.status, to: clean.status, at, by, stage_title: prev.title || null,
          });
          if (log !== storedLog && log.length) tx.update(jref, { status_log: log });
        }).catch(() => {});
      }
      return withId(await getDoc(doc(stagesCol, id)));
    },
    async remove(id) {
      await deleteDoc(doc(stagesCol, id));
      return { ok: true };
    },
  },

  async gantt() {
    const [postsSnap, stagesSnap, jobsSnap, mastersSnap] = await Promise.all([
      getDocs(query(postsCol, orderBy('sort_order'))),
      getDocs(stagesCol),
      getDocs(jobsCol),
      getDocs(mastersCol),
    ]);
    return buildGantt(
      postsSnap.docs.map(withId),
      stagesSnap.docs.map(withId),
      jobsSnap.docs.map(withId),
      mastersSnap.docs.map(withId),
    );
  },

  // Live version of gantt(): calls `onData` with the same { posts, stages, jobs,
  // masters, invoices } shape every time ANY of the underlying collections
  // changes in Firestore — on this device or any other. This is what lets the
  // big screen in the shop update itself with no page refresh. Returns an
  // unsubscribe function; call it to stop listening (e.g. on unmount).
  subscribeGantt(onData, onError = () => {}) {
    const raw = { posts: null, stages: null, jobs: null, masters: null, docs: null };
    const emit = () => {
      // Wait until every collection has delivered its first snapshot so we never
      // render a half-loaded graph. Empty collections still fire (as []), so
      // this resolves even on a brand-new shop.
      if (!raw.posts || !raw.stages || !raw.jobs || !raw.masters || !raw.docs) return;
      const g = buildGantt(raw.posts, raw.stages, raw.jobs, raw.masters);
      onData({ ...g, masters: raw.masters, invoices: raw.docs.filter((d) => d.type === 'invoice') });
    };
    const subs = [
      onSnapshot(query(postsCol, orderBy('sort_order')), (s) => { raw.posts = s.docs.map(withId); emit(); }, onError),
      onSnapshot(stagesCol, (s) => { raw.stages = s.docs.map(withId); emit(); }, onError),
      onSnapshot(jobsCol, (s) => { raw.jobs = s.docs.map(withId); emit(); }, onError),
      onSnapshot(mastersCol, (s) => { raw.masters = s.docs.map(withId); emit(); }, onError),
      onSnapshot(orderDocsCol, (s) => { raw.docs = s.docs.map(withId); emit(); }, onError),
    ];
    return () => subs.forEach((unsub) => unsub());
  },

  // Живой поток для «Монитора»: ВСЕ не-архивные машины (согласование + ремонт),
  // у каждой прикреплены её stages (parts уже лежат в самом документе машины).
  // subscribeGantt не подходит: buildGantt отфильтровывает машины на согласовании.
  subscribeMonitor(onData, onError = () => {}) {
    const raw = { jobs: null, stages: null };
    const emit = () => {
      if (!raw.jobs || !raw.stages) return;
      const byJob = new Map();
      for (const s of raw.stages) {
        if (!byJob.has(s.job_id)) byJob.set(s.job_id, []);
        byJob.get(s.job_id).push(s);
      }
      const jobs = raw.jobs
        .filter((j) => !j.archived)
        .map((j) => ({ ...j, stages: (byJob.get(j.id) || []).sort((a, b) => (a.sequence - b.sequence)) }));
      onData(jobs);
    };
    const u1 = onSnapshot(jobsCol, (s) => { raw.jobs = s.docs.map(withId); emit(); }, onError);
    const u2 = onSnapshot(stagesCol, (s) => { raw.stages = s.docs.map(withId); emit(); }, onError);
    return () => { u1(); u2(); };
  },

  async history() {
    const [jobsSnap, stagesSnap, postsSnap] = await Promise.all([
      getDocs(query(jobsCol, where('archived', '==', true))),
      getDocs(stagesCol),
      getDocs(query(postsCol, orderBy('sort_order'))),
    ]);
    const posts = postsSnap.docs.map(withId);
    const postsById = new Map(posts.map((p) => [p.id, p]));
    const stagesByJob = new Map();
    for (const s of stagesSnap.docs.map(withId)) {
      if (!stagesByJob.has(s.job_id)) stagesByJob.set(s.job_id, []);
      stagesByJob.get(s.job_id).push(s);
    }
    const jobs = jobsSnap.docs.map(withId).map((job) => ({
      ...job,
      stages: (stagesByJob.get(job.id) || [])
        .sort((a, b) => (a.sequence - b.sequence) || (a.start_at > b.start_at ? 1 : -1))
        .map((s) => ({ ...s, post_name: postsById.get(s.post_id)?.name })),
    }));
    jobs.sort((a, b) => (b.archived_at || 0) - (a.archived_at || 0));
    return jobs;
  },

  settings: {
    async getCompany() {
      const snap = await getDoc(doc(settingsCol, 'company'));
      return snap.exists() ? snap.data() : {};
    },
    async updateCompany(data) {
      await setDoc(doc(settingsCol, 'company'), stripUndefined(data), { merge: true });
      return api.settings.getCompany();
    },
  },

  // Атомарная выдача порядковых номеров документов. На каждую пару (тип, год) —
  // свой документ-счётчик counters/{тип}-{год} с полем value. Транзакция читает и
  // увеличивает его на сервере, поэтому даже одновременное создание с двух устройств
  // никогда не выдаёт один номер дважды. Возвращает НОВОЕ значение (1, 2, 3…).
  // Год в ключе → 1 января очередь сама начинается заново (…-2027-0001).
  counters: {
    async next(typeKey, year) {
      const ref = doc(countersCol, `${typeKey}-${year}`);
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists() ? (Number(snap.data().value) || 0) : 0;
        const value = current + 1;
        tx.set(ref, { value, type: typeKey, year, updated_at: Date.now() }, { merge: true });
        return value;
      });
    },
  },

  // Issued documents (заказ-наряд, and later акт / акт приёма-передачи). Each is a
  // self-contained frozen snapshot. Writing here NEVER touches jobs/stages/warehouse —
  // that is what keeps document edits isolated from the service data.
  orderDocuments: {
    async listByJob(jobId, type) {
      const snap = await getDocs(query(orderDocsCol, where('job_id', '==', jobId)));
      let docs = snap.docs.map(withId);
      if (type) docs = docs.filter((d) => d.type === type);
      return docs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    },
    async listAll() {
      const snap = await getDocs(orderDocsCol);
      return snap.docs.map(withId).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    },
    async setPaid(id, paid) {
      await updateDoc(doc(orderDocsCol, id), stripUndefined({ paid, paid_at: paid ? Date.now() : null, updated_at: Date.now() }));
      return { ok: true };
    },
    async get(id) {
      const snap = await getDoc(doc(orderDocsCol, id));
      return snap.exists() ? withId(snap) : null;
    },
    async create(data) {
      const now = Date.now();
      const payload = { ...data };
      // Свой номер для выданных клиентских документов — акт (АКТ), счёт (СЧ),
      // приём-передача (ПП): каждый на своём счётчике типа+года. Присваивается ОДИН
      // раз, при первом сохранении, поэтому брошенные черновики не «сжигают» номера.
      // Заказ-наряд (type 'order') свой номер не получает — он печатается под номером
      // машины (job.order_number). Вписанный вручную номер уважается. Сбой счётчика не
      // блокирует сохранение: откатываемся на номер основания (заказ-наряда), как было.
      if (['act', 'invoice', 'handover'].includes(payload.type) && !String(payload.doc_number || '').trim()) {
        try {
          const year = new Date().getFullYear();
          payload.doc_number = formatDocNumber(payload.type, year, await api.counters.next(payload.type, year));
        } catch (e) {
          console.warn('Не удалось получить номер документа из счётчика:', e);
          if (payload.order_ref) payload.doc_number = payload.order_ref;
        }
      }
      const ref = await addDoc(orderDocsCol, stripUndefined({
        ...payload,
        created_at: now,
        updated_at: now,
        created_by: auth.currentUser?.email || null,
      }));
      return withId(await getDoc(ref));
    },
    async update(id, data) {
      await updateDoc(doc(orderDocsCol, id), stripUndefined({ ...data, updated_at: Date.now() }));
      return withId(await getDoc(doc(orderDocsCol, id)));
    },
    async remove(id) {
      await deleteDoc(doc(orderDocsCol, id));
      return { ok: true };
    },
  },

  // Standalone income/expenses NOT tied to a car (rent, salaries, taxes, bulk
  // purchases…). Together with per-job profit these give real net profit.
  transactions: {
    async list() {
      const snap = await getDocs(transactionsCol);
      return snap.docs.map(withId).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created_at || 0) - (a.created_at || 0)));
    },
    async create(data) {
      const ref = await addDoc(transactionsCol, stripUndefined({
        direction: data.direction === 'income' ? 'income' : 'expense',
        category: data.category || 'Прочее',
        amount: Number(data.amount) || 0,
        date: data.date,
        note: data.note || '',
        created_at: Date.now(),
        created_by: auth.currentUser?.email || null,
      }));
      return withId(await getDoc(ref));
    },
    async update(id, data) {
      await updateDoc(doc(transactionsCol, id), stripUndefined(data));
      return withId(await getDoc(doc(transactionsCol, id)));
    },
    async remove(id) {
      await deleteDoc(doc(transactionsCol, id));
      return { ok: true };
    },
  },

  // Выплаты зарплаты мастерам (аванс / окончательный расчёт). Отдельная от
  // `transactions` коллекция: сдельная оплата мастерам уже учтена в себестоимости
  // ремонта (costing.labor → P&L), поэтому эти выплаты — учёт «кому сколько выдали»,
  // а НЕ новый расход в «Финансах» (иначе задвоение). Только управленец (правила).
  salaryPayments: {
    async listAll() {
      const snap = await getDocs(salaryPaymentsCol);
      return snap.docs.map(withId).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    },
    async create(data) {
      const ref = await addDoc(salaryPaymentsCol, stripUndefined({
        master_id: data.master_id || null,
        master_name: data.master_name || null,
        kind: data.kind === 'advance' ? 'advance' : 'settlement',
        // Тип оплаты замораживаем в момент выплаты: оклады идут в расход «Финансов»,
        // сдельные — нет (уже в себестоимости). См. salaryExpenseTx в salary.js.
        pay_type: data.pay_type === 'fixed' ? 'fixed' : 'piece',
        amount: Number(data.amount) || 0,
        note: data.note || '',
        created_at: Date.now(),
        created_by: auth.currentUser?.email || null,
      }));
      return withId(await getDoc(ref));
    },
    async remove(id) {
      await deleteDoc(doc(salaryPaymentsCol, id));
      return { ok: true };
    },
  },

  // Траты, которые вносит линейный сотрудник (экспедитор: запчасти за нал,
  // бензин на поездки…). Отдельно от денежной ленты transactions, которая заперта
  // на управленцев — сотрудник видит и правит ТОЛЬКО свои записи (created_by),
  // управленец видит все через listAll(). created_by пишется в нижнем регистре,
  // чтобы совпасть с проверкой в правилах (request.auth.token.email.lower()).
  expenses: {
    async listMine(email) {
      const key = normEmail(email);
      if (!key) return [];
      const snap = await getDocs(query(expensesCol, where('created_by', '==', key)));
      return snap.docs.map(withId).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    },
    async listAll() {
      const snap = await getDocs(expensesCol);
      return snap.docs.map(withId).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    },
    async create(data) {
      const ref = await addDoc(expensesCol, stripUndefined({
        amount: Number(data.amount) || 0,
        category: data.category || 'Прочее',
        note: data.note || '',
        date: data.date || new Date().toLocaleDateString('ru-RU'),
        created_at: Date.now(),
        created_by: normEmail(auth.currentUser?.email),
        created_by_name: data.created_by_name || null,
      }));
      return withId(await getDoc(ref));
    },
    async remove(id) {
      await deleteDoc(doc(expensesCol, id));
      return { ok: true };
    },
  },

  // Заявки на закупку расходников/инструмента от мастеров и других сотрудников.
  // Жизненный цикл: new → approved → purchased (плюс rejected). Деньги живут
  // отдельно: при «куплено» экспедитор вводит цену, и создаётся трата в expenses
  // (категория «Расходники»), чтобы сумма как обычно попала в P&L — двойного учёта
  // нет. created_by пишется в нижнем регистре, чтобы совпасть с правилами (как в
  // expenses). Номер ЗАК-ГОД-NNNN выдаёт тот же атомарный счётчик, что и заказ-наряды.
  requests: {
    async listMine(email) {
      const key = normEmail(email);
      if (!key) return [];
      const snap = await getDocs(query(purchaseRequestsCol, where('created_by', '==', key)));
      return snap.docs.map(withId).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    },
    async listAll() {
      const snap = await getDocs(purchaseRequestsCol);
      return snap.docs.map(withId).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    },
    async create(data) {
      // Номер не критичен для создания: если счётчик недоступен (напр. правила ещё
      // не задеплоены) — оставляем пустым, как сделано для заказ-нарядов.
      let number = null;
      try {
        const year = new Date().getFullYear();
        number = formatDocNumber('purchase', year, await api.counters.next('purchase', year));
      } catch (e) {
        console.warn('Не удалось получить номер заявки из счётчика:', e);
      }
      const ref = await addDoc(purchaseRequestsCol, stripUndefined({
        number,
        item_name: String(data.item_name || '').trim(),
        qty: Number(data.qty) || 1,
        unit: data.unit || 'шт',
        for_job_id: data.for_job_id || null,
        for_job_label: data.for_job_label || null,
        urgent: !!data.urgent,
        comment: String(data.comment || '').trim(),
        status: 'new',
        created_at: Date.now(),
        created_by: normEmail(auth.currentUser?.email),
        created_by_name: data.created_by_name || null,
      }));
      return withId(await getDoc(ref));
    },
    async approve(id) {
      await updateDoc(doc(purchaseRequestsCol, id), stripUndefined({
        status: 'approved',
        approved_at: Date.now(),
        approved_by: normEmail(auth.currentUser?.email),
        reject_reason: null,
      }));
      return withId(await getDoc(doc(purchaseRequestsCol, id)));
    },
    async reject(id, reason) {
      await updateDoc(doc(purchaseRequestsCol, id), stripUndefined({
        status: 'rejected',
        reject_reason: String(reason || '').trim() || null,
        approved_at: Date.now(),
        approved_by: normEmail(auth.currentUser?.email),
      }));
      return withId(await getDoc(doc(purchaseRequestsCol, id)));
    },
    // Экспедитор отметил «куплено» + цена. Идемпотентно: повторный клик по уже
    // купленной заявке НЕ создаёт вторую трату. Сумма > 0 → создаём трату (категория
    // «Расходники») от имени вошедшего (кто купил), её id пишем в заявку.
    async markPurchased(id, { price, created_by_name } = {}) {
      const reqSnap = await getDoc(doc(purchaseRequestsCol, id));
      if (!reqSnap.exists()) throw new Error('Заявка не найдена');
      const req = withId(reqSnap);
      if (req.status === 'purchased') return req;
      const amount = Number(price) || 0;
      let expenseId = null;
      if (amount > 0) {
        const label = `${req.item_name} — ${req.qty} ${req.unit || ''}`.trim();
        const note = [req.number, label].filter(Boolean).join(': ');
        const expense = await api.expenses.create({ amount, category: 'Расходники', note, created_by_name });
        expenseId = expense.id;
      }
      await updateDoc(doc(purchaseRequestsCol, id), stripUndefined({
        status: 'purchased',
        purchased_price: amount,
        purchased_at: Date.now(),
        purchased_by: normEmail(auth.currentUser?.email),
        expense_id: expenseId,
      }));
      return withId(await getDoc(doc(purchaseRequestsCol, id)));
    },
    async remove(id) {
      await deleteDoc(doc(purchaseRequestsCol, id));
      return { ok: true };
    },
  },

  // Счета поставщиков на запчасти, которые оплачивает УЧРЕДИТЕЛЬ. Запчастист
  // группирует позиции (возможно с разных машин) в счёт + грузит файл → позиции
  // становятся «Выставлен счёт» (invoiced). Учредитель отмечает оплату → позиции
  // уходят в «Заказано» (ordered). Деньги: оплаченный счёт показывается расходом
  // в кассовой ленте (computeCashFlow), но НЕ в чистой прибыли — себестоимость
  // запчастей уже в costing (иначе задвоение; тот же приём, что salaryPayments).
  // Номер СП-ГОД-NNNN — тот же атомарный счётчик, что и заказ-наряды.
  supplierInvoices: {
    async listAll() {
      const snap = await getDocs(supplierInvoicesCol);
      return snap.docs.map(withId).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    },
    subscribe(onData, onError = () => {}) {
      return onSnapshot(supplierInvoicesCol, (s) => onData(s.docs.map(withId).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))), onError);
    },
    // Создать счёт из выбранных позiций и перевести их в «Выставлен счёт».
    // items: [{ job_id, part_id, name, code, qty, cost }].
    async create(data) {
      let number = null;
      try {
        const year = new Date().getFullYear();
        number = formatDocNumber('supplier', year, await api.counters.next('supplier', year));
      } catch (e) {
        console.warn('Не удалось получить номер счёта поставщика из счётчика:', e);
      }
      const items = (Array.isArray(data.items) ? data.items : []).map((it) => stripUndefined({
        job_id: it.job_id || null,
        part_id: it.part_id || null,
        name: String(it.name || '').trim(),
        code: String(it.code || '').trim(),
        qty: Number(it.qty) || 1,
        cost: Number(it.cost) || 0,
        car_model: String(it.car_model || '').trim() || null,
        plate: String(it.plate || '').trim() || null,
      }));
      const ref = await addDoc(supplierInvoicesCol, stripUndefined({
        number,
        supplier: String(data.supplier || '').trim(),
        amount: Number(data.amount) || 0,
        file_url: data.file_url || null,
        file_name: data.file_name || null,
        file_size: data.file_size || null,
        items,
        status: 'unpaid',
        comment: String(data.comment || '').trim(),
        created_at: Date.now(),
        created_by: normEmail(auth.currentUser?.email),
        created_by_name: data.created_by_name || null,
      }));
      // Позиции → «Выставлен счёт» (с ссылкой на счёт + поставщиком). Делаем ПОСЛЕ
      // создания документа, чтобы part.supplier_invoice_id указывал на реальный id.
      try { await setInvoiceParts(items, 'invoiced', { invoiceId: ref.id, supplier: data.supplier }); }
      catch (e) { console.warn('Счёт создан, но не удалось пометить позиции:', e); }
      return withId(await getDoc(ref));
    },
    // Правка шапки счёта (поставщик/сумма/комментарий) до оплаты.
    async update(id, data) {
      await updateDoc(doc(supplierInvoicesCol, id), stripUndefined({
        supplier: data.supplier !== undefined ? String(data.supplier || '').trim() : undefined,
        amount: data.amount !== undefined ? (Number(data.amount) || 0) : undefined,
        comment: data.comment !== undefined ? String(data.comment || '').trim() : undefined,
      }));
      return withId(await getDoc(doc(supplierInvoicesCol, id)));
    },
    // Заменить/прикрепить файл счёта (новый затирает старый в шапке; удаление
    // старого файла с диска — забота вызывающего через deletePhotoFile).
    async setFile(id, { file_url, file_name, file_size } = {}) {
      await updateDoc(doc(supplierInvoicesCol, id), stripUndefined({
        file_url: file_url || null,
        file_name: file_name || null,
        file_size: file_size || null,
      }));
      return withId(await getDoc(doc(supplierInvoicesCol, id)));
    },
    // Учредитель отметил «Оплачено». ИДЕМПОТЕНТНО: повторный клик (или гонка
    // приложение↔бот) не двигает позиции второй раз. Переводит позиции счёта в
    // «Заказано» и проставляет оплату. paid_by_name — имя того, кто оплатил.
    async markPaid(id, { paid_by_name } = {}) {
      const ref = doc(supplierInvoicesCol, id);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Счёт не найден');
      const inv = withId(snap);
      if (inv.status === 'paid' || inv.paid_at) return inv; // уже оплачен
      await setInvoiceParts(inv.items || [], 'ordered');
      await updateDoc(ref, stripUndefined({
        status: 'paid',
        paid_at: Date.now(),
        paid_by: normEmail(auth.currentUser?.email),
        paid_by_name: paid_by_name || null,
      }));
      return withId(await getDoc(ref));
    },
    async remove(id) {
      await deleteDoc(doc(supplierInvoicesCol, id));
      return { ok: true };
    },
  },

  cells: {
    async list() {
      const snap = await getDocs(cellsCol);
      const obj = {};
      snap.forEach((d) => { obj[d.id] = d.data(); });
      return obj;
    },
    async get(id) {
      const snap = await getDoc(doc(cellsCol, id));
      return snap.exists() ? snap.data() : null;
    },
    async save(id, data) {
      await setDoc(doc(cellsCol, id), stripUndefined(data));
      return data;
    },
    async free(id) {
      const cell = await api.cells.get(id);
      if (!cell) return null;
      // Pre-read the linked job so the cell archive, the log entry and the job's
      // cell-list unlink all land in ONE batch — freeing a cell can't half-happen
      // and leave the car pointing at a slot it no longer holds ("воскрешение").
      let jobRef = null;
      let nextIds = null;
      if (cell.job_id) {
        const jobSnap = await getDoc(doc(jobsCol, cell.job_id));
        if (jobSnap.exists()) {
          const cur = jobCellIds({ id: jobSnap.id, ...jobSnap.data() });
          if (cur.includes(id)) { jobRef = doc(jobsCol, cell.job_id); nextIds = cur.filter((cid) => cid !== id); }
        }
      }
      const batch = writeBatch(db);
      batchFreeCell(batch, id, cell);
      if (jobRef) batch.update(jobRef, { cell_ids: nextIds, cell_id: nextIds[0] || null });
      await batch.commit();
      return { _archive: [...(cell._archive || []), { ...cell, freedAt: new Date().toLocaleDateString('ru-RU') }] };
    },
  },

  warehouseConfig: {
    async get() {
      const snap = await getDoc(doc(warehouseConfigCol, 'main'));
      return snap.exists() ? snap.data() : null;
    },
    async save(cfg) {
      await setDoc(doc(warehouseConfigCol, 'main'), cfg);
      return cfg;
    },
  },

  warehouseLog: {
    async add(action, cellId, details) {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(warehouseLogCol, id), { action, cellId, details, ts: Date.now() });
    },
    async list() {
      const snap = await getDocs(warehouseLogCol);
      const arr = [];
      snap.forEach((d) => arr.push(d.data()));
      arr.sort((a, b) => b.ts - a.ts);
      return arr.slice(0, 200);
    },
  },

  // Links a job (заказ-наряд) to one or more warehouse cells so parts entered
  // on the order automatically show up on the cell(s), instead of being
  // typed twice. A job can span several cells (e.g. a bumper in one cell,
  // small parts in another); every linked cell shows the same order info.
  warehouse: {
    cellIds: jobCellIds,

    async assignCell(cellId, job) {
      const existing = await api.cells.get(cellId);
      const batch = writeBatch(db);
      batchAssignCell(batch, cellId, job, existing);
      await batch.commit();
    },

    // Replaces the full set of cells linked to a job in one go: frees cells that
    // were removed, assigns newly picked ones, and updates the job's own cell list
    // — ALL in a single writeBatch, so a mid-way failure can't leave the job and its
    // cells disagreeing about who holds what.
    async setJobCells(job, newCellIds) {
      const current = jobCellIds(job);
      const toAdd = newCellIds.filter((id) => !current.includes(id));
      const toRemove = current.filter((id) => !newCellIds.includes(id));
      const patch = { cell_ids: newCellIds, cell_id: newCellIds[0] || null };
      if (!toAdd.length && !toRemove.length) {
        // Only the (possibly reordered) list changed — no cell writes needed.
        return api.jobs.update(job.id, patch);
      }
      // Reads can't live inside a writeBatch, so pre-fetch every cell we'll touch.
      const [removeCells, addCells] = await Promise.all([
        Promise.all(toRemove.map((id) => api.cells.get(id))),
        Promise.all(toAdd.map((id) => api.cells.get(id))),
      ]);
      const batch = writeBatch(db);
      toRemove.forEach((id, i) => { if (removeCells[i]) batchFreeCell(batch, id, removeCells[i]); });
      toAdd.forEach((id, i) => batchAssignCell(batch, id, job, addCells[i]));
      batch.update(doc(jobsCol, job.id), patch);
      await batch.commit();
      return { ok: true, ...patch };
    },

    // Attach one more free cell to a job that already exists, without
    // touching any cells it's already linked to — used from the warehouse
    // side ("Привязать к существующему заказу").
    async addJobCell(cellId, job) {
      const current = jobCellIds(job);
      if (current.includes(cellId)) return job;
      return api.warehouse.setJobCells(job, [...current, cellId]);
    },

    async syncParts(job) {
      for (const id of jobCellIds(job)) {
        const existing = await api.cells.get(id);
        if (!existing) continue;
        await api.cells.save(id, {
          ...existing,
          car: job.car_model,
          orderNum: job.order_number,
          parts: partsForCell(job),
        });
      }
    },

    // Free every cell a job holds AND clear the job's own cell list, atomically —
    // so an archived job that is later «возвращён в работу» doesn't reclaim cells
    // that are now free or taken by other cars.
    async freeJobCells(job) {
      const ids = jobCellIds(job);
      if (!ids.length) return;
      const cells = await Promise.all(ids.map((id) => api.cells.get(id)));
      const batch = writeBatch(db);
      ids.forEach((id, i) => { if (cells[i]) batchFreeCell(batch, id, cells[i]); });
      if (job.id) batch.update(doc(jobsCol, job.id), { cell_ids: [], cell_id: null });
      await batch.commit();
    },
  },
};

function jobCellIds(job) {
  return job.cell_ids || (job.cell_id ? [job.cell_id] : []);
}

function partsForCell(job) {
  return (job.parts || []).map((p) => ({ name: p.name || '', code: p.code || '', qty: p.qty ?? 1 }));
}

// ---- warehouse batch primitives -------------------------------------------
// Queue the cell + log writes for freeing/assigning ONE cell into a caller's
// writeBatch, so a whole re-link (free some, assign others, update the job's
// cell list) commits all-or-nothing instead of desyncing on a mid-way failure.
function warehouseLogId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function batchFreeCell(batch, cellId, cell) {
  const archive = cell._archive || [];
  batch.set(doc(cellsCol, cellId), { _archive: [...archive, { ...cell, freedAt: new Date().toLocaleDateString('ru-RU') }] });
  batch.set(doc(warehouseLogCol, warehouseLogId()), { action: 'Освобождена', cellId, details: `${cell.car || '—'} · ${cell.orderNum || '—'}`, ts: Date.now() });
}
function batchAssignCell(batch, cellId, job, existing) {
  const updated = {
    ...(existing || {}),
    job_id: job.id,
    car: job.car_model,
    plate: job.plate_number,
    orderNum: job.order_number,
    parts: partsForCell(job),
    openedAt: existing?.openedAt || new Date().toLocaleDateString('ru-RU'),
  };
  batch.set(doc(cellsCol, cellId), updated);
  batch.set(doc(warehouseLogCol, warehouseLogId()), { action: existing?.orderNum ? 'Изменена' : 'Открыта', cellId, details: `${updated.car || '—'} · ${updated.orderNum || '—'}`, ts: Date.now() });
}
