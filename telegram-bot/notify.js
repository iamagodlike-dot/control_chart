'use strict';
const { db, isReady } = require('./firebase');
// Списки получателей и тумблеры уведомлений живут в базе и правятся на сайте
// («Настройки → Телеграм-бот») — поэтому спрашиваем их в момент отправки, а не
// запоминаем при запуске.
const config = require('./botConfig');
const { money, carLabel, esc, isRepair, partKindLabel } = require('./format');
const { invoiceAmount } = require('./money');
const { sendInvoice } = require('./invoices');

// Следим за базой в реальном времени и шлём уведомления о ключевых событиях:
//   • ✅ машина готова к выдаче (все её этапы стали «готово»)
//   • 💰 поступила оплата (счёт отмечен оплаченным)
//   • 🆕 добавлена новая машина
//   • 🔩 нужно заказать запчасти / счёт поставщика оплачен — запчастистам
// Первый снимок каждой коллекции — базовый (без уведомлений), чтобы не завалить
// чат при запуске. Уведомляем только о ПОСЛЕДУЮЩИХ изменениях.

// Сколько позиций перечислять в одном сообщении (у машины их бывают десятки, а у
// сообщения Telegram есть предел длины).
const PARTS_IN_MESSAGE = 15;

// Пустой статус = «Требуется» — так же трактует позицию сайт (normalizePart).
const partStatus = (p) => (p && p.status) || 'need';

// Позиции машины как Map(id → статус). Ключ — стабильный `id` из job.parts: это
// инвариант проекта (withPartIds при каждой записи). Позиции без id — недолеченное
// старьё; молча пропускаем, иначе пришлось бы считать ключом номер в массиве, и
// любая перестановка сыпала бы ложными «нужно заказать».
function partsById(data) {
  const m = new Map();
  for (const p of Array.isArray(data.parts) ? data.parts : []) {
    if (p && p.id) m.set(p.id, { status: partStatus(p), name: p.name, code: p.code, qty: p.qty, kind: p.kind });
  }
  return m;
}

// Строка позиции: «• Бампер передний · арт. 1234 · ×2 · Новое».
function partLine(p) {
  const code = p.code ? ` · арт. ${esc(p.code)}` : '';
  const kind = partKindLabel(p.kind) ? ` · ${partKindLabel(p.kind)}` : '';
  return `• ${esc(p.name || 'без названия')}${code} · ×${Number(p.qty) || 1}${kind}`;
}

// Заголовок + машина + список позиций (с обрезкой длинного хвоста).
function partsMessage(title, carText, items) {
  const lines = [`<b>${title}</b>`, carText, ''];
  lines.push(...items.slice(0, PARTS_IN_MESSAGE).map(partLine));
  if (items.length > PARTS_IN_MESSAGE) lines.push(`…и ещё ${items.length - PARTS_IN_MESSAGE}`);
  return lines.join('\n');
}

// Счёт поставщика считается оплаченным так же, как в data.js.
const invoiceIsPaid = (inv) => !!inv && (inv.status === 'paid' || !!inv.paid_at);

// Счёт оплачен → его позиции автоматически ушли в «Заказано» (markSupplierInvoicePaid
// в data.js). Запчастисту это сигнал: деньги прошли, можно оформлять заказ.
function invoicePaidMessage(inv) {
  const items = Array.isArray(inv.items) ? inv.items : [];
  const cars = [...new Set(
    items.map((it) => [it.car_model, it.plate].filter(Boolean).join(' ').trim()).filter(Boolean),
  )];
  const lines = [
    '<b>Счёт оплачен · позиции в «Заказано»</b>',
    `${esc(inv.supplier || 'Поставщик')}${inv.number ? ' · ' + esc(inv.number) : ''} — <b>${money(inv.amount)}</b>`,
  ];
  if (cars.length) lines.push(cars.map(esc).join(', '));
  if (items.length) {
    lines.push('');
    lines.push(...items.slice(0, PARTS_IN_MESSAGE).map(partLine));
    if (items.length > PARTS_IN_MESSAGE) lines.push(`…и ещё ${items.length - PARTS_IN_MESSAGE}`);
  }
  return lines.join('\n');
}

