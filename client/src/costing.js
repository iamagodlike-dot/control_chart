import { uid } from './orderDoc';

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
export function pickCostingSource(job = {}, docs = []) {
  const lastOrder = (docs || []).find((d) => d.type === 'order');
  if (lastOrder && ((lastOrder.services || []).length || (lastOrder.parts || []).length)) {
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

  // Map previously-entered purchase prices by a stable key (code first, then name).
  const prevCostByKey = new Map();
  for (const p of prev?.parts || []) {
    const key = (p.code || '').trim() || (p.name || '').trim().toLowerCase();
    if (key) prevCostByKey.set(key, num(p.cost, 0));
  }

  const parts = (src.parts || []).map((p) => {
    const key = (p.code || '').trim() || (p.name || '').trim().toLowerCase();
    return {
      id: uid(),
      code: p.code || '',
      name: p.name || '',
      qty: num(p.qty, 1),
      unit: p.unit || 'шт.',
      price: num(p.price, 0),                       // цена продажи (из ЗН, не редактируется)
      cost: prevCostByKey.get(key) ?? 0,            // закупочная цена (вводит пользователь)
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

  const materials_pct = num(settings.materials_pct, DEFAULT_MATERIALS_PCT);
  const overhead_pct = num(settings.overhead_pct, DEFAULT_OVERHEAD_PCT);

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
