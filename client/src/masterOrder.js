import { uid } from './orderDoc.js';
import { pickCostingSource } from './costing.js';

// Pure helpers for «Наряд мастерам» — the INTERNAL layer of real labour prices.
// No React, no Firestore (same style as costing.js / orderDoc.js).
//
// Зачем это нужно. Страховой мы выставляем работы по ЗАНИЖЕННЫМ ценам — они уходят
// в заказ-наряд/акт/счёт. Мастеру же платим по РЕАЛЬНОЙ расценке, и состав работ у
// него шире (что-то делается сверх заказ-наряда). Поэтому рядом с ценами «наружу»
// живёт свой список работ с ценами «внутрь»: job.costing.works.
//
// Инварианты:
//   • цена работы И ЕСТЬ заработок мастера за неё (никаких процентов);
//   • одна работа = один мастер, назначается вручную;
//   • реальные цены НИКОГДА не попадают в печатные документы клиенту/страховой;
//   • у каждой строки СТАБИЛЬНЫЙ id (как у запчастей) — иначе правка/удаление
//     молча ломаются при пересиде;
//   • ни одно поле не может быть undefined: api.jobs.update чистит undefined
//     только на верхнем уровне, вложенный undefined роняет запись в Firestore.

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Ключ сопоставления работы при пересиде — название без регистра и лишних пробелов.
// У работ нет артикула (в отличие от запчастей), сопоставлять больше не по чему.
const workKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Сумма строки: кол-во × реальная цена, округлённая ДО целого ИМЕННО ЗДЕСЬ.
// Округление обязано быть построчным и единственным: наряд-задание, строки оплаты
// (labor), себестоимость (works_sum) и кабинет мастера складывают одни и те же
// строки. Округли где-то итог, а не строку — и мастер подпишет одну сумму, а в
// зарплате увидит другую (при дробном кол-ве: 2 × 0,5 × 3333 = 3333 против 3334).
export const workSum = (w) => Math.round(num(w?.qty, 1) * num(w?.price, 0));

// Приводим строку к каноничному виду: никаких undefined, числа — числами.
export function normalizeWork(w = {}) {
  return {
    id: w.id || uid(),
    name: String(w.name || ''),
    qty: num(w.qty, 1),
    price: num(w.price, 0),
    master_id: w.master_id || '',
    master_name: String(w.master_name || ''),
    from_order: w.from_order !== false,     // легаси/неизвестное считаем «из ЗН»
    order_price: num(w.order_price, 0),
  };
}

// Пустая строка «сверх заказ-наряда».
export function newWork(patch = {}) {
  return normalizeWork({ from_order: false, qty: 1, price: 0, ...patch });
}

// Сид/пересид списка работ из заказ-наряда.
//   job, docs — как у buildCosting (docs = api.orderDocuments.listByJob(id,'order'));
//   prevWorks — то, что уже введено (job.costing.works).
//
// Что сохраняется при пересиде: id, реальная цена и назначенный мастер — они
// переносятся на одноимённую работу через FIFO-очередь (две строки с одинаковым
// названием сохраняют СВОИ разные цены, а не схлопываются на последнюю). Ровно тот
// же приём, что переносит закупочные цены запчастей в buildCosting.
// Работы, добавленные вручную (from_order: false), не теряются — они дописываются
// в конец как есть.
export function buildWorks(job = {}, docs = [], prevWorks = []) {
  const src = pickCostingSource(job, docs);
  const prev = (prevWorks || []).map(normalizeWork);

  const queues = new Map();
  for (const w of prev) {
    if (!w.from_order) continue;            // ручные строки в очередь не идут
    const key = workKey(w.name);
    if (!key) continue;
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(w);
  }

  const works = (src.services || []).map((s) => {
    const key = workKey(s.name);
    const q = queues.get(key);
    const kept = q && q.length ? q.shift() : null;
    const orderPrice = num(s.price, 0);
    return normalizeWork({
      id: kept ? kept.id : uid(),           // стабильный id переживает пересид
      name: s.name || '',
      qty: num(s.qty, 1),
      // Реальная цена: уже введённая, иначе цена ЗН как подсказка (её и правят).
      price: kept ? kept.price : orderPrice,
      master_id: kept ? kept.master_id : '',
      master_name: kept ? kept.master_name : '',
      from_order: true,
      order_price: orderPrice,
    });
  });

  // Ручные работы «сверх заказ-наряда» — следом, в исходном порядке.
  for (const w of prev) if (!w.from_order) works.push(w);
  return works;
}

