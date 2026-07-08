// Приёмник фотографий автомобилей для Авто Академии.
//
// Зачем он вообще: фото нельзя положить в Firebase Storage (для него нужен план
// Blaze с картой, а российские карты не проходят), поэтому храним снимки на своём
// сервере. Nginx раздаёт статику и не умеет принимать загрузки — эта маленькая
// программа принимает файл, проверяет что человек залогинен, и кладёт его на диск.
//
// Безопасность: НИКАКИХ секретных ключей на сервере. Токен входа Firebase
// проверяется по ПУБЛИЧНЫМ сертификатам Google (как проверяют подпись, не зная
// пароль). Если токен настоящий и выдан нашему проекту — пускаем, иначе 401.

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { importX509, jwtVerify, decodeProtectedHeader } from 'jose';

const PORT = Number(process.env.PORT) || 4300;
// Куда складывать файлы. ВАЖНО: НЕ внутрь /var/www/academyauto — deploy.sh при
// каждом обновлении сайта делает `rm -rf` в корне сайта и стёр бы все фото.
// Поэтому отдельная папка, которую nginx раздаёт по адресу /uploads/.
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/var/www/academyauto-uploads';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gannt-9b15d';
const MAX_BYTES = Number(process.env.MAX_BYTES) || 20 * 1024 * 1024; // 20 МБ на файл

// ── Проверка токена входа Firebase ───────────────────────────────────────
// Google публикует сертификаты для проверки подписи ID-токенов здесь. Их можно и
// нужно кэшировать (в ответе есть Cache-Control: max-age).
const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let certCache = { keys: {}, exp: 0 };

async function getCerts(force = false) {
  if (!force && Date.now() < certCache.exp && Object.keys(certCache.keys).length) return certCache.keys;
  const res = await fetch(CERT_URL);
  if (!res.ok) throw new Error(`certs http ${res.status}`);
  const keys = await res.json(); // { kid: "-----BEGIN CERTIFICATE----- ..." }
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  certCache = { keys, exp: Date.now() + (m ? Number(m[1]) * 1000 : 3600_000) };
  return keys;
}

async function verifyToken(token) {
  const { kid } = decodeProtectedHeader(token);
  let certs = await getCerts();
  if (!certs[kid]) certs = await getCerts(true); // ключи могли смениться — обновим один раз
  const pem = certs[kid];
  if (!pem) throw new Error('unknown key id');
  const key = await importX509(pem, 'RS256');
  const { payload } = await jwtVerify(token, key, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
  });
  if (!payload.sub) throw new Error('no subject');
  return payload; // { sub, email, ... }
}

async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Не передан токен входа' });
  try {
    req.user = await verifyToken(token);
    next();
  } catch (e) {
    console.warn('Отклонён токен:', e.message);
    res.status(401).json({ error: 'Недействительный токен входа' });
  }
}

// ── Утилиты ──────────────────────────────────────────────────────────────
// id машины из Firestore — это [A-Za-z0-9]. Жёстко отфильтровываем всё прочее,
// чтобы через jobId нельзя было выбраться из папки загрузок (../../etc/…).
function safeJobId(raw) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw || '') ? raw : null;
}

function extFor(mime) {
  return { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heif' }[mime] || '.jpg';
}

// ── Сервер ─────────────────────────────────────────────────────────────────
const app = express();
app.use(cors()); // доступ и так закрыт токеном; CORS открыт, чтобы работал и локальный dev
app.use(express.json({ limit: '1mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

app.get('/health', (_req, res) => res.json({ ok: true }));

// Приём одного фото: POST /upload/:jobId, поле формы "file".
app.post('/upload/:jobId', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const jobId = safeJobId(req.params.jobId);
    if (!jobId) return res.status(400).json({ error: 'Неверный id машины' });
    if (!req.file) return res.status(400).json({ error: 'Файл не пришёл' });
    if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Это не изображение' });

    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extFor(req.file.mimetype)}`;
    const dir = path.join(UPLOAD_DIR, 'jobs', jobId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), req.file.buffer);

    const rel = `/uploads/jobs/${jobId}/${name}`; // адрес, по которому фото раздаст nginx
    res.json({ url: rel, path: rel, size: req.file.size });
  } catch (e) {
    console.error('Ошибка сохранения фото:', e);
    res.status(500).json({ error: 'Не удалось сохранить фото' });
  }
});

// Удаление файла: POST /delete, тело { path: "/uploads/jobs/<id>/<file>" }.
app.post('/delete', requireAuth, async (req, res) => {
  try {
    const rel = String(req.body?.path || '');
    if (!/^\/uploads\/jobs\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,128}$/.test(rel)) {
      return res.status(400).json({ error: 'Неверный путь' });
    }
    const abs = path.resolve(UPLOAD_DIR, rel.replace(/^\/uploads\//, ''));
    const jobsRoot = path.join(UPLOAD_DIR, 'jobs') + path.sep;
    if (!abs.startsWith(jobsRoot)) return res.status(400).json({ error: 'Неверный путь' }); // страховка от выхода из папки
    await fs.unlink(abs).catch(() => {}); // уже удалён — не беда
    res.json({ ok: true });
  } catch (e) {
    console.error('Ошибка удаления фото:', e);
    res.status(500).json({ error: 'Не удалось удалить файл' });
  }
});

// В проде статику раздаёт nginx. Для локального запуска без nginx можно включить
// раздачу этой же программой: SERVE_UPLOADS=1.
if (process.env.SERVE_UPLOADS === '1') app.use('/uploads', express.static(UPLOAD_DIR));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`photo-server слушает 127.0.0.1:${PORT}, папка загрузок: ${UPLOAD_DIR}`);
});
