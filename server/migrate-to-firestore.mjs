import Database from 'better-sqlite3';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCSgtcEIXZbyeF-pMK-1jmuRlPvl3gK7zA',
  authDomain: 'gannt-9b15d.firebaseapp.com',
  projectId: 'gannt-9b15d',
  storageBucket: 'gannt-9b15d.firebasestorage.app',
  messagingSenderId: '1086988543414',
  appId: '1:1086988543414:web:08b9cc86b2d94b95ad4d17',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const sqlite = new Database('data.sqlite');

const postIdMap = new Map();
const masterIdMap = new Map();
const jobIdMap = new Map();

const posts = sqlite.prepare('SELECT * FROM posts ORDER BY sort_order, id').all();
for (const p of posts) {
  const ref = await addDoc(collection(db, 'posts'), { name: p.name, sort_order: p.sort_order });
  postIdMap.set(p.id, ref.id);
  console.log('post', p.id, '->', ref.id);
}

const masters = sqlite.prepare('SELECT * FROM masters ORDER BY id').all();
for (const m of masters) {
  const ref = await addDoc(collection(db, 'masters'), {
    name: m.name,
    specialty: m.specialty || null,
    default_post_id: m.default_post_id ? postIdMap.get(m.default_post_id) : null,
  });
  masterIdMap.set(m.id, ref.id);
  console.log('master', m.id, '->', ref.id);
}

const jobs = sqlite.prepare('SELECT * FROM jobs ORDER BY id').all();
for (const j of jobs) {
  const ref = await addDoc(collection(db, 'jobs'), {
    car_model: j.car_model,
    plate_number: j.plate_number || null,
    client_name: j.client_name || null,
    client_phone: j.client_phone || null,
    order_number: j.order_number || null,
    storage_location: j.storage_location || null,
    deadline: j.deadline || null,
    notes: j.notes || null,
    created_at: Date.now(),
  });
  jobIdMap.set(j.id, ref.id);
  console.log('job', j.id, '->', ref.id);
}

const stages = sqlite.prepare('SELECT * FROM stages ORDER BY job_id, sequence, start_at').all();
for (const s of stages) {
  const ref = await addDoc(collection(db, 'stages'), {
    job_id: jobIdMap.get(s.job_id),
    post_id: postIdMap.get(s.post_id),
    master_id: s.master_id ? masterIdMap.get(s.master_id) : null,
    sequence: s.sequence,
    title: s.title || null,
    start_at: s.start_at,
    end_at: s.end_at,
    status: s.status,
  });
  console.log('stage', s.id, '->', ref.id);
}

console.log('Migration done.');
process.exit(0);
