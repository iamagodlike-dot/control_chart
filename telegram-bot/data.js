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

module.exports = { loadGraph, getCompany, getDocsForJob, getDocById, getJobById };
