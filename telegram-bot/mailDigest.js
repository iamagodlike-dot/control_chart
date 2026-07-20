'use strict';
// Ежедневный отчёт по почте «итог дня»: сверяет письма страховых с базой машин
// и раскладывает переписку на «требует ответа / ждём их / брошено». Формат —
// фиксированный шаблон (одинаковый каждый день). Всё только на чтение.
const dayjs = require('dayjs');
const { fetchMessages, isConfigured } = require('./mail');
const { loadGraph } = require('./data');
const { money, esc } = require('./format');

const DAYS = Number(process.env.MAIL_DIGEST_DAYS || 40); // окно для анализа диалогов
const RECENT_DAYS = Number(process.env.MAIL_DIGEST_RECENT_DAYS || 2); // «за сутки» (с запасом)
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

const SELF = (process.env.MAIL_USER || '').toLowerCase();
const daysAgo = (ms, now) => Math.round((now - ms) / 864e5 * 10) / 10;

// Красивое имя контрагента для строки.
function who(m) {
  const a = m.dir === 'in' ? m.fromAddr : m.toAddr;
  return a && a !== SELF ? a : (m.fromName || '—');
}

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

// Обрезаем и СРАЗУ экранируем — результат идёт прямо в HTML сообщения Telegram.
function trim(s, n = 64) { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length > n) s = `${s.slice(0, n)}…`; return esc(s); }

async function buildDigestText(now = Date.now()) {
  if (!isConfigured()) {
    return '<b>📬 Почта</b>\n\nНе настроен доступ к почте. Задайте MAIL_USER и MAIL_PASSWORD в .env бота.';
  }

  let messages; let g;
  try {
    [messages, g] = await Promise.all([fetchMessages({ days: DAYS, bodyDays: RECENT_DAYS + 1 }), loadGraph()]);
  } catch (e) {
    return `<b>📬 Почта — итог дня</b>\n\n⚠️ Не удалось получить почту: ${esc(e.message)}`;
  }

  const idx = buildIndex(g.jobs);
  const threads = threadize(messages);
  const human = threads.filter((t) => !t.auto && !TRASH.test(t.subject));

  // ── Диалоги ──
  const needReply = human
    .filter((t) => t.lastDir === 'in' && daysAgo(t.lastDate, now) <= 14)
    .sort((a, b) => a.lastDate - b.lastDate); // старые сверху — им «горит» дольше
  const waitingThem = human.filter((t) => t.lastDir === 'out' && daysAgo(t.lastDate, now) >= 3).length;
  const abandoned = human.filter((t) => t.nIn > 0 && t.nOut > 0 && daysAgo(t.lastDate, now) >= 14).length;

  // ── Свежие входящие: сверка с базой ──
  const recentIn = messages.filter((m) => m.dir === 'in' && daysAgo(m.date, now) <= RECENT_DAYS);
  const withdrawals = []; const notInSystem = []; const mismatches = []; const closing = []; const invoicesMail = [];
  const seenNew = new Set();
  for (const m of recentIn) {
    const blob = `${m.subject} ${m.text || ''}`;
    const ex = extract(blob);
    const job = matchJob(ex, idx);

    // Страховая отзывает/аннулирует направление — потеря, если проспать.
    if (isInsurer(m) && /отзыв|аннулир|отозв|расторж/i.test(m.subject)) {
      withdrawals.push(`🔻 ${trim(m.subject, 70)}${job ? ` — <b>${esc(job.plate_number || '')}</b>` : ''}`);
      continue;
    }
    // Результат согласования: сверяем сумму и статус карточки.
    if (/результат согласовани|согласована сумма|согласовано.*ремонт/i.test(blob)) {
      const am = blob.match(/(?:в размере|сумм\w*)\D{0,12}?([\d][\d\s]{3,})[.,](\d{2})/i);
      const sum = am ? Number(digits(am[1])) : null;
      if (job) {
        const stApproved = job.approval_status === 'approved' || job.phase === 'repair';
        if (!stApproved) {
          mismatches.push(`• <b>${esc(job.plate_number || job.car_model || '?')}</b> — согласовано${sum ? ` ${money(sum)}` : ''}, а в карточке ещё «на согласовании»`);
        }
      }
      continue;
    }
    // Просят продублировать закрывающие / нет счёта.
    if (isInsurer(m) && /нет сч[её]та|продублир|закрывающ/i.test(blob)) {
      closing.push(`• ${trim(m.subject, 70)}${job ? ` — <b>${esc(job.plate_number || '')}</b>` : ''}`);
      continue;
    }
    // Письмо от страховой про машину, которой нет в базе.
    if (isInsurer(m) && !job && (ex.plates.length || ex.claims.length)) {
      const key = ex.plates[0] || ex.claims[0];
      if (!seenNew.has(key)) {
        seenNew.add(key);
        notInSystem.push(`• ${trim(m.subject, 78)}`);
      }
      continue;
    }
    // Счёт поставщика в почте (не от страховой).
    if (!isInsurer(m) && /счёт на оплату|счет на оплату|на оплату №|инвойс/i.test(blob)) {
      invoicesMail.push(`• ${trim(m.subject, 70)} — ${esc(who(m))}`);
    }
  }

  // ── Сборка шаблона ──
  const nIn = messages.filter((m) => m.dir === 'in').length;
  const nOut = messages.filter((m) => m.dir === 'out').length;
  const L = [];
  L.push(`<b>📬 Почта — итог дня</b> · ${dayjs(now).format('DD.MM')}`);
  L.push(`<i>${messages.length} писем за ${DAYS} дн. (вход ${nIn} / исход ${nOut}) · диалогов ${threads.length}</i>`);
  L.push('┈┈┈┈┈┈┈┈┈┈┈┈');

  const section = (title, items, empty) => {
    if (!items.length) { if (empty) L.push(`${title} — ${empty}`); return; }
    L.push(`${title} — ${items.length}`);
    items.slice(0, CAP).forEach((s) => L.push(s));
    if (items.length > CAP) L.push(`   …и ещё ${items.length - CAP}`);
    L.push('');
  };

  // 1. Требуют вашего ответа.
  const needLines = needReply.map((t) => `• ${trim(t.subject)}\n   <i>${esc(t.parties[0] || '?')} · ${daysAgo(t.lastDate, now)} дн.</i>`);
  section('<b>🔴 Требуют вашего ответа</b>', needLines, 'нет');

  // 2. Страховая отзывает/аннулирует.
  if (withdrawals.length) section('<b>🔻 Страховая отзывает направление</b>', withdrawals);

  // 3. Согласовано — обновить карточку.
  if (mismatches.length) section('<b>⚠️ Согласование получено — обновить карточку</b>', mismatches);

  // 4. Просят закрывающие / нет счёта.
  if (closing.length) section('<b>📄 Просят продублировать документы</b>', closing);

  // 5. Новые убытки без карточки.
  section('<b>🆕 Страховая прислала, в базе нет</b>', notInSystem, 'нет');

  // 6. Счета поставщиков в почте.
  if (invoicesMail.length) section('<b>💰 Счета в почте</b>', invoicesMail);

  // 7. Хвосты — счётчиками.
  L.push('┈┈┈┈┈┈┈┈┈┈┈┈');
  L.push(`🟡 Ждём ответа от них: <b>${waitingThem}</b>  ·  ⚫ Давно висят (2+ нед.): <b>${abandoned}</b>`);

  return L.join('\n').trim();
}

module.exports = { buildDigestText };
