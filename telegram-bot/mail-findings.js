'use strict';
// Отдаёт «находки за день» по почте в виде JSON (для умной запланированной задачи,
// которая пишет человеческий текст сама). Только чтение. Запуск: node mail-findings.js
require('dotenv').config();
const { buildDigestData } = require('./mailDigest');

buildDigestData()
  .then((data) => { process.stdout.write(JSON.stringify(data)); process.exit(0); })
  .catch((e) => { console.error('mail-findings error:', e.message); process.exit(1); });
