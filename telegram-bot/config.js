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
// Учредители: получают счета поставщиков к оплате и отмечают оплату (ярус FOUNDERS).
const founders = ids(process.env.FOUNDERS);
// Запчастисты: заказывают детали (роль partsman на сайте). Получают пуши «нужно
// заказать» и «счёт оплачен»; в разделе «Запчасти» видят поставщика и закупку —
// это их работа, — но НЕ видят выручку/прибыль и финансовые кнопки меню.
const partsmen = ids(process.env.PARTSMEN);
// Все четыре группы входят в общий список доступа к боту.
const allowed = new Set([...managers, ...staff, ...founders, ...partsmen]);

const [h = '10', m = '00'] = String(process.env.SUMMARY_TIME || '10:00').split(':');
const [rh = '18', rm = '00'] = String(process.env.REMINDER_TIME || '18:00').split(':');
const tz = process.env.SUMMARY_TZ || 'Europe/Moscow';

// Сводка учредителю «Состояние ремонтов». Часовой пояс СВОЙ и отличается от
// управленческих рассылок (те исторически по Москве): владелец назначил её на
// 10:00 по Красноярску (= 06:00 МСК). Меняя время, не перепутайте пояс.
const [dh = '10', dm = '00'] = String(process.env.FOUNDER_DIGEST_TIME || '10:00').split(':');
const founderTz = process.env.FOUNDER_DIGEST_TZ || 'Asia/Krasnoyarsk';

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
  founderDigest: {
    hour: Number(dh),
    minute: Number(dm),
    tz: founderTz,
    cron: `${Number(dm)} ${Number(dh)} * * *`,
  },
  managers,
  staff,
  founders,
  partsmen,
  isAllowed: (id) => allowed.has(String(id)),
  isManager: (id) => managers.includes(String(id)),
  isFounder: (id) => founders.includes(String(id)),
  isPartsman: (id) => partsmen.includes(String(id)),
  // Кому в разделе «Запчасти» показывать поставщика и цену закупки. Управляющему —
  // как и раньше; запчастисту — потому что он этим и занимается. Продажную цену и
  // прибыль это НЕ открывает: они остаются только у управляющего.
  canSeeSupply: (id) => managers.includes(String(id)) || partsmen.includes(String(id)),
  hasWhitelist: () => allowed.size > 0,
};
