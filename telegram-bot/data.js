'use strict';
const { db, isReady } = require('./firebase');

// Все коллекции у сервиса небольшие, поэтому читаем их целиком и соединяем
// в памяти — так же, как это делает сам сайт. Всё только на чтение.

function withId(doc) {
  return { id: doc.id, ...doc.data() };
}

async function readAll(name) {
  const snap = await db.collection(name).get();
  return snap.docs.map(withId);
}

// Возвращает всё, что нужно боту, одним снимком базы.
async function loadGraph() {
  if (!isReady()) throw new Error('База ещё не подключена');

  const [jobs, stages, posts, masters, docs, companySnap] = await Promise.all([
    readAll('jobs'),
    readAll('stages'),
    readAll('posts'),
    readAll('masters'),
    readAll('orderDocuments'),
    db.collection('settings').doc('company').get(),
  ]);
  const company = companySnap.exists ? companySnap.data() : {};

  const postsById = new Map(posts.map((p) => [p.id, p]));
  const mastersById = new Map(masters.map((m) => [m.id, m]));

  const stagesByJob = new Map();
  for (const s of stages) {
    if (!stagesByJob.has(s.job_id)) stagesByJob.set(s.job_id, []);
    stagesByJob.get(s.job_id).push(s);
  }

  const docsByJob = new Map();
  for (const d of docs) {
    if (!docsByJob.has(d.job_id)) docsByJob.set(d.job_id, []);
    docsByJob.get(d.job_id).push(d);
  }

  // Каждая машина + её этапы (по порядку) + её документы.
  const allJobs = jobs.map((j) => ({
    ...j,
    stages: (stagesByJob.get(j.id) || []).sort(
      (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || String(a.start_at).localeCompare(String(b.start_at)),
    ),
    documents: docsByJob.get(j.id) || [],
  }));

  return {
    jobs: allJobs,
    activeJobs: allJobs.filter((j) => !j.archived),
    jobsById: new Map(allJobs.map((j) => [j.id, j])),
    invoices: docs.filter((d) => d.type === 'invoice'),
    postsById,
    mastersById,
    posts: posts.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    masters,
    company,
  };
}

// Одна машина по id (для экранов «Запчасти» и «Фото» — незачем читать всю базу).
async function getJobById(jobId) {
  if (!isReady()) throw new Error('База ещё не подключена');
  const snap = await db.collection('jobs').doc(jobId).get();
  return snap.exists ? withId(snap) : null;
}

// Реквизиты компании (для документов).
async function getCompany() {
  if (!isReady()) throw new Error('База ещё не подключена');
  const snap = await db.collection('settings').doc('company').get();
  return snap.exists ? snap.data() : {};
}

// Сохранённые документы машины (заказ-наряды, счета, акты).
async function getDocsForJob(jobId) {
  if (!isReady()) throw new Error('База ещё не подключена');
  const snap = await db.collection('orderDocuments').where('job_id', '==', jobId).get();
  return snap.docs.map(withId).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

// Один сохранённый документ по его id.
async function getDocById(docId) {
  if (!isReady()) throw new Error('База ещё не подключена');
  const snap = await db.collection('orderDocuments').doc(docId).get();
  return snap.exists ? withId(snap) : null;
}

// ─── Счета поставщиков (учредитель оплачивает) ───
// Это ЕДИНСТВЕННОЕ место, где бот ПИШЕТ в базу. Служебный ключ (admin SDK)
// обходит правила безопасности, поэтому проверка «кто может» — в коде бота (ярус
// FOUNDERS), а сама запись здесь сделана идемпотентно и безопасно к гонкам.

function isInvoicePaid(inv) {
  return inv && (inv.status === 'paid' || !!inv.paid_at);
}

async function listUnpaidSupplierInvoices() {
  if (!isReady()) throw new Error('База ещё не подключена');
  const snap = await db.collection('supplierInvoices').get();
  return snap.docs.map(withId)
    .filter((i) => !isInvoicePaid(i))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

async function getSupplierInvoiceById(id) {
  if (!isReady()) throw new Error('База ещё не подключена');
  const snap = await db.collection('supplierInvoices').doc(id).get();
  return snap.exists ? withId(snap) : null;
}

// Отметить счёт оплаченным + перевести его позиции в «Заказано». ИДЕМПОТЕНТНО:
// повторный вызов (или гонка с приложением) ничего не двигает второй раз. Флип —
// по машинам, транзакцией на каждую (мерж по id, как savePart в приложении).
// Возвращает { alreadyPaid, invoice }.
async function markSupplierInvoicePaid(id, paidByName) {
  if (!isReady()) throw new Error('База ещё не подключена');
  const ref = db.collection('supplierInvoices').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Счёт не найден');
  const inv = withId(snap);
  if (isInvoicePaid(inv)) return { alreadyPaid: true, invoice: inv };

  const byJob = new Map();
  for (const it of (inv.items || [])) {
    if (!it || !it.job_id || !it.part_id) continue;
    if (!byJob.has(it.job_id)) byJob.set(it.job_id, new Set());
    byJob.get(it.job_id).add(it.part_id);
  }
  const at = Date.now();
  const orderedAt = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  const by = 'ТГ · ' + (paidByName || 'учредитель');
  for (const [jobId, partIds] of byJob.entries()) {
    const jref = db.collection('jobs').doc(jobId);
    // eslint-disable-next-line no-await-in-loop
    await db.runTransaction(async (tx) => {
      const js = await tx.get(jref);
      if (!js.exists) return;
      const data = js.data();
      const parts = (data.parts || []).slice();
      let changed = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const cur = p.status || 'need'; // пустой статус = «Требуется»
        if (!partIds.has(p.id) || (cur !== 'need' && cur !== 'invoiced')) continue;
        const log = Array.isArray(p.receiving_log) ? p.receiving_log.slice() : [];
        log.push({ status: 'ordered', at, by });
        parts[i] = { ...p, status: 'ordered', orderedAt: p.orderedAt || orderedAt, receiving_log: log };
        changed = true;
      }
      if (changed) tx.update(jref, { parts });
    });
  }
  await ref.update({ status: 'paid', paid_at: at, paid_by: 'telegram', paid_by_name: paidByName || null });
  return { alreadyPaid: false, invoice: { ...inv, status: 'paid', paid_at: at } };
}

module.exports = {
  loadGraph, getCompany, getDocsForJob, getDocById, getJobById,
  listUnpaidSupplierInvoices, getSupplierInvoiceById, markSupplierInvoicePaid,
};
