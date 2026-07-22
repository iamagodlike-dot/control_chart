'use strict';
// Ежедневный отчёт по почте «итог дня»: сверяет письма страховых с базой машин
// и раскладывает переписку на «требует ответа / ждём их / брошено».
//
// Разделено на два слоя:
//   buildDigestData()  — сбор и сверка, возвращает СТРУКТУРУ находок (для шаблона
//                        и для «умной» задачи, которая пишет текст сама);
//   formatDigestText() — фиксированный шаблон (одинаковый каждый день) из этой структуры.
// Всё только на чтение.
const dayjs = require('dayjs');
const { fetchMessages, isConfigured } = require('./mail');
const { loadGraph } = require('./data');
const { money, esc } = require('./format');

const DAYS = Number(process.env.MAIL_DIGEST_DAYS || 40); // окно для анализа диалогов
const RECENT_DAYS = Number(process.env.MAIL_DIGEST_RECENT_DAYS || 2); // «новые убытки» — только свежие
const ACTION_DAYS = Number(process.env.MAIL_DIGEST_ACTION_DAYS || 7); // отзывы/согласования/док-ты — с запасом
const INVOICE_DAYS = Number(process.env.MAIL_DIGEST_INVOICE_DAYS || 14); // счета поставщиков — дольше висят
const CAP = 8; // максимум строк в разделе

// ── Госномер: кириллица и её латинские двойники → единый вид ──
const MAP = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };
const PL = 'АВЕКМНОРСТУХABEKMHOPCTYX';
function canonPlate(s) {
  const u = String(s || '').toUpperCase().replace(/[^A-ZА-Я0-9]/g, '');
  let o = ''; for (const c of u) o += (MAP[c] || c); return o;
}
const plateRe = new RegExp(`[${PL}]\\s?\\d{3}\\s?[${PL}]{2}\\s?\\d{2,3}`, 'gi');
const vinRe = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
const resoRe = /\b(?:АТ|AT|ПР|ПP)\s?\d{6,}\b/gi;
const ingosRe = /\b\d{3}-\d{3}-\d{4,}\/\d{2}(?:-\d+)?\b|\b\d{3}-\d{4,}\/\d{2}\b/g;
const vskRe = /\b1\d(?:\s?\d){6}\b/g; // 8-значные номера убытков ВСК (в т.ч. с пробелами)

const digits = (s) => String(s || '').replace(/\D/g, '');
const normClaim = (s) => String(s || '').toUpperCase().replace(/\s/g, '');

function extract(text) {
  const t = ` ${String(text || '')} `;
  const plates = [...t.matchAll(plateRe)].map((m) => canonPlate(m[0])).filter((p) => p.length >= 6);
  const vins = [...t.matchAll(vinRe)].map((m) => m[0].toUpperCase());
  const claims = new Set();
  for (const m of t.matchAll(resoRe)) claims.add(normClaim(m[0]));
  for (const m of t.matchAll(ingosRe)) claims.add(normClaim(m[0]));
  for (const m of t.matchAll(vskRe)) { const d = digits(m[0]); if (d.length === 8) claims.add(d); }
  return { plates: [...new Set(plates)], vins: [...new Set(vins)], claims: [...claims] };
}

function buildIndex(jobs) {
  const byClaim = new Map(); const byPlate = new Map(); const byVin = new Map();
  const put = (m, k, j) => { if (k && !m.has(k)) m.set(k, j); };
  for (const j of jobs) {
    if (j.claim_number) {
      const n = normClaim(j.claim_number);
      put(byClaim, n, j);
      put(byClaim, n.split('/')[0], j); // ядро до «/» (АТ17970959/1 → АТ17970959)
      const d = digits(j.claim_number);
      if (d.length >= 7) put(byClaim, d, j);
    }
    const p = canonPlate(j.plate_number);
    if (p.length >= 6) put(byPlate, p, j);
    if (j.vin) put(byVin, String(j.vin).toUpperCase(), j);
  }
  return { byClaim, byPlate, byVin };
}

