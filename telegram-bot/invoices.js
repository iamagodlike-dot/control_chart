'use strict';
const { Markup } = require('telegraf');
const config = require('./config');
const { money } = require('./format');

// Форматирование и отправка счёта поставщика учредителю в Telegram. Используется и
// мгновенным пушем (notify.js), и списком «Счета к оплате»/дайджестом (index.js),
// чтобы вид счёта был одинаковым везде.

// Подпись счёта: поставщик, сумма, машины и позиции.
function fmtInvoice(inv) {
  const items = inv.items || [];
  const cars = new Map();
  for (const it of items) {
    const key = it.job_id || '—';
    const cur = cars.get(key) || { n: 0, label: '' };
    cur.n += 1;
    if (!cur.label) cur.label = [it.car_model, it.plate].filter(Boolean).join(' ') || 'Машина';
    cars.set(key, cur);
  }
  const carsLine = [...cars.values()].map((v) => `${v.label} (${v.n})`).join(', ');
  const lines = [
    `<b>Счёт к оплате${inv.number ? ' · ' + inv.number : ''}</b>`,
    `${inv.supplier || 'Поставщик'} — <b>${money(inv.amount)}</b>`,
  ];
  if (carsLine) lines.push(carsLine);
  const shown = items.slice(0, 12).map((it) => `• ${it.name || 'Запчасть'}${it.code ? ' · ' + it.code : ''} — ${it.qty || 1} шт`);
  if (shown.length) lines.push('', ...shown);
  if (items.length > 12) lines.push(`…и ещё ${items.length - 12}`);
  if (inv.comment) lines.push('', `💬 ${inv.comment}`);
  return lines.join('\n');
}

// Кнопка «Оплачено» под счётом (ведёт на подтверждение).
function payKeyboard(inv) {
  return Markup.inlineKeyboard([[Markup.button.callback('✅ Оплачено', `pay:${inv.id}`)]]);
}

// Полный адрес файла счёта: в базе относительный /uploads/…, дополняем базой nginx.
function fileUrl(inv) {
  if (!inv.file_url) return null;
  return /^https?:/i.test(inv.file_url) ? inv.file_url : config.photosBaseUrl + inv.file_url;
}

// Отправить один счёт получателю: файлом с подписью и кнопкой, а если файла нет
// (или он не скачался) — текстом с той же кнопкой.
async function sendInvoice(bot, chatId, inv) {
  const caption = fmtInvoice(inv);
  const kb = payKeyboard(inv);
  const url = fileUrl(inv);
  try {
    if (url) {
      await bot.telegram.sendDocument(chatId, url, { caption, parse_mode: 'HTML', ...kb });
      return;
    }
    await bot.telegram.sendMessage(chatId, caption + '\n\n⚠️ Файл счёта не приложен', { parse_mode: 'HTML', ...kb });
  } catch (e) {
    // Файл по ссылке не скачался Telegram’ом — пришлём хотя бы текст со ссылкой.
    await bot.telegram
      .sendMessage(chatId, caption + (url ? `\n\n📎 Файл: ${url}` : ''), { parse_mode: 'HTML', ...kb })
      .catch((err) => console.error('Не удалось отправить счёт:', err.message));
  }
}

module.exports = { fmtInvoice, payKeyboard, fileUrl, sendInvoice };
