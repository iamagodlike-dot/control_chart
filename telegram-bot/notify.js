'use strict';
const { db, isReady } = require('./firebase');
const config = require('./config');
const { money, carLabel } = require('./format');
const { invoiceAmount } = require('./money');

// Следим за базой в реальном времени и шлём уведомления о ключевых событиях:
//   • ✅ машина готова к выдаче (все её этапы стали «готово»)
//   • 💰 поступила оплата (счёт отмечен оплаченным)
//   • 🆕 добавлена новая машина
// Первый снимок каждой коллекции — базовый (без уведомлений), чтобы не завалить
// чат при запуске. Уведомляем только о ПОСЛЕДУЮЩИХ изменениях.

function startNotifier(bot) {
  if (!isReady()) {
    console.log('🔕 Уведомления выключены (нет подключения к базе).');
    return;
  }

  const managers = config.managers;
  const everyone = [...new Set([...config.managers, ...config.staff])];

  const notify = async (ids, text) => {
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

  const label = (jid) => carLabel(jobsData.get(jid) || {});
  const isDone = (jid) => {
    const m = stagesByJob.get(jid);
    if (!m || m.size === 0) return false;
    for (const st of m.values()) if (st !== 'done') return false;
    return true;
  };

  // ─── Машины ───
  let jobsPrimed = false;
  db.collection('jobs').onSnapshot((snap) => {
    for (const ch of snap.docChanges()) {
      const d = ch.doc.data();
      const id = ch.doc.id;
      jobsData.set(id, { car_model: d.car_model, plate_number: d.plate_number, archived: !!d.archived });
      if (ch.type === 'added' && jobsPrimed && !d.archived) {
        notify(everyone, `<b>Новая машина в работе</b>\n${label(id)}`);
      }
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
        if (!j || !j.archived) notify(everyone, `<b>Готова к выдаче</b>\n${label(jid)}`);
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
        notify(managers, `<b>Поступила оплата</b>\n${label(d.job_id)} — ${money(invoiceAmount(d))}`);
      }
    }
    docsPrimed = true;
  }, (e) => console.error('Слежение за счетами:', e.message));

  console.log(`🔔 Уведомления включены (готово к выдаче / новая машина — всем, оплата — управляющим).`);
}

module.exports = { startNotifier };
