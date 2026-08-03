'use strict';

// Себестоимость / прибыль по машине — ПОВТОРЕНИЕ формулы с сайта
// (client/src/costing.js → computeCosting). Прямой импорт ESM-модуля сайта
// невозможен (там импорты без расширений под Vite), поэтому формула скопирована.
// При изменении расчёта на сайте — синхронизировать здесь вручную.
//
// Бот только ЧИТАЕТ уже сохранённый снимок job.costing (его заполняют на сайте)
// и проценты материалов/накладных из settings/company. Ничего не пересчитывает
// «с нуля» и ничего не пишет.

const DEFAULT_MATERIALS_PCT = 15; // материалы по умолчанию = % от работ
const DEFAULT_OVERHEAD_PCT = 0;   // накладные по умолчанию = % от выручки

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Возвращает { revenue, cost_total, profit, margin_pct, … } или null, если
// у машины ещё нет заполненной себестоимости.
function computeCosting(costing, settings = {}) {
  if (!costing || typeof costing !== 'object') return null;

  const services_sum = num(costing.services_sum, 0);
  const parts_sale = (costing.parts || []).reduce((s, p) => s + num(p.qty, 0) * num(p.price, 0), 0);
  const discount = num(costing.discount, 0);
  const revenue = Math.max(0, services_sum + parts_sale - discount);

  // Проценты, «замороженные» на самой машине, важнее глобальных настроек, чтобы
  // смена настройки не пересчитывала задним числом уже закрытые машины.
  const materials_pct = num(costing.materials_pct != null ? costing.materials_pct : settings.materials_pct, DEFAULT_MATERIALS_PCT);
  const overhead_pct = num(costing.overhead_pct != null ? costing.overhead_pct : settings.overhead_pct, DEFAULT_OVERHEAD_PCT);

  const parts_cost = round2((costing.parts || []).reduce((s, p) => s + num(p.qty, 0) * num(p.cost, 0), 0));

  // Труд: если по машине расписан наряд мастерам (costing.works — реальные расценки
  // по каждой работе), считаем по нему, иначе по строкам оплаты. Один в один как
  // client/src/costing.js — иначе прибыль в боте разойдётся с сайтом.
  const works = Array.isArray(costing.works) ? costing.works : null;
  const labor_cost = works && works.length
    // Округление построчное — так же, как на сайте (masterOrder.workSum).
    ? works.reduce((s, w) => s + Math.round(num(w.qty, 1) * num(w.price, 0)), 0)
    : round2((costing.labor || []).reduce((s, l) => s + num(l.amount, 0), 0));

  const materials_cost = costing.materials != null ? round2(costing.materials) : round2(services_sum * materials_pct / 100);
  const overhead_cost = costing.overhead != null ? round2(costing.overhead) : round2(revenue * overhead_pct / 100);

  const cost_total = round2(parts_cost + materials_cost + labor_cost + overhead_cost);
  const profit = round2(revenue - cost_total);
  const margin_pct = revenue > 0 ? round2(profit / revenue * 100) : 0;

  return {
    revenue: round2(revenue),
    parts_cost,
    materials_cost,
    labor_cost,
    overhead_cost,
    cost_total,
    profit,
    margin_pct,
  };
}

module.exports = { computeCosting, DEFAULT_MATERIALS_PCT, DEFAULT_OVERHEAD_PCT };
