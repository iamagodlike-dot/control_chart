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

// ===== Акт выполненных работ / Акт приёма-передачи / Счёт на оплату =====
// Same isolation guarantee as buildOrderSnapshot: deep-copied arrays, fresh ids,
// stored in the orderDocuments collection with a distinct `type`. The заказ-наряд
// (buildOrderSnapshot / OrderDocument) is left untouched.

export const DEFAULT_ACT_TEXT =
  'Работы выполнены в полном объёме, в согласованные сроки и с надлежащим качеством. ' +
  'Заказчик к объёму, качеству и срокам выполненных работ претензий не имеет. Настоящий акт ' +
  'является основанием для окончательного расчёта между сторонами.';

export const DEFAULT_HANDOVER_TEXT =
  'Транспортное средство осмотрено сторонами. Стороны подтверждают соответствие фактического ' +
  'состояния, комплектности и показаний одометра сведениям, указанным в настоящем акте. ' +
  'Настоящий акт подтверждает факт приёма-передачи транспортного средства.';

export const DEFAULT_INVOICE_NOTE =
  'Оплата настоящего счёта означает согласие с условиями оказания услуг. Счёт действителен ' +
  'к оплате в течение 5 банковских дней. Услуги/товары отпускаются по факту поступления оплаты.';

function baseHead(job, company, type, prefix) {
  return {
    type,
    job_id: job.id || null,
    doc_number: job.order_number || `${prefix}-${String(job.id || '').slice(0, 6).toUpperCase()}`,
    doc_date: todayInput(),
    company: {
      name: company.name || '', inn: company.inn || '', kpp: company.kpp || '',
      ogrn: company.ogrn || '', address: company.address || '', phone: company.phone || '',
      director: company.director || '',
    },
    customer: { name: job.client_name || '', phone: job.client_phone || '' },
    vehicle: {
      car_model: job.car_model || '', plate_number: job.plate_number || '',
      vin: job.vin || '', year: job.year || '', mileage: job.mileage || '',
    },
  };
}

function mapServices(arr) {
  return (arr || []).map((s) => ({ id: uid(), name: s.name || '', qty: num(s.qty, 1), price: num(s.price, 0) }));
}
function mapParts(arr) {
  return (arr || []).map((p) => ({ id: uid(), code: p.code || '', name: p.name || '', qty: num(p.qty, 1), unit: p.unit || 'шт.', price: num(p.price, 0) }));
}

// Seed works/parts for act & invoice from the LAST issued заказ-наряд (docs from
// api.orderDocuments.listByJob, newest-first); fall back to the car's own data.
export function pickSeedItems(job = {}, docs = []) {
  const lastOrder = (docs || []).find((d) => d.type === 'order');
  if (lastOrder && ((lastOrder.services || []).length || (lastOrder.parts || []).length)) {
    return {
      services: lastOrder.services || [], parts: lastOrder.parts || [],
      discount: num(lastOrder.discount, 0), prepayment: num(lastOrder.prepayment, 0),
      source: 'order', source_number: lastOrder.doc_number || '',
    };
  }
  return {
    services: job.services || [], parts: job.parts || [],
    discount: num(job.discount, 0), prepayment: num(job.prepayment, 0),
    source: 'job', source_number: '',
  };
}

export function buildActSnapshot(job = {}, company = {}, seed = null) {
  const s = seed || pickSeedItems(job, []);
  return {
    ...baseHead(job, company, 'act', 'АКТ'),
    order_ref: s.source_number || job.order_number || '',
    services: mapServices(s.services),
    parts: mapParts(s.parts),
    discount: num(s.discount, 0),
    prepayment: num(s.prepayment, 0),
    recommendations: job.recommendations || '',
    act_text: DEFAULT_ACT_TEXT,
    warranty_text: DEFAULT_WARRANTY,
    show_act_text: true,
    show_warranty: true,
    show_recommendations: !!(job.recommendations && String(job.recommendations).trim()),
  };
}

export function buildInvoiceSnapshot(job = {}, company = {}, seed = null) {
  const s = seed || pickSeedItems(job, []);
  const head = baseHead(job, company, 'invoice', 'СЧ');
  head.company.bank = {
    bank_name: company.bank_name || '', bik: company.bik || '',
    account: company.account || '', corr_account: company.corr_account || '',
  };
  return {
    ...head,
    order_ref: s.source_number || job.order_number || '',
    services: mapServices(s.services),
    parts: mapParts(s.parts),
    discount: num(s.discount, 0),
    prepayment: 0, // счёт — это счёт на полную сумму; предоплата из заказ-наряда сюда не переносится
    vat_mode: company.vat_mode === 'vat20' ? 'vat20' : 'none',
    invoice_note: DEFAULT_INVOICE_NOTE,
    show_invoice_note: true,
    show_qr: true,
  };
}

export function buildHandoverSnapshot(job = {}, company = {}) {
  return {
    ...baseHead(job, company, 'handover', 'ПП'),
    condition: {
      mileage_in: job.mileage || '', equipment: job.equipment || '', condition_in: job.condition_in || '',
      mileage_out: job.mileage_out || '', condition_out: job.condition_out || '',
    },
    handover_text: DEFAULT_HANDOVER_TEXT,
    show_handover_text: true,
    show_intake: true,
    show_issue: true,
  };
}

// Totals with VAT for the счёт. VAT 20% is treated as INCLUDED in the total
// ("в том числе НДС"), which is the usual case when prices already include tax.
export function computeDocTotals(snapshot = {}) {
  const base = computeOrderTotals(snapshot);
  const vat_mode = snapshot.vat_mode === 'vat20' ? 'vat20' : 'none';
  const vat_amount = vat_mode === 'vat20' ? Math.round((base.total * 20 / 120) * 100) / 100 : 0;
  return { ...base, vat_mode, vat_amount };
}

// Standard Russian payment QR (ГОСТ Р 56042-2014) — scannable in banking apps.
export function buildPaymentQrString(snapshot = {}) {
  const c = snapshot.company || {};
  const bank = c.bank || {};
  const totals = computeDocTotals(snapshot);
  const fields = [];
  const add = (k, v) => { if (v) fields.push(`${k}=${String(v).replace(/[|=]/g, ' ').trim()}`); };
  add('Name', c.name);
  add('PersonalAcc', bank.account);
  add('BankName', bank.bank_name);
  add('BIC', bank.bik);
  add('CorrespAcc', bank.corr_account);
  add('PayeeINN', c.inn);
  add('KPP', c.kpp);
  // The счёт bills the full total; the QR must encode exactly what is printed.
  const kopecks = Math.round((totals.total || 0) * 100);
  if (kopecks > 0) add('Sum', String(kopecks));
  add('Purpose', `Оплата по счёту № ${snapshot.doc_number || ''} от ${formatDocDate(snapshot.doc_date)}`);
  return `ST00012|${fields.join('|')}`;
}

// Does this payment QR have enough to be scannable? (requisites filled)
export function qrIsComplete(snapshot = {}) {
  const c = snapshot.company || {};
  const bank = c.bank || {};
  return !!(c.name && c.inn && bank.account && bank.bik && bank.bank_name && bank.corr_account);
}
