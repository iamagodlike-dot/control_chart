import express from 'express';
import cors from 'cors';
import { db } from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Posts ----------
app.get('/api/posts', (req, res) => {
  res.json(db.prepare('SELECT * FROM posts ORDER BY sort_order, id').all());
});

app.post('/api/posts', (req, res) => {
  const { name, sort_order = 0 } = req.body;
  const info = db.prepare('INSERT INTO posts (name, sort_order) VALUES (?, ?)').run(name, sort_order);
  res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/posts/:id', (req, res) => {
  const { name, sort_order } = req.body;
  db.prepare('UPDATE posts SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ?')
    .run(name, sort_order, req.params.id);
  res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id));
});

app.delete('/api/posts/:id', (req, res) => {
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Masters ----------
app.get('/api/masters', (req, res) => {
  res.json(db.prepare('SELECT * FROM masters ORDER BY id').all());
});

app.post('/api/masters', (req, res) => {
  const { name, specialty, default_post_id } = req.body;
  const info = db.prepare('INSERT INTO masters (name, specialty, default_post_id) VALUES (?, ?, ?)')
    .run(name, specialty || null, default_post_id || null);
  res.json(db.prepare('SELECT * FROM masters WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/masters/:id', (req, res) => {
  const { name, specialty, default_post_id } = req.body;
  db.prepare('UPDATE masters SET name = COALESCE(?, name), specialty = COALESCE(?, specialty), default_post_id = COALESCE(?, default_post_id) WHERE id = ?')
    .run(name, specialty, default_post_id, req.params.id);
  res.json(db.prepare('SELECT * FROM masters WHERE id = ?').get(req.params.id));
});

app.delete('/api/masters/:id', (req, res) => {
  db.prepare('DELETE FROM masters WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Jobs (cars) ----------
app.get('/api/jobs', (req, res) => {
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY id DESC').all();
  const stageStmt = db.prepare('SELECT * FROM stages WHERE job_id = ? ORDER BY sequence, start_at');
  for (const job of jobs) job.stages = stageStmt.all(job.id);
  res.json(jobs);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  job.stages = db.prepare('SELECT * FROM stages WHERE job_id = ? ORDER BY sequence, start_at').all(job.id);
  res.json(job);
});

app.post('/api/jobs', (req, res) => {
  const { car_model, plate_number, client_name, client_phone, order_number, storage_location, deadline, notes, stages = [] } = req.body;
  const insertJob = db.prepare(
    'INSERT INTO jobs (car_model, plate_number, client_name, client_phone, order_number, storage_location, deadline, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertStage = db.prepare(
    'INSERT INTO stages (job_id, post_id, master_id, sequence, title, start_at, end_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    const jobInfo = insertJob.run(car_model, plate_number || null, client_name || null, client_phone || null, order_number || null, storage_location || null, deadline || null, notes || null);
    stages.forEach((s, i) => {
      insertStage.run(jobInfo.lastInsertRowid, s.post_id, s.master_id || null, s.sequence ?? i, s.title || null, s.start_at, s.end_at, s.status || 'planned');
    });
    return jobInfo.lastInsertRowid;
  });
  const id = tx();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  job.stages = db.prepare('SELECT * FROM stages WHERE job_id = ? ORDER BY sequence, start_at').all(id);
  res.json(job);
});

app.put('/api/jobs/:id', (req, res) => {
  const { car_model, plate_number, client_name, client_phone, order_number, storage_location, deadline, notes } = req.body;
  db.prepare(
    `UPDATE jobs SET
      car_model = COALESCE(?, car_model),
      plate_number = COALESCE(?, plate_number),
      client_name = COALESCE(?, client_name),
      client_phone = COALESCE(?, client_phone),
      order_number = COALESCE(?, order_number),
      storage_location = COALESCE(?, storage_location),
      deadline = COALESCE(?, deadline),
      notes = COALESCE(?, notes)
     WHERE id = ?`
  ).run(car_model, plate_number, client_name, client_phone, order_number, storage_location, deadline, notes, req.params.id);
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  job.stages = db.prepare('SELECT * FROM stages WHERE job_id = ? ORDER BY sequence, start_at').all(job.id);
  res.json(job);
});

app.delete('/api/jobs/:id', (req, res) => {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Stages (individual gantt bars) ----------
app.post('/api/jobs/:jobId/stages', (req, res) => {
  const { post_id, master_id, sequence = 0, title, start_at, end_at, status = 'planned' } = req.body;
  const info = db.prepare(
    'INSERT INTO stages (job_id, post_id, master_id, sequence, title, start_at, end_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.params.jobId, post_id, master_id || null, sequence, title || null, start_at, end_at, status);
  res.json(db.prepare('SELECT * FROM stages WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/stages/:id', (req, res) => {
  const { post_id, master_id, sequence, title, start_at, end_at, status } = req.body;
  db.prepare(
    `UPDATE stages SET
      post_id = COALESCE(?, post_id),
      master_id = ?,
      sequence = COALESCE(?, sequence),
      title = COALESCE(?, title),
      start_at = COALESCE(?, start_at),
      end_at = COALESCE(?, end_at),
      status = COALESCE(?, status)
     WHERE id = ?`
  ).run(post_id, master_id, sequence, title, start_at, end_at, status, req.params.id);
  res.json(db.prepare('SELECT * FROM stages WHERE id = ?').get(req.params.id));
});

app.delete('/api/stages/:id', (req, res) => {
  db.prepare('DELETE FROM stages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Gantt combined view ----------
app.get('/api/gantt', (req, res) => {
  const posts = db.prepare('SELECT * FROM posts ORDER BY sort_order, id').all();
  const stages = db.prepare(`
    SELECT s.*, j.car_model, j.plate_number, j.client_name, j.order_number, j.storage_location, j.deadline, m.name AS master_name
    FROM stages s
    JOIN jobs j ON j.id = s.job_id
    LEFT JOIN masters m ON m.id = s.master_id
    ORDER BY s.start_at
  `).all();
  res.json({ posts, stages });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