function startNotifier(bot) {
  if (!isReady()) {
    console.log('🔕 Уведомления выключены (нет подключения к базе).');
    return;
  }

  // Кто и что получает — считаем каждый раз заново: владелец мог только что
  // добавить человека или сменить ему роль на сайте.
  const managers = () => config.managers;
  const everyone = () => [...new Set([...config.managers, ...config.staff])];
  const partsmen = () => config.partsmen;

  // Отправка с оглядкой на тумблер: выключенное на сайте уведомление не уходит.
  const notify = async (kind, ids, text) => {
    if (!config.push(kind)) return;
    for (const id of ids) {
      try {
        await bot.telegram.sendMessage(id, text, { parse_mode: 'HTML' });
      } catch (e) {
        console.error(`Не удалось уведомить ${id}:`, e.message);
      }
    }
  };

  const jobsData = new Map();     // id -> {car_model, plate_number, archived}
  const stagesByJob = new Map();  // jobId -> Map(stageId -> status)
  const jobDone = new Map();      // jobId -> bool (есть этапы и все «готово»)
  const invoicePaid = new Map();  // invId -> bool
  const partsState = new Map();   // jobId -> {toOrder: bool, parts: Map(partId -> {...})}

  const label = (jid) => carLabel(jobsData.get(jid) || {});
  const isDone = (jid) => {
    const m = stagesByJob.get(jid);
    if (!m || m.size === 0) return false;
    for (const st of m.values()) if (st !== 'done') return false;
    return true;
  };

  // ─── Машины ───
  // Тот же слушатель отвечает и за запчасти: позиции лежат ВНУТРИ документа машины
  // (job.parts), отдельной коллекции у них нет — правка запчасти приходит сюда же
  // как «modified» машины.
  let jobsPrimed = false;
  db.collection('jobs').onSnapshot((snap) => {
    for (const ch of snap.docChanges()) {
      const d = ch.doc.data();
      const id = ch.doc.id;
      jobsData.set(id, { car_model: d.car_model, plate_number: d.plate_number, archived: !!d.archived });
      if (ch.type === 'added' && jobsPrimed && !d.archived) {
        notify('newCar', everyone(), `<b>Новая машина в работе</b>\n${label(id)}`);
      }

      if (ch.type === 'removed') {
        partsState.delete(id);
        continue;
      }

      // ─── Нужно заказать? ───
      // Заказывать имеет смысл только по машине В РЕМОНТЕ: пока идёт согласование
      // со страховой, позиции уже заведены (импорт Audatex), но их могут не
      // согласовать вовсе. Поэтому машину на согласовании пропускаем, а когда она
      // переходит в ремонт — показываем весь её список «Требуется» разом.
      const prev = partsState.get(id);
      const parts = partsById(d);
      const toOrder = !d.archived && isRepair(d);
      partsState.set(id, { toOrder, parts });
      if (!jobsPrimed || !partsmen().length || !toOrder) continue;

      const justStartedRepair = !!prev && !prev.toOrder;
      const fresh = [];
      for (const [pid, p] of parts) {
        if (p.status !== 'need') continue;
        // Новая позиция — либо старая, впервые ставшая поводом заказывать.
        if (!prev || !prev.parts.has(pid) || justStartedRepair) fresh.push(p);
      }
      if (fresh.length) notify('partsNeeded', partsmen(), partsMessage('Нужно заказать', label(id), fresh));
    }
    jobsPrimed = true;
  }, (e) => console.error('Слежение за машинами:', e.message));

  // ─── Этапы ───
  let stagesPrimed = false;
  db.collection('stages').onSnapshot((snap) => {
    const affected = new Set();
    for (const ch of snap.docChanges()) {
      const d = ch.doc.data();
      const id = ch.doc.id;
      const jid = d.job_id;
      if (!stagesByJob.has(jid)) stagesByJob.set(jid, new Map());
      const m = stagesByJob.get(jid);
      if (ch.type === 'removed') m.delete(id);
      else m.set(id, d.status);
      affected.add(jid);
    }
    for (const jid of affected) {
      const nowDone = isDone(jid);
      const was = jobDone.get(jid) || false;
      jobDone.set(jid, nowDone);
      if (stagesPrimed && nowDone && !was) {
        const j = jobsData.get(jid);
        if (!j || !j.archived) notify('ready', everyone(), `<b>Готова к выдаче</b>\n${label(jid)}`);
      }
    }
    stagesPrimed = true;
  }, (e) => console.error('Слежение за этапами:', e.message));

  // ─── Счета (оплата) ───
  let docsPrimed = false;
  db.collection('orderDocuments').onSnapshot((snap) => {
    for (const ch of snap.docChanges()) {
      const d = ch.doc.data();
      const id = ch.doc.id;
      if (d.type !== 'invoice') continue;
      const wasPaid = invoicePaid.get(id) || false;
      const isPaid = !!d.paid;
      invoicePaid.set(id, isPaid);
      if (docsPrimed && isPaid && !wasPaid) {
        notify('payment', managers(), `<b>Поступила оплата</b>\n${label(d.job_id)} — ${money(invoiceAmount(d))}`);
      }
    }
    docsPrimed = true;
  }, (e) => console.error('Слежение за счетами:', e.message));

  // ─── Счета поставщиков ───
  // Новый неоплаченный → мгновенный пуш учредителям с файлом.
  // Оплаченный → пуш запчастисту (позиции счёта ушли в «Заказано»).
  let supInvPrimed = false;
  const supInvSeen = new Set();
  const supInvPaid = new Map(); // invId -> оплачен ли (ловим переход «не оплачен → оплачен»)
  db.collection('supplierInvoices').onSnapshot(async (snap) => {
    for (const ch of snap.docChanges()) {
      const inv = { id: ch.doc.id, ...ch.doc.data() };
      const paid = invoiceIsPaid(inv);

      if (ch.type === 'removed') {
        supInvPaid.delete(inv.id);
        continue;
      }
      const wasPaid = supInvPaid.get(inv.id) || false;
      supInvPaid.set(inv.id, paid);
      // Помним, что счёт уже был оплачен: если слушатель переподключится и пришлёт
      // документы заново, повторного «оплачено» не будет.
      if (supInvPrimed && paid && !wasPaid && partsmen().length) {
        notify('invoicePaid', partsmen(), invoicePaidMessage(inv));
      }

      if (ch.type !== 'added') continue;
      const fresh = !supInvSeen.has(inv.id);
      supInvSeen.add(inv.id);
      if (supInvPrimed && fresh && !paid && config.push('supplierInvoice')) {
        for (const id of config.founders) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await sendInvoice(bot, id, inv);
          } catch (e) {
            console.error(`Пуш счёта учредителю ${id}:`, e.message);
          }
        }
      }
    }
    supInvPrimed = true;
  }, (e) => console.error('Слежение за счетами поставщиков:', e.message));

  console.log('🔔 Уведомления включены (готово к выдаче / новая машина — всем, оплата — управляющим, счета поставщиков — учредителям).');
  console.log(`🔩 Запчасти (нужно заказать / счёт оплачен): запчастистов ${partsmen().length || 'пока нет'}`);
}

module.exports = { startNotifier };