function matchJob(ex, idx) {
  for (const c of ex.claims) {
    if (idx.byClaim.has(c)) return idx.byClaim.get(c);
    const core = c.split('/')[0];
    if (idx.byClaim.has(core)) return idx.byClaim.get(core);
    const d = digits(c);
    if (d.length >= 7 && idx.byClaim.has(d)) return idx.byClaim.get(d);
  }
  for (const p of ex.plates) if (idx.byPlate.has(p)) return idx.byPlate.get(p);
  for (const v of ex.vins) if (idx.byVin.has(v)) return idx.byVin.get(v);
  return null;
}

// ── Классификация отправителей ──
const AUTO = /vsk_info@vsk\.ru|service_offers|smeta_sfo|repair_order@reso\.ru|noreply|no-reply|@360\.yandex|id\.yandex|emex\.ru|pay\.stoa/i;
const INSURER = /@(?:[\w.-]+\.)?(?:vsk\.ru|reso\.ru|ingos\.ru)/i;
const isInsurer = (m) => INSURER.test(m.fromAddr) || /\b(ВСК|РЕСО|ИНГОС|ингосстрах)\b/i.test(`${m.fromName} ${m.subject}`);
// Независимый оценщик (АВТО-EXPERT): ему обычно НЕ отвечают — получают расчёт
// (аудатекс) и пересылают его страховой на согласование. Поэтому его письма —
// не «требуют ответа», а «расчёт готов → переслать страховой».
const EXPERT = /avto-expert24@bk\.ru|@24exp\.ru/i;

const SELF = (process.env.MAIL_USER || '').toLowerCase();
const daysAgo = (ms, now) => Math.round((now - ms) / 864e5 * 10) / 10;

// ── Склейка писем в диалоги (union-find по messageId/ссылкам + запасная по теме) ──
function threadize(msgs) {
  const parent = new Map();
  const mk = (x) => { if (!parent.has(x)) parent.set(x, x); };
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { mk(a); mk(b); a = find(a); b = find(b); if (a !== b) parent.set(a, b); };

  msgs.forEach((m, i) => { m.key = m.messageId || `msg-${i}`; mk(m.key); });
  for (const m of msgs) for (const l of m.linkIds) union(m.key, l);
  const bySubj = new Map();
  for (const m of msgs) { if (!m.subjNorm) continue; if (!bySubj.has(m.subjNorm)) bySubj.set(m.subjNorm, []); bySubj.get(m.subjNorm).push(m); }
  for (const arr of bySubj.values()) for (let i = 1; i < arr.length; i++) union(arr[0].key, arr[i].key);

  const groups = new Map();
  for (const m of msgs) { const r = find(m.key); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(m); }

  const threads = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.date - b.date);
    const last = arr[arr.length - 1];
    const parties = [...new Set(arr.map((m) => (m.dir === 'in' ? m.fromAddr : m.toAddr)).filter((a) => a && a !== SELF))];
    threads.push({
      subject: (arr.find((m) => m.subject) || {}).subject || '(без темы)',
      parties,
      auto: parties.length > 0 && parties.every((p) => AUTO.test(p)),
      nIn: arr.filter((m) => m.dir === 'in').length,
      nOut: arr.filter((m) => m.dir === 'out').length,
      lastDate: last.date,
      lastDir: last.dir,
    });
  }
  return threads;
}

const TRASH = /^\s*(тест|test|фейк|проверка|\d{1,3})\s*$/i; // мусорные темы
// Шум для раздела «требуют ответа»: пустые темы, голые RE:/FW:, автоответы.
const isNoise = (s) => {
  s = String(s || '').trim();
  return !s || TRASH.test(s) || /^(re|fw|fwd)\b[:\s]*$/i.test(s) || /автоматическ\S* ответ|автоответ|auto(?:matic)? reply|out of office/i.test(s);
};

const dedupeBySubject = (arr) => {
  const seen = new Set();
  return arr.filter((x) => { const k = x.subject; if (seen.has(k)) return false; seen.add(k); return true; });
};

