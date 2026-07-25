'use strict';
// Отправляет текст (из stdin) управляющим через бота. Используется умной
// запланированной задачей для доставки готового разбора.
//   echo "текст" | node send-managers.js           → всем управляющим (config.managers)
//   echo "текст" | node send-managers.js <chatId>   → только в один чат (для теста)
require('dotenv').config();
const fs = require('fs');
const { Telegraf } = require('telegraf');
// Список получателей берём из тех же настроек, что и сам бот (база + .env как
// страховка), иначе после правки списка на сайте скрипт слал бы по-старому.
const config = require('./botConfig');

const text = fs.readFileSync(0, 'utf8').trim(); // весь stdin
if (!text) { console.error('Пустой текст — нечего отправлять.'); process.exit(1); }
if (!config.botToken) { console.error('Нет BOT_TOKEN.'); process.exit(1); }

const arg = process.argv[2];
const bot = new Telegraf(config.botToken);

(async () => {
  await config.start();
  const configured = config.mailDigestTo.length ? config.mailDigestTo : config.managers;
  const targets = arg ? [arg] : configured;
  if (!targets.length) { console.error('Некому отправлять (пустой список управляющих).'); process.exit(1); }
  let ok = 0;
  for (const id of targets) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await bot.telegram.sendMessage(id, text, { parse_mode: 'HTML', disable_web_page_preview: true });
      ok += 1;
    } catch (e) {
      // Если разметка HTML не понравилась — шлём как обычный текст.
      try {
        // eslint-disable-next-line no-await-in-loop
        await bot.telegram.sendMessage(id, text.replace(/<[^>]+>/g, ''), { disable_web_page_preview: true });
        ok += 1;
      } catch (e2) {
        console.error(`Не отправилось ${id}: ${e2.message}`);
      }
    }
  }
  console.log(`Отправлено: ${ok}/${targets.length}`);
  process.exit(0);
})();
