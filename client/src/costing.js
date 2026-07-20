import { uid } from './orderDoc.js';
import { STREAM_CLIENT, itemsForStream, orderMatchesStream, claimsOf } from './billing.js';

// Pure helpers for the себестоимость (repair cost / profit) calculation.
// No React, no Firestore here — same style as orderDoc.js.
//
// The costing is INTERNAL (never printed on client documents). It is stored on
// the job itself (job.costing) as a self-contained snapshot, seeded from the
// latest заказ-наряд so parts/works are never typed twice. Once seeded it is
// independent — «Обновить из заказ-наряда» re-seeds it on demand, keeping any
// purchase prices already entered (matched by code/name).

export const DEFAULT_MATERIALS_PCT = 15; // материалы по умолчанию = % от работ
export const DEFAULT_OVERHEAD_PCT = 0;   // накладные по умолчанию = % от выручки

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Sale-side sum of a works/parts array (qty × price).
function sumSale(arr) {
  return (arr || []).reduce((s, it) => s + num(it.qty, 0) * num(it.price, 0), 0);
}

// Pick the works/parts to base the costing on: prefer the LAST issued заказ-наряд
// (curated list the shop actually bills), fall back to the car's own imported data.
//
// Страховая машина биллится НЕСКОЛЬКИМИ потоками: по одному на каждый убыток
// (страховая может завести по машине два разных дела) плюс допродажи клиента.
// Себестоимость пока считаем «как одна машина»: складываем ВСЕ потоки — раздельная
// экономика по убытку появится отдельным этапом (job.costings).
//
// ВАЖНО, ПОЧЕМУ ЭТО НЕ ПРОСТО filter().flatMap(): переиздание заказ-наряда СОЗДАЁТ
// ВТОРОЙ документ (DocEditor.save/OrderDocumentEditor зовут orderDocuments.update
// только когда документ открыт из истории, иначе create). Слепое суммирование всех
// ЗН потока удвоило бы выручку. Поэтому: сгруппировать по потоку → взять НОВЕЙШИЙ
// в каждом (docs приходят newest-first из listByJob) → сложить.
const hasLines = (d) => d && (((d.services || []).length) || ((d.parts || []).length));

export function pickCostingSource(job = {}, docs = []) {
  const orders = (docs || []).filter((d) => d.type === 'order');

  if (job.payment_type === 'insurance') {
    // Потоки машины: каждый убыток + допродажи. У старых машин claimsOf вернёт один
    // убыток №1 (id 'insurance'), собранный из плоских полей → поведение как раньше.
    const streamIds = [...claimsOf(job).map((c) => c.id), STREAM_CLIENT];
    const services = [];
    const parts = [];
    let discount = 0;
    let anyOrder = false;
    let sourceNumber = '';

    for (const sid of streamIds) {
      // Новейший ЗН ЭТОГО потока (find по newest-first списку), иначе — позиции
      // карточки, отфильтрованные по потоку. Оба потока сопоставляем ОДНИМ правилом:
      // у 'insurance' есть легаси-люк для старых ЗН без поля recipient.
      const order = orders.find((d) => orderMatchesStream(d, sid) && hasLines(d));
      services.push(...(order ? (order.services || []) : itemsForStream(job.services, sid)));
      parts.push(...(order ? (order.parts || []) : itemsForStream(job.parts, sid)));
      // Скидка карточки относится к убытку №1 (там же лежит job.discount).
      const fallbackDiscount = sid === STREAM_CLIENT ? 0 : num(claimsOf(job).find((c) => c.id === sid)?.discount, 0);
      discount += num(order ? order.discount : fallbackDiscount, 0);
      if (order) {
        anyOrder = true;
        if (!sourceNumber && sid !== STREAM_CLIENT) sourceNumber = order.doc_number || '';
      }
    }

    return {
      services,
      parts,
      discount,
      source: anyOrder ? 'order' : 'job',
      source_number: sourceNumber,
    };
  }

  const lastOrder = orders.find(hasLines);
  if (lastOrder) {
    return {
      services: lastOrder.services || [],
      parts: lastOrder.parts || [],
      discount: num(lastOrder.discount, 0),
      source: 'order',
      source_number: lastOrder.doc_number || '',
    };
  }
  return {
    services: job.services || [],
    parts: job.parts || [],
    discount: num(job.discount, 0),
    source: 'job',
    source_number: '',
  };
}