// ── СБОР ДАННЫХ (факты, без оформления) ──
async function buildDigestData(now = Date.now()) {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };
  let messages; let g;
  try {
    [messages, g] = await Promise.all([fetchMessages({ days: DAYS, bodyDays: ACTION_DAYS }), loadGraph()]);
  } catch (e) {
    return { ok: false, reason: 'fetch_error', error: e.message };
  }

  const idx = buildIndex(g.jobs);
  const threads = threadize(messages);
  const human = threads.filter((t) => !t.auto && !isNoise(t.subject));

  const lastInHuman = human.filter((t) => t.lastDir === 'in' && daysAgo(t.lastDate, now) <= 14
    && !/счёт на оплату|счет на оплату|на оплату №/i.test(t.subject));
  const isExpertThread = (t) => t.parties.some((p) => EXPERT.test(p));
  // Оценщику не отвечают — его расчёты идут в отдельный раздел «переслать страховой».
  const needReply = lastInHuman.filter((t) => !isExpertThread(t))
    .sort((a, b) => a.lastDate - b.lastDate)
    .map((t) => ({ subject: t.subject, from: t.parties[0] || '?', ageDays: daysAgo(t.lastDate, now), nIn: t.nIn, nOut: t.nOut }));
  const expertCalcs = lastInHuman.filter(isExpertThread)
    .sort((a, b) => a.lastDate - b.lastDate)
    .map((t) => ({ subject: t.subject, ageDays: daysAgo(t.lastDate, now) }));
  const waitingThem = human.filter((t) => t.lastDir === 'out' && daysAgo(t.lastDate, now) >= 3).length;
  const abandoned = human.filter((t) => t.nIn > 0 && t.nOut > 0 && daysAgo(t.lastDate, now) >= 14).length;

  const withdrawals = []; const notInSystem = []; const closing = []; const invoicesMail = [];
  const mismatch = new Map(); // jobId → {plate, model, sum}
  const seenNew = new Set();
  for (const m of messages) {
    if (m.dir !== 'in') continue;
    const age = daysAgo(m.date, now);
    if (age > INVOICE_DAYS) continue;
    const blob = `${m.subject} ${m.text || ''}`;
    const ex = extract(blob);
    const job = matchJob(ex, idx);
    const snippet = String(m.text || '').slice(0, 400);

    if (age <= ACTION_DAYS && isInsurer(m) && /отзыв|аннулир|отозв|расторж/i.test(m.subject)) {
      withdrawals.push({ subject: m.subject, from: m.fromAddr, ageDays: age, plate: job ? job.plate_number : '', model: job ? job.car_model : '', snippet });
      continue;
    }
    if (age <= ACTION_DAYS && /результат согласовани|согласована сумма|согласовано.{0,20}ремонт/i.test(blob)) {
      const am = blob.match(/(?:в размере|сумм\w*)\D{0,12}?([\d][\d\s]{3,})[.,]\d{2}/i);
      const sum = am ? Number(digits(am[1])) : null;
      if (job && job.approval_status !== 'approved' && job.phase !== 'repair') {
        const cur = mismatch.get(job.id) || { plate: job.plate_number || job.car_model || '?', model: job.car_model || '', sum: 0 };
        if (sum && sum > cur.sum) cur.sum = sum;
        mismatch.set(job.id, cur);
      }
      continue;
    }
    if (age <= ACTION_DAYS && isInsurer(m) && /нет сч[её]та|продублир|закрывающ/i.test(blob)) {
      closing.push({ subject: m.subject, from: m.fromAddr, ageDays: age, plate: job ? job.plate_number : '', snippet });
      continue;
    }
    if (age <= RECENT_DAYS && isInsurer(m) && !job && (ex.plates.length || ex.claims.length)) {
      const key = ex.plates[0] || ex.claims[0];
      if (!seenNew.has(key)) { seenNew.add(key); notInSystem.push({ subject: m.subject, from: m.fromAddr, ageDays: age, snippet }); }
      continue;
    }
    if (!isInsurer(m) && /счёт на оплату|счет на оплату|на оплату №|инвойс/i.test(blob)) {
      invoicesMail.push({ subject: m.subject, from: m.fromAddr, ageDays: age });
    }
  }

  return {
    ok: true,
    date: dayjs(now).format('DD.MM'),
    counts: { total: messages.length, in: messages.filter((m) => m.dir === 'in').length, out: messages.filter((m) => m.dir === 'out').length, threads: threads.length, days: DAYS },
    needReply,
    expertCalcs,
    withdrawals: dedupeBySubject(withdrawals),
    mismatches: [...mismatch.values()],
    closing: dedupeBySubject(closing),
    notInSystem,
    invoicesMail: dedupeBySubject(invoicesMail),
    waitingThem,
    abandoned,
  };
}

