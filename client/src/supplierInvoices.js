// Pure helpers for «Счета поставщиков» (supplier invoices the founder pays).
// No React, no Firestore — same style as requests.js / parts.js, unit-testable.
//
// A supplier invoice groups one or more PARTS (possibly across different cars)
// that a supplier billed on one счёт. The запчастист uploads the file and the
// invoice sits «unpaid» until the учредитель marks it paid — only then do its
// parts move need/invoiced → ordered (see api.supplierInvoices.markPaid).
//
// Doc shape (collection `supplierInvoices`):
//   { id, number, supplier, amount, file_url, file_name, file_size,
//     items: [{ job_id, part_id, name, code, qty, cost }],
//     status: 'unpaid'|'paid', comment,
//     created_at, created_by, created_by_name,
//     paid_at, paid_by, paid_by_name }

export const SUPPLIER_INVOICE_STATUS = {
  unpaid: { label: 'не оплачен', tone: 'wait' },
  paid: { label: 'оплачен', tone: 'done' },
};

export function invoiceStatus(s) {
  return SUPPLIER_INVOICE_STATUS[s] || SUPPLIER_INVOICE_STATUS.unpaid;
}

const num = (v) => Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;

// Money formatting — same look as parts.money («12 500 ₽»).
export function money(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ₽`;
}

// Авто-сумма счёта из позиций: Σ(себестоимость × количество). Запчастист может
// потом поправить итог руками (доставка и пр.) — это лишь предложенное значение.
export function itemsAmount(items = []) {
  return (Array.isArray(items) ? items : []).reduce((a, it) => a + num(it.cost) * (num(it.qty) || 1), 0);
}

// Newest first, by created_at. Returns a new array (does not mutate input).
export function sortInvoicesNewest(list = []) {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => ((b && b.created_at) || 0) - ((a && a.created_at) || 0));
}

// «paid» — если явный статус 'paid' ИЛИ проставлена дата оплаты (устойчиво к
// частичной записи из бота). Всё остальное считаем неоплаченным.
export function isPaid(inv = {}) {
  return inv.status === 'paid' || !!inv.paid_at;
}

export function invoicesByPaid(list = [], paid) {
  return (Array.isArray(list) ? list : []).filter((i) => i && isPaid(i) === !!paid);
}

// Сводка для шапки: сколько неоплаченных/оплаченных и на какую сумму неоплачено.
export function countInvoices(list = []) {
  const out = { unpaid: 0, paid: 0, unpaidAmount: 0 };
  for (const i of (Array.isArray(list) ? list : [])) {
    if (!i) continue;
    if (isPaid(i)) out.paid += 1;
    else { out.unpaid += 1; out.unpaidAmount += num(i.amount); }
  }
  return out;
}

// Из выбранных на экране «Запчасти» позиций собрать items счёта. `parts` —
// плоский список { id, carId, name, code, qty, cost }, `selectedIds` — Set/массив
// id выбранных позиций, `carsById` — { [carId]: { model, plate } } для снимка
// названия машины. Снимок name/qty/cost/машины замораживается в счёт, чтобы ЛК
// учредителя показывал счёт без чтения коллекции машин (даже если позицию потом
// отредактируют).
export function buildInvoiceItems(parts = [], selectedIds = [], carsById = {}) {
  const sel = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  return (Array.isArray(parts) ? parts : [])
    .filter((p) => p && sel.has(p.id))
    .map((p) => {
      const c = carsById[p.carId || p.job_id] || {};
      return {
        job_id: p.carId || p.job_id || null,
        part_id: p.id,
        name: p.name || '',
        code: p.code || p.article || '',
        qty: num(p.qty) || 1,
        cost: num(p.cost),
        car_model: c.model || c.car_model || '',
        plate: c.plate || c.plate_number || '',
      };
    });
}

// Человеческая сводка по машинам счёта: «BMW · А123АА (2 поз.), Audi · В456ВВ (1 поз.)».
// Берёт снимок машины прямо из items (car_model/plate); carsById — необязательный
// запасной источник (если старый счёт снимок не хранил).
export function invoiceCarsSummary(inv = {}, carsById = {}) {
  const byCar = new Map(); // job_id -> { n, label }
  for (const it of (inv.items || [])) {
    const key = it.job_id || '—';
    const cur = byCar.get(key) || { n: 0, label: '' };
    cur.n += 1;
    if (!cur.label) {
      const c = carsById[key] || {};
      cur.label = [it.car_model || c.car_model || c.model, it.plate || c.plate_number || c.plate]
        .map((s) => String(s || '').trim()).filter(Boolean).join(' · ') || 'Машина';
    }
    byCar.set(key, cur);
  }
  return [...byCar.values()].map((v) => `${v.label} (${v.n} поз.)`).join(', ');
}
