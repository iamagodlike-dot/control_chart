CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS masters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  specialty TEXT,
  default_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_model TEXT NOT NULL,
  plate_number TEXT,
  client_name TEXT,
  client_phone TEXT,
  order_number TEXT,
  storage_location TEXT,
  deadline TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  master_id INTEGER REFERENCES masters(id) ON DELETE SET NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
);

CREATE INDEX IF NOT EXISTS idx_stages_post ON stages(post_id);
CREATE INDEX IF NOT EXISTS idx_stages_job ON stages(job_id);