// Labour rows seeded from the car's route: one row per assigned master, amount 0.
function seedLabor(job = {}, masters = []) {
  const mById = new Map((masters || []).map((m) => [m.id, m]));
  const seen = new Set();
  const rows = [];
  for (const st of job.stages || []) {
    const id = st.master_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id: uid(), master_id: id, name: mById.get(id)?.name || '', amount: 0 });
  }
  return rows;
}

// Build a fresh costing snapshot from the job + latest заказ-наряд + masters.
// `prev` (an existing job.costing) lets us keep purchase prices / labour already
// entered when re-seeding from an updated заказ-наряд.
export function buildCosting(job = {}, docs = [], masters = [], prev = null) {
  const src = pickCostingSource(job, docs);

  // Previously-entered purchase prices, keyed by code (else name). Parts that share a
  // key — a blank code with an identical name, or a repeated article — are matched
  // positionally through a FIFO queue, so several same-named rows keep their distinct
  // costs instead of every one collapsing onto the last-seen value.
  const prevCostQueues = new Map();
  for (const p of prev?.parts || []) {
    const key = (p.code || '').trim() || (p.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!prevCostQueues.has(key)) prevCostQueues.set(key, []);
    prevCostQueues.get(key).push(num(p.cost, 0));
  }

  const parts = (src.parts || []).map((p) => {
    const key = (p.code || '').trim() || (p.name || '').trim().toLowerCase();
    const q = prevCostQueues.get(key);
    const cost = q && q.length ? q.shift() : 0;     // закупочная цена (вводит пользователь)
    return {
      id: uid(),
      code: p.code || '',
      name: p.name || '',
      qty: num(p.qty, 1),
      unit: p.unit || 'шт.',
      price: num(p.price, 0),                       // цена продажи (из ЗН, не редактируется)
      cost,
    };
  });

  const labor = (prev?.labor?.length ? prev.labor.map((l) => ({
    id: l.id || uid(),
    master_id: l.master_id || '',
    name: l.name || '',
    amount: num(l.amount, 0),
  })) : seedLabor(job, masters));

  return {
    source: src.source,
    source_number: src.source_number,
    services_sum: round2(sumSale(src.services)),    // сумма работ (для выручки и % материалов)
    discount: num(src.discount, 0),
    parts,
    labor,
    materials: prev ? (prev.materials ?? null) : null, // null → авто (% от работ)
    overhead: prev ? (prev.overhead ?? null) : null,   // null → авто (% от выручки)
    updated_at: prev?.updated_at || null,
  };
}

// The one calculation everyone reads. Returns revenue, a cost breakdown, profit
// and margin. `settings` supplies the auto percentages for materials/overhead.
export function computeCosting(costing = {}, settings = {}) {
  const services_sum = num(costing.services_sum, 0);
  const parts_sale = (costing.parts || []).reduce((s, p) => s + num(p.qty, 0) * num(p.price, 0), 0);
  const discount = num(costing.discount, 0);
  const revenue = Math.max(0, services_sum + parts_sale - discount);

  // Prefer the percentages frozen onto this car's costing (snapshotted at save time)
  // so changing the global setting never retroactively re-computes closed jobs. Older
  // costings that predate the snapshot fall back to the current global settings.
  const materials_pct = num(costing.materials_pct != null ? costing.materials_pct : settings.materials_pct, DEFAULT_MATERIALS_PCT);
  const overhead_pct = num(costing.overhead_pct != null ? costing.overhead_pct : settings.overhead_pct, DEFAULT_OVERHEAD_PCT);

  const parts_cost = round2((costing.parts || []).reduce((s, p) => s + num(p.qty, 0) * num(p.cost, 0), 0));
  const labor_cost = round2((costing.labor || []).reduce((s, l) => s + num(l.amount, 0), 0));

  const materials_auto = round2(services_sum * materials_pct / 100);
  const materials_cost = costing.materials != null ? round2(costing.materials) : materials_auto;

  const overhead_auto = round2(revenue * overhead_pct / 100);
  const overhead_cost = costing.overhead != null ? round2(costing.overhead) : overhead_auto;

  const cost_total = round2(parts_cost + materials_cost + labor_cost + overhead_cost);
  const profit = round2(revenue - cost_total);
  const margin_pct = revenue > 0 ? round2(profit / revenue * 100) : 0;

  return {
    services_sum: round2(services_sum),
    parts_sale: round2(parts_sale),
    discount,
    revenue: round2(revenue),
    parts_cost,
    materials_cost,
    materials_auto,
    materials_is_auto: costing.materials == null,
    labor_cost,
    overhead_cost,
    overhead_auto,
    overhead_is_auto: costing.overhead == null,
    cost_total,
    profit,
    margin_pct,
  };
}