// ── ОФОРМЛЕНИЕ (фиксированный шаблон Telegram HTML) ──
function trim(s, n = 64) { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length > n) s = `${s.slice(0, n)}…`; return esc(s); }

function formatDigestText(data) {
  if (!data || !data.ok) {
    if (data && data.reason === 'not_configured') return '<b>📬 Почта</b>\n\nНе настроен доступ к почте. Задайте MAIL_USER и MAIL_PASSWORD в .env бота.';
    return `<b>📬 Почта — итог дня</b>\n\n⚠️ Не удалось получить почту${data && data.error ? `: ${esc(data.error)}` : ''}`;
  }
  const c = data.counts;
  const L = [];
  L.push(`<b>📬 Почта — итог дня</b> · ${data.date}`);
  L.push(`<i>${c.total} писем за ${c.days} дн. (вход ${c.in} / исход ${c.out}) · диалогов ${c.threads}</i>`);
  L.push('┈┈┈┈┈┈┈┈┈┈┈┈');

  const section = (title, items, empty) => {
    if (!items.length) { if (empty) L.push(`${title} — ${empty}`); return; }
    L.push(`${title} — ${items.length}`);
    items.slice(0, CAP).forEach((s) => L.push(s));
    if (items.length > CAP) L.push(`   …и ещё ${items.length - CAP}`);
    L.push('');
  };

  section('<b>🔴 Требуют вашего ответа</b>',
    data.needReply.map((t) => `• ${trim(t.subject)}\n   <i>${esc(t.from)} · ${t.ageDays} дн.</i>`), 'нет');
  if (data.withdrawals.length) section('<b>🔻 Страховая отзывает направление</b>',
    data.withdrawals.map((w) => `🔻 ${trim(w.subject, 70)}${w.plate ? ` — <b>${esc(w.plate)}</b>` : ''}`));
  if (data.mismatches.length) section('<b>⚠️ Согласование получено — обновить карточку</b>',
    data.mismatches.map((v) => `• <b>${esc(v.plate)}</b> — согласовано${v.sum ? ` ${money(v.sum)}` : ''}, а в карточке ещё «на согласовании»`));
  if (data.closing.length) section('<b>📄 Просят продублировать документы</b>',
    data.closing.map((cl) => `• ${trim(cl.subject, 70)}${cl.plate ? ` — <b>${esc(cl.plate)}</b>` : ''}`));
  if (data.expertCalcs.length) section('<b>🧮 Расчёты от оценщика — переслать страховой</b>',
    data.expertCalcs.map((e) => `• ${trim(e.subject, 72)} · <i>${e.ageDays} дн.</i>`));
  section('<b>🆕 Страховая прислала, в базе нет</b>',
    data.notInSystem.map((n) => `• ${trim(n.subject, 78)}`), 'нет');
  if (data.invoicesMail.length) section('<b>💰 Счета в почте</b>',
    data.invoicesMail.map((i) => `• ${trim(i.subject, 70)} — ${esc(i.from)}`));

  L.push('┈┈┈┈┈┈┈┈┈┈┈┈');
  L.push(`🟡 Ждём ответа от них: <b>${data.waitingThem}</b>  ·  ⚫ Давно висят (2+ нед.): <b>${data.abandoned}</b>`);
  return L.join('\n').trim();
}

async function buildDigestText(now = Date.now()) {
  return formatDigestText(await buildDigestData(now));
}

module.exports = { buildDigestText, buildDigestData, formatDigestText };