// Строки оплаты мастерам (job.costing.labor) — ПРОИЗВОДНОЕ от работ. Их читают
// финансы, себестоимость и кабинет мастера, поэтому пересобираем при каждом
// сохранении экрана. Ровно одна строка на мастера; имя обязательно (P&L группирует
// выплаты по имени, безымянные схлопнулись бы в «Без имени»).
export function laborFromWorks(works = []) {
  const by = new Map();
  for (const raw of works || []) {
    const w = normalizeWork(raw);
    if (!w.master_id) continue;             // не распределённые в ЗП не идут
    const cur = by.get(w.master_id) || { id: `lab-${w.master_id}`, master_id: w.master_id, name: w.master_name, amount: 0 };
    cur.amount += workSum(w);
    if (!cur.name && w.master_name) cur.name = w.master_name;
    by.set(w.master_id, cur);
  }
  // Складываем уже целые построчные суммы (workSum) — итог тоже целый.
  return [...by.values()];
}

// Итоги экрана: сколько всего, сколько распределено по мастерам, сколько повисло.
export function worksTotals(works = []) {
  const rows = (works || []).map(normalizeWork);
  const byMaster = new Map();
  let sum = 0;
  let unassigned = 0;
  for (const w of rows) {
    const s = workSum(w);
    sum += s;
    if (!w.master_id) { unassigned += s; continue; }
    const cur = byMaster.get(w.master_id) || { master_id: w.master_id, name: w.master_name || '—', count: 0, sum: 0 };
    cur.count += 1;
    cur.sum += s;
    if (w.master_name) cur.name = w.master_name;
    byMaster.set(w.master_id, cur);
  }
  return {
    sum: round2(sum),
    assigned: round2(sum - unassigned),
    unassigned: round2(unassigned),
    byMaster: [...byMaster.values()]
      .map((m) => ({ ...m, sum: round2(m.sum) }))
      .sort((a, b) => b.sum - a.sum),
  };
}

function pad2(x) {
  return String(x).padStart(2, '0');
}

// 'YYYY-MM-DD' по локальному времени — формат дат документов (formatDocDate).
export function todayInput(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Снимки печатных листов «Наряд-задание» — по листу на мастера.
// Не распределённые работы в печать НЕ идут: наряд подписывает конкретный человек.
// Лист внутренний: ни страховых цен, ни юр-блоков, ни маржи.
export function buildMasterOrderSheets(job = {}, works = [], company = {}, nowMs = Date.now()) {
  const order = new Map();                  // порядок листов = порядок работ на экране
  for (const raw of works || []) {
    const w = normalizeWork(raw);
    if (!w.master_id) continue;
    const cur = order.get(w.master_id) || { master_id: w.master_id, master_name: w.master_name || '—', rows: [], subtotal: 0 };
    cur.rows.push({ id: w.id, name: w.name, qty: w.qty, price: w.price, sum: workSum(w) });
    cur.subtotal += workSum(w);
    if (w.master_name) cur.master_name = w.master_name;
    order.set(w.master_id, cur);
  }
  const c = company || {};
  return [...order.values()].map((sheet) => ({
    ...sheet,
    subtotal: round2(sheet.subtotal),
    doc_date: todayInput(nowMs),
    doc_number: job.order_number || '',
    company: {
      name: c.name || '',
      inn: c.inn || '',
      ogrn: c.ogrn || '',
      address: c.address || '',
      phone: c.phone || '',
      director: c.director || '',
    },
    vehicle: {
      car_model: job.car_model || '',
      plate_number: job.plate_number || '',
      vin: job.vin || '',
    },
  }));
}
