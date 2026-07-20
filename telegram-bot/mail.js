'use strict';
// Чтение почты Яндекса по IMAP (только чтение). Возвращает письма из «Входящих»
// и «Отправленных» за окно в N дней — заголовки для склейки в диалоги, плюс тела
// только у свежих входящих (для сумм согласования и т.п.) — чтобы не качать лишнее.
require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const HOST = process.env.MAIL_HOST || 'imap.yandex.ru';
const PORT = Number(process.env.MAIL_PORT || 993);
const USER = process.env.MAIL_USER || '';
const PASS = process.env.MAIL_PASSWORD || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const addr = (a) => (a && a.address ? String(a.address).toLowerCase() : '');
const firstAddr = (l) => (Array.isArray(l) && l[0] ? addr(l[0]) : '');

function normSubject(s) {
  return String(s || '')
    .replace(/^([\s[\]]*\b(re|fw|fwd|отв|пересылка)\b[:\s]*)+/gi, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function isConfigured() { return !!(USER && PASS); }

function cfg() {
  return {
    host: HOST, port: PORT, secure: true,
    auth: { user: USER, pass: PASS }, logger: false,
    connectionTimeout: 30000, greetingTimeout: 20000, socketTimeout: 120000,
  };
}

// Первое соединение из некоторых окружений бывает капризным (CONNECT_TIMEOUT) —
// не сдаёмся сразу, повторяем; настоящие ошибки (пароль/доступ) прокидываем сразу.
async function connect() {
  let lastErr;
  for (let i = 1; i <= 6; i++) {
    const c = new ImapFlow(cfg());
    c.on('error', () => {});
    try { await c.connect(); return c; } // eslint-disable-line no-await-in-loop
    catch (e) {
      lastErr = e;
      const timeout = e.code === 'CONNECT_TIMEOUT' || /timeout/i.test(String(e.code || e.message));
      if (!timeout) throw e;
      await sleep(1500); // eslint-disable-line no-await-in-loop
    }
  }
  throw lastErr || new Error('IMAP: не удалось соединиться');
}

async function fetchHeaders(client, folder, dir, since, out) {
  let lock;
  try { lock = await client.getMailboxLock(folder); } catch { return; }
  try {
    const found = (await client.search({ since })) || [];
    const uids = Array.isArray(found) ? found : [];
    if (!uids.length) return;
    for await (const msg of client.fetch(uids, { envelope: true, headers: ['in-reply-to', 'references'] })) {
      const env = msg.envelope || {};
      const hdr = msg.headers ? msg.headers.toString() : '';
      out.push({
        dir,
        folder,
        date: env.date ? new Date(env.date).getTime() : (msg.internalDate ? new Date(msg.internalDate).getTime() : 0),
        fromName: env.from && env.from[0] ? (env.from[0].name || addr(env.from[0])) : '',
        fromAddr: firstAddr(env.from),
        toAddr: firstAddr(env.to),
        subject: env.subject || '',
        subjNorm: normSubject(env.subject),
        messageId: env.messageId || '',
        linkIds: hdr.match(/<[^>]+>/g) || [],
        text: '',
      });
    }
  } finally { if (lock) lock.release(); }
}

// Догружаем тела только у свежих входящих (в окне bodyDays) — их немного.
async function fetchBodies(client, folder, since, byId) {
  let lock;
  try { lock = await client.getMailboxLock(folder); } catch { return; }
  try {
    const found = (await client.search({ since })) || [];
    const uids = Array.isArray(found) ? found : [];
    if (!uids.length) return;
    for await (const msg of client.fetch(uids, { envelope: true, source: true })) {
      const id = (msg.envelope && msg.envelope.messageId) || '';
      if (!id || !byId.has(id)) continue;
      try {
        const p = await simpleParser(msg.source);
        byId.get(id).text = String(p.text || p.html || '').replace(/\s+/g, ' ').slice(0, 4000);
      } catch { /* тело не разобралось — не страшно */ }
    }
  } finally { if (lock) lock.release(); }
}

async function fetchMessages({ days = 40, bodyDays = 3 } = {}) {
  if (!isConfigured()) throw new Error('Почта не настроена: задайте MAIL_USER и MAIL_PASSWORD в .env');
  const client = await connect();
  let sentPath = 'Sent';
  try {
    const paths = (await client.list()).map((b) => b.path);
    sentPath = paths.find((p) => /^sent$/i.test(p)) || paths.find((p) => /sent|отправ/i.test(p)) || 'Sent';
  } catch { /* оставим Sent по умолчанию */ }

  const since = new Date(Date.now() - days * 864e5);
  const bodySince = new Date(Date.now() - bodyDays * 864e5);
  const out = [];
  await fetchHeaders(client, 'INBOX', 'in', since, out);
  await fetchHeaders(client, sentPath, 'out', since, out);
  const byId = new Map(out.filter((m) => m.dir === 'in' && m.messageId).map((m) => [m.messageId, m]));
  await fetchBodies(client, 'INBOX', bodySince, byId);
  try { await client.logout(); } catch { /* уже закрыто */ }
  return out;
}

module.exports = { fetchMessages, isConfigured, normSubject };
