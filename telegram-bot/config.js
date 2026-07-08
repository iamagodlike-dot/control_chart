'use strict';
require('dotenv').config();

function ids(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const managers = ids(process.env.MANAGERS);
const staff = ids(process.env.STAFF);
// Управляющие тоже входят в общий список доступа (видят машины + финансы).
const allowed = new Set([...managers, ...staff]);

const [h = '10', m = '00'] = String(process.env.SUMMARY_TIME || '10:00').split(':');
const [rh = '18', rm = '00'] = String(process.env.REMINDER_TIME || '18:00').split(':');
const tz = process.env.SUMMARY_TZ || 'Europe/Moscow';

// Адрес, по которому nginx раздаёт фото (location /uploads/). В базе у фото
// хранится только относительный путь /uploads/…; бот дополняет его этим адресом,
// чтобы Telegram смог скачать снимок и прислать в чат.
const photosBaseUrl = String(process.env.PHOTOS_BASE_URL || 'https://app.academyauto.ru').replace(/\/+$/, '');

module.exports = {
  botToken: process.env.BOT_TOKEN,
  projectId: process.env.FIREBASE_PROJECT_ID || 'gannt-9b15d',
  serviceAccountPath: process.env.SERVICE_ACCOUNT_PATH || './service-account.json',
  photosBaseUrl,
  summary: {
    hour: Number(h),
    minute: Number(m),
    tz,
    cron: `${Number(m)} ${Number(h)} * * *`,
  },
  reminder: {
    hour: Number(rh),
    minute: Number(rm),
    tz,
    cron: `${Number(rm)} ${Number(rh)} * * *`,
  },
  managers,
  staff,
  isAllowed: (id) => allowed.has(String(id)),
  isManager: (id) => managers.includes(String(id)),
  hasWhitelist: () => allowed.size > 0,
};
