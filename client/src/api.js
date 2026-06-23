import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, setDoc,
  query, orderBy, where, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

const postsCol = collection(db, 'posts');
const mastersCol = collection(db, 'masters');
const jobsCol = collection(db, 'jobs');
const stagesCol = collection(db, 'stages');
const settingsCol = collection(db, 'settings');

function withId(snap) {
  return { id: snap.id, ...snap.data() };
}

function stripUndefined(obj) {
  const out = {};
  for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

async function stagesForJob(jobId) {
  const snap = await getDocs(query(stagesCol, where('job_id', '==', jobId)));
  return snap.docs.map(withId).sort((a, b) => (a.sequence - b.sequence) || (a.start_at > b.start_at ? 1 : -1));
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
    async remove(id) {
      await deleteDoc(doc(postsCol, id));
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
    async remove(id) {
      await deleteDoc(doc(mastersCol, id));
      return { ok: true };
    },
  },

  jobs: {
    async list() {
      const snap = await getDocs(query(jobsCol, orderBy('created_at', 'desc')));
      const jobs = snap.docs.map(withId);
      for (const job of jobs) job.stages = await stagesForJob(job.id);
      return jobs;
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
    async update(id, data) {
      await updateDoc(doc(jobsCol, id), stripUndefined(data));
      const job = withId(await getDoc(doc(jobsCol, id)));
      job.stages = await stagesForJob(id);
      return job;
    },
    async remove(id) {
      const snap = await getDocs(query(stagesCol, where('job_id', '==', id)));
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(jobsCol, id));
      await batch.commit();
      return { ok: true };
    },
    async archive(id) {
      return api.jobs.update(id, { archived: true, archived_at: Date.now() });
    },
    async unarchive(id) {
      return api.jobs.update(id, { archived: false, archived_at: null });
    },
  },

  stages: {
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
      await updateDoc(doc(stagesCol, id), stripUndefined(data));
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
    const posts = postsSnap.docs.map(withId);
    const jobsById = new Map(jobsSnap.docs.map((d) => [d.id, d.data()]));
    const mastersById = new Map(mastersSnap.docs.map((d) => [d.id, d.data()]));
    const allStages = stagesSnap.docs.map(withId);
    const stagesByJob = new Map();
    for (const s of allStages) {
      if (!stagesByJob.has(s.job_id)) stagesByJob.set(s.job_id, []);
      stagesByJob.get(s.job_id).push(s);
    }

    const stages = allStages
      .filter((s) => !jobsById.get(s.job_id)?.archived)
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
    const jobs = jobsSnap.docs
      .map(withId)
      .filter((j) => !j.archived)
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
};
