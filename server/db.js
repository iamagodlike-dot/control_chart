import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data.sqlite');
const isNew = !fs.existsSync(dbPath);

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const jobColumns = db.prepare("PRAGMA table_info(jobs)").all().map((c) => c.name);
if (!jobColumns.includes('order_number')) db.exec('ALTER TABLE jobs ADD COLUMN order_number TEXT');
if (!jobColumns.includes('storage_location')) db.exec('ALTER TABLE jobs ADD COLUMN storage_location TEXT');
if (!jobColumns.includes('deadline')) db.exec('ALTER TABLE jobs ADD COLUMN deadline TEXT');

if (isNew) {
  const insertPost = db.prepare('INSERT INTO posts (name, sort_order) VALUES (?, ?)');
  const seedPosts = ['Пост 1 — разборка', 'Пост 2 — рихтовка', 'Пост 3 — сварка', 'Пост 4 — подготовка', 'Пост 5 — покраска', 'Пост 6 — сборка'];
  seedPosts.forEach((name, i) => insertPost.run(name, i));

  const insertMaster = db.prepare('INSERT INTO masters (name, specialty, default_post_id) VALUES (?, ?, ?)');
  insertMaster.run('Иванов А.', 'Рихтовщик', 2);
  insertMaster.run('Петров С.', 'Сварщик', 3);
  insertMaster.run('Сидоров Д.', 'Маляр', 5);
}
