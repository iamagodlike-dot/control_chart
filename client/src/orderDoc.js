import { numberToWordsRu } from './rubleWords';

// Pure helpers for the заказ-наряд document. No React, no Firestore here.
// The whole point: buildOrderSnapshot() makes a fully self-contained COPY of
// the job's data (fresh objects, fresh ids), so editing the document can never
// reach back into the job / warehouse / gantt.

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function money(v) {
  return `${(Number(v) || 0).toLocaleString('ru-RU')} ₽`;
}

export function lineTotal(item) {
  return num(item.qty, 0) * num(item.price, 0);
}

export const DEFAULT_WARRANTY =
  'Гарантия на выполненные работы — 6 месяцев, на кузовные и окрасочные работы — ' +
  '12 месяцев с даты выдачи ТС. Гарантия не распространяется на детали и материалы, ' +
  'предоставленные Заказчиком, а также на повреждения, возникшие вследствие эксплуатации ' +
  'с нарушением рекомендаций, ДТП или естественного износа.';

export const DEFAULT_CONSENT =
  'Заказчик ознакомлен и согласен с перечнем, стоимостью и сроками работ, указанными ' +
  'в настоящем заказ-наряде. Заказчик уведомлён, что в ходе выполнения работ может ' +
  'потребоваться проведение дополнительных работ и замена дополнительных запчастей, о чём ' +
  'Исполнитель обязуется предварительно проинформировать Заказчика. Заказчик подтверждает ' +
  'передачу транспортного средства в ремонт и достоверность указанных сведений. Настоящий ' +
  'заказ-наряд является основанием для выполнения работ и расчётов между сторонами; после ' +
  'подписания сторонами имеет силу договора.';

function pad2(x) {
  return String(x).padStart(2, '0');
}

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoToDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// "2026-07-01" -> "01.07.2026"
export function formatDocDate(input) {
  if (!input) return '—';
  const [y, m, d] = String(input).split('-');
  if (!y || !m || !d) return input;
  return `${d}.${m}.${y}`;
}

// Build the auto-filled snapshot from the job + company settings. Every array
// item is a brand-new object with a fresh id — no shared references with `job`.
export function buildOrderSnapshot(job = {}, company = {}) {
  return {
    type: 'order',
    job_id: job.id || null,
    doc_number: job.order_number || `ЗН-${String(job.id || '').slice(0, 6).toUpperCase()}`,
    doc_date: todayInput(),
    planned_ready_at: isoToDateInput(job.deadline) || isoToDateInput(job.expected_at) || '',
    company: {
      name: company.name || '',
      inn: company.inn || '',
      ogrn: company.ogrn || '',
      address: company.address || '',
      phone: company.phone || '',
      director: company.director || '',
    },
    customer: {
      name: job.client_name || '',
      phone: job.client_phone || '',
    },
    vehicle: {
      car_model: job.car_model || '',
      plate_number: job.plate_number || '',
      vin: job.vin || '',
      year: job.year || '',
      mileage: job.mileage || '',
    },
    reason: job.reason || '',
    services: (job.services || []).map((s) => ({
      id: uid(),
      name: s.name || '',
      qty: num(s.qty, 1),
      price: num(s.price, 0),
    })),
    parts: (job.parts || []).map((p) => ({
      id: uid(),
      code: p.code || '',
      name: p.name || '',
      qty: num(p.qty, 1),
      unit: p.unit || 'шт.',
      price: num(p.price, 0),
    })),
    discount: num(job.discount, 0),
    prepayment: num(job.prepayment, 0),
    recommendations: job.recommendations || '',
    warranty_text: DEFAULT_WARRANTY,
    consent_text: DEFAULT_CONSENT,
    show_recommendations: !!(job.recommendations && String(job.recommendations).trim()),
    show_warranty: true,
    show_consent: true,
  };
}

export function computeOrderTotals(snapshot = {}) {
  const sum = (arr) => (arr || []).reduce((s, it) => s + num(it.qty, 0) * num(it.price, 0), 0);
  const services_sum = sum(snapshot.services);
  const parts_sum = sum(snapshot.parts);
  const subtotal = services_sum + parts_sum;
  const discount = num(snapshot.discount, 0);
  const total = Math.max(0, subtotal - discount);
  const prepayment = num(snapshot.prepayment, 0);
  const due = Math.max(0, total - prepayment);
  return { services_sum, parts_sum, subtotal, discount, total, prepayment, due, total_words: numberToWordsRu(total) };
}
