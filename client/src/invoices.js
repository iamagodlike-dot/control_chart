// Какие счета машины участвуют в деньгах.
//
// ПРОБЛЕМА. Счёт — это документ (orderDocuments, type 'invoice'), и на практике по
// одному и тому же ремонту их выпускают несколько: перепечатали, поправили сумму,
// сделали копию. Раньше каждый экран складывал ВСЕ счета машины — и один ремонт
// считался дважды: и в «Оплачено», и в долге, и в кассовой ленте. Отметка оплаты
// тоже ставилась разом на все счета, то есть подтверждала деньги, которых не было.
//
// ПРАВИЛО. Внутри одного потока биллинга (убыток / допродажи клиента, см. billing.js)
// в деньгах участвует ОДИН счёт — последний выставленный. Более ранние считаются его
// предыдущими версиями. Разные убытки одной машины и допродажи клиента — разные
// потоки: их счета складываются, это действительно разные деньги.
//
// ИСКЛЮЧЕНИЯ задаёт поле `billing_role` самого счёта (ставится в окне «Документы»):
//   'extra' — счёт выставлен на ЧАСТЬ суммы (аванс / остаток): участвует всегда и
//             складывается с основным;
//   'void'  — дубль или аннулированный: не участвует никогда.
// Пустое поле = 'auto' = обычный счёт. Весь легаси попадает сюда, миграции не нужно.
//
// Модуль зависит только от billing.js (тот — ни от чего), поэтому его одинаково
// импортируют и экраны, и чистый finance.js.

import { STREAM_ALL, STREAM_INSURANCE } from './billing.js';

export const ROLE_AUTO = 'auto';
export const ROLE_EXTRA = 'extra';
export const ROLE_VOID = 'void';

export function invoiceRole(inv) {
  const r = inv && inv.billing_role;
  return r === ROLE_EXTRA || r === ROLE_VOID ? r : ROLE_AUTO;
}

// Поток счёта. Легаси-счета сохранялись без recipient, а у обычной (не страховой)
// машины он 'all' — и то, и другое означает «основной комплект документов», то есть
// тот же поток, что 'insurance'. Тот же люк, что orderMatchesStream в billing.js:
// без него старый счёт и новый по тому же убытку легли бы в разные группы и снова
// сложились — ровно тот случай, ради которого всё и затевалось.
export function invoiceStream(inv) {
  const r = inv && inv.recipient;
  return !r || r === STREAM_ALL ? STREAM_INSURANCE : String(r);
}

// Группа = один поток биллинга одной машины. Внутри неё и выбирается единственный счёт.
function groupKey(inv) {
  return `${inv.job_id}|${invoiceStream(inv)}`;
}

// «Позже выставленный». created_at — момент сохранения в базе. У счёта без него
// (ручная правка базы, импорт) берём дату документа, иначе он всегда проигрывал бы
// в свежести и молча выпал бы из денег.
function issuedAt(inv) {
  const t = Number(inv && inv.created_at);
  if (Number.isFinite(t) && t > 0) return t;
  const d = Date.parse((inv && inv.doc_date) || '');
  return Number.isFinite(d) ? d : 0;
}

// Позже ли `a` выставлен, чем `b`. При равных датах (импорт одним заходом) решает id —
// нужен любой устойчивый признак, иначе порядок счетов в списке менял бы сумму.
function isLater(a, b) {
  const ta = issuedAt(a);
  const tb = issuedAt(b);
  return ta === tb ? String(a.id) > String(b.id) : ta > tb;
}

// id счетов, участвующих в деньгах.
export function countedInvoiceIds(invoices = []) {
  const main = new Map(); // groupKey -> самый свежий обычный счёт группы
  const ids = new Set();
  for (const inv of invoices || []) {
    if (!inv) continue;
    const role = invoiceRole(inv);
    if (role === ROLE_VOID) continue;
    // Счёт без машины (самостоятельный) сравнивать не с чем — считаем как есть.
    if (role === ROLE_EXTRA || !inv.job_id) { ids.add(inv.id); continue; }
    const k = groupKey(inv);
    const cur = main.get(k);
    if (!cur || isLater(inv, cur)) main.set(k, inv);
  }
  for (const inv of main.values()) ids.add(inv.id);
  return ids;
}

// Те же счета, но списком (в исходном порядке).
export function countedInvoices(invoices = []) {
  const ids = countedInvoiceIds(invoices);
  return (invoices || []).filter((i) => i && ids.has(i.id));
}

// Роль счёта в переданном списке — для подписи в интерфейсе.
// 'main' — учитывается, 'extra' — доп. счёт (тоже учитывается), 'replaced' — заменён
// более свежим, 'void' — помечен «не учитывать».
export function invoiceStatus(inv, countedIds) {
  const role = invoiceRole(inv);
  if (role === ROLE_VOID) return 'void';
  if (role === ROLE_EXTRA) return 'extra';
  return countedIds && countedIds.has(inv && inv.id) ? 'main' : 'replaced';
}

export const INVOICE_STATUS_LABEL = {
  main: 'Учитывается',
  extra: 'Доп. счёт',
  replaced: 'Предыдущая версия',
  void: 'Не учитывается',
};

export const INVOICE_STATUS_HINT = {
  main: 'Этот счёт участвует в деньгах: сумма машины, долг, лента и отметка оплаты — по нему.',
  extra: 'Часть суммы: складывается с основным счётом.',
  replaced: 'Заменён более поздним счётом — в деньгах не участвует.',
  void: 'Помечен как дубль / аннулированный — в деньгах не участвует.',
};

// Подпись под отметкой оплаты: какой счёт считается и сколько версий отброшено.
// Пустая строка — когда счёт один и объяснять нечего.
export function countedSummary(invoices = []) {
  const list = (invoices || []).filter(Boolean);
  if (list.length < 2) return '';
  const counted = countedInvoices(list);
  const skipped = list.length - counted.length;
  if (!skipped) return '';
  const main = counted.find((i) => invoiceRole(i) !== ROLE_EXTRA) || counted[0];
  const who = main ? `счёт${main.doc_number ? ` №${main.doc_number}` : ''}` : 'ни один счёт';
  const extras = counted.length - (main ? 1 : 0);
  return `Считается ${who}${extras > 0 ? ` и ещё ${extras} доп.` : ''}`
    + ` · не учитывается: ${skipped}`;
}
