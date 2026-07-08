import { numberToWordsRu } from './rubleWords.js';

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

// ===== Автонумерация документов =====
// Формат: ПРЕФИКС-ГОД-NNNN (напр. ЗН-2026-0007). У каждого типа документа — своя
// годовая очередь; сам порядковый номер выдаёт атомарный счётчик в Firestore
// (см. api.counters, api.jobs.create, api.orderDocuments.create). Здесь только
// чистое форматирование — чтобы покрыть тестами без обращения к базе.
export const DOC_PREFIX = { order: 'ЗН', act: 'АКТ', invoice: 'СЧ', handover: 'ПП' };

export function pad4(n) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(4, '0');
}

export function formatDocNumber(type, year, n) {
  return `${DOC_PREFIX[type] || 'ДОК'}-${year}-${pad4(n)}`;
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

// «Согласование по запчастям» — строки для заказ-наряда и акта. Письменного
// согласия клиента в документе требуют ТОЛЬКО Б/У (used) и Замена на аналог
// (analog). Виды «под оригинал» (used_orig / analog_orig) — это внутренняя
// подготовка детали к товарному виду; в документ они НЕ выносятся (только
// предупреждение в карточке авто). Возвращает готовый текст (строки через \n),
// пустую строку — если таких запчастей нет. Требует поле p.kind у деталей.
export function partsConsentLines(parts = []) {
  const lines = [];
  for (const p of parts || []) {
    const name = String(p.name || '').trim() || 'запчасть';
    const code = String(p.code || '').trim();
    const repl = String(p.replArticle || '').trim();
    if (p.kind === 'used') {
      lines.push(`Запчасть «${name}»${code ? ` (арт. ${code})` : ''} устанавливается бывшей в употреблении (Б/У) с согласия Заказчика.`);
    } else if (p.kind === 'analog') {
      lines.push(`Оригинальная запчасть «${name}»${code ? ` (арт. ${code})` : ''} заменена на аналог${repl ? ` (арт. ${repl})` : ''} с согласия Заказчика.`);
    }
  }
  return lines;
}

export function buildPartsConsentText(parts = []) {
  return partsConsentLines(parts).join('\n');
}

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

// Payer / insurance block copied onto every document snapshot.
function insuranceFrom(job) {
  return {
    payment_type: job.payment_type || 'cash',
    insurer_name: job.insurer_name || '',
    claim_number: job.claim_number || '',
    policy_type: job.policy_type || '',
  };
}

// Build the auto-filled snapshot from the job + company settings. Every array
// item is a brand-new object with a fresh id — no shared references with `job`.
export function buildOrderSnapshot(job = {}, company = {}) {
  return {
    type: 'order',
    insurance: insuranceFrom(job),
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
      // kind/replArticle не печатаются в таблице, но нужны, чтобы пересобрать
      // блок «Согласование по запчастям» и чтобы он пережил перенос в акт.
      kind: p.kind || 'new',
      replArticle: p.replArticle || '',
    })),
    discount: num(job.discount, 0),
    prepayment: num(job.prepayment, 0),
    recommendations: job.recommendations || '',
    warranty_text: DEFAULT_WARRANTY,
    consent_text: DEFAULT_CONSENT,
    parts_consent_text: buildPartsConsentText(job.parts),
    show_recommendations: !!(job.recommendations && String(job.recommendations).trim()),
    show_warranty: true,
    show_consent: true,
    show_parts_consent: !!buildPartsConsentText(job.parts),
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

function baseHead(job, company, type) {
  return {
    type,
    insurance: insuranceFrom(job),
    job_id: job.id || null,
    // Пустой номер = «присвоить автоматически при первом сохранении» (свой счётчик
    // на тип+год, см. api.orderDocuments.create). Вручную вписанный номер сохраняется
    // как есть. Заказ-наряд — исключение (buildOrderSnapshot): печатается под номером
    // машины job.order_number.
    doc_number: '',
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
  return (arr || []).map((p) => ({ id: uid(), code: p.code || '', name: p.name || '', qty: num(p.qty, 1), unit: p.unit || 'шт.', price: num(p.price, 0), kind: p.kind || 'new', replArticle: p.replArticle || '' }));
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
  const parts = mapParts(s.parts);
  return {
    ...baseHead(job, company, 'act'),
    order_ref: s.source_number || job.order_number || '',
    services: mapServices(s.services),
    parts,
    discount: num(s.discount, 0),
    prepayment: num(s.prepayment, 0),
    recommendations: job.recommendations || '',
    act_text: DEFAULT_ACT_TEXT,
    warranty_text: DEFAULT_WARRANTY,
    // Собираем из позиций акта (kind перенесён из заказ-наряда/машины) — тот же
    // блок «Согласование по запчастям», что и в заказ-наряде.
    parts_consent_text: buildPartsConsentText(parts),
    show_act_text: true,
    show_warranty: true,
    show_recommendations: !!(job.recommendations && String(job.recommendations).trim()),
    show_parts_consent: !!buildPartsConsentText(parts),
  };
}

export function buildInvoiceSnapshot(job = {}, company = {}, seed = null) {
  const s = seed || pickSeedItems(job, []);
  const head = baseHead(job, company, 'invoice');
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
    // Предоплата переносится из заказ-наряда: в счёте печатаются строки «Предоплата»
    // и «К доплате», чтобы клиент оплатил остаток, а не всю сумму повторно. Это же
    // «к доплате» согласовано с кассой/долгом (computeCashFlow вычитает предоплату).
    prepayment: num(s.prepayment, 0),
    vat_mode: company.vat_mode === 'vat20' ? 'vat20' : 'none',
    invoice_note: DEFAULT_INVOICE_NOTE,
    show_invoice_note: true,
    show_qr: true,
    paid: false,
    paid_at: null,
  };
}

export function buildHandoverSnapshot(job = {}, company = {}) {
  return {
    ...baseHead(job, company, 'handover'),
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
  // Encode the amount actually left to pay (к доплате = total − предоплата) so the
  // client's banking app pre-fills exactly what the счёт prints as «К доплате».
  const payable = totals.due != null ? totals.due : totals.total;
  const kopecks = Math.round((payable || 0) * 100);
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
