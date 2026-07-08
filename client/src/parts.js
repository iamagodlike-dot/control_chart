// Pure helpers + view-model for the «Запчасти» (parts procurement) screen.
// No React, no Firestore here — same style as costing.js. Parts live inside
// each job (job.parts[]); paint inside job.paint. This module is a faithful
// port of buildPartsVM from the design reference (Диспетчерская.dc.html) and
// encodes the two business rules (BACKEND_SPEC.md):
//
//   §13   need → ordered requires a supplier AND a cost — see partNeedsOrderInfo().
//   §12.2 rentability / margin count ONLY positions with cost > 0 (a priced part
//         with no purchase cost would fake 100% margin). Such positions are
//         excluded from the base but flagged with a «N без себестоимости» badge.
//         Deliberate — do NOT "simplify" back to counting every position.

// ---- enums / meta (colors are CSS vars defined on the screen wrapper) --------
export const partStatusMeta = [
  { id: 'need', label: 'Требуется', color: 'var(--delay)', pr: 0 },
  { id: 'ordered', label: 'Заказано', color: 'var(--wait)', pr: 1 },
  { id: 'in', label: 'На складе', color: 'var(--done)', pr: 2 },
  { id: 'issued', label: 'Изъято', color: 'var(--progress)', pr: 3 },
];
export const partKindMeta = [
  { id: 'new', label: 'Новое', color: 'var(--done)' },
  { id: 'used', label: 'Б/У', color: 'var(--planned)' },
  { id: 'used_orig', label: 'Б/У под ориг.', color: 'var(--wait)' },
  { id: 'analog', label: 'Замена', color: 'var(--brand)' },
  { id: 'analog_orig', label: 'Аналог под ориг.', color: 'var(--wait)' },
];
export const paintStatusMeta = [
  { id: 'need', label: 'Требуется', color: 'var(--delay)', pr: 0 },
  { id: 'matching', label: 'Подбор цвета', color: 'var(--wait)', pr: 1 },
  { id: 'mixing', label: 'Замешивается', color: 'var(--progress)', pr: 2 },
  { id: 'ready', label: 'Готова', color: 'var(--done)', pr: 3 },
  { id: 'applied', label: 'Нанесена', color: 'var(--text3)', pr: 4 },
];

export const PART_STATUS = partStatusMeta; // back-compat alias
export const STATUS_BY_ID = Object.fromEntries(partStatusMeta.map((s) => [s.id, s]));
export const psMeta = (id) => partStatusMeta.find((s) => s.id === id) || partStatusMeta[0];
export const pkMeta = (id) => partKindMeta.find((k) => k.id === id) || partKindMeta[0];
export const paMeta = (id) => paintStatusMeta.find((s) => s.id === id) || paintStatusMeta[0];

// Color threshold for rentability (presentation only, spec §12.4). Default 40%.
export const RENTAB_TARGET = 40;

export const num = (v) => Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
export const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ₽`;
export const fmt = money;

export function rentColor(pct, target = RENTAB_TARGET) {
  if (pct < 0) return 'var(--delay)';
  if (pct < target) return 'var(--wait)';
  return 'var(--done)';
}
export function kindColor(km, flagOrig = true) {
  if (!flagOrig && km.id === 'used_orig') return 'var(--planned)';
  if (!flagOrig && km.id === 'analog_orig') return 'var(--brand)';
  return km.color;
}

// "дд.мм" → Date in `year` (default current), for overdue detection.
export function parseDay(d, year) {
  if (!d) return null;
  const p = String(d).split(/[.,/]/);
  if (p.length < 2) return null;
  const y = year ?? new Date().getFullYear();
  return new Date(y, parseInt(p[1], 10) - 1, parseInt(p[0], 10));
}
export const parseEta = parseDay;

// Stable id for a part. Parts live inside job.parts[]; their id is the ONLY key
// used to delete/save a single position (api.jobs.removePart/savePart) and to
// dirty-guard live snapshots. It MUST be persisted with the part — an id minted
// on the client at render time changes on every snapshot and never matches the
// stored part, so delete/edit silently no-op. See withPartIds / ensurePartIds.
export function genPartId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Give every part in an array a stable id WITHOUT touching any other field
// (unit/price from an Audatex import are preserved). Idempotent — a part that
// already has an id is returned untouched. Run at every job write so the stored
// array and the on-screen rows always agree on ids.
export function withPartIds(parts) {
  if (!Array.isArray(parts)) return parts;
  return parts.map((p) => (p && typeof p === 'object' && !p.id ? { ...p, id: genPartId() } : p));
}

export function normalizePart(p = {}) {
  return {
    id: p.id || genPartId(),
    name: p.name || '',
    code: p.code || '',            // артикул — kept as `code` (existing field)
    replArticle: p.replArticle || '',
    qty: p.qty ?? 1,
    supplier: p.supplier || '',
    cost: p.cost ?? 0,             // себестоимость за шт
    price: p.price ?? 0,           // цена по заказ-наряду за шт
    status: p.status || 'need',
    kind: p.kind || 'new',
    orderedAt: p.orderedAt || '',
    eta: p.eta || '',
  };
}

// §13 — a part cannot move to «Заказано» until it has BOTH supplier and cost>0.
export function partNeedsOrderInfo(p = {}) {
  return !(p.supplier && String(p.supplier).trim()) || !(num(p.cost) > 0);
}

// §12.1 — per-line rentability. Defined ONLY when both cost and price are set.
export function partRentab(p = {}) {
  const cost = num(p.cost);
  const price = num(p.price);
  if (!(cost > 0) || !(price > 0)) return { has: false, pct: 0 };
  return { has: true, pct: Math.round(((price - cost) / price) * 100) };
}

// Money model for a set of parts (one car group or the whole visible list).
// Margin & rentability use ONLY costed positions (cost>0), per §12.2.
// `discount` — единая скидка заказа, отнесённая на запчасти: размазывается по
// ВСЕЙ выручке (totalOrder), в маржу берётся доля, приходящаяся на costed-базу.
export function partsFin(parts = [], paintCost = 0, discount = 0) {
  const list = parts || [];
  const totalCost = list.reduce((a, p) => a + num(p.cost) * num(p.qty), 0);
  const totalOrder = list.reduce((a, p) => a + num(p.price) * num(p.qty), 0);
  const costed = list.filter((p) => num(p.cost) > 0);
  const rentBase = costed.reduce((a, p) => a + num(p.price) * num(p.qty), 0);
  const rentCost = costed.reduce((a, p) => a + num(p.cost) * num(p.qty), 0) + (paintCost > 0 ? paintCost : 0);
  const margin = rentBase - rentCost;
  const rentab = rentBase > 0 ? Math.round((margin / rentBase) * 100) : null;
  const discountApplied = (num(discount) > 0 && totalOrder > 0) ? (num(discount) * rentBase / totalOrder) : 0;
  const netMargin = margin - discountApplied;
  const netRentab = rentBase > 0 ? Math.round((netMargin / rentBase) * 100) : null;
  const missingCost = list.filter((p) => !(num(p.cost) > 0) && p.status !== 'need').length;
  return { totalCost, totalOrder, rentBase, rentCost, margin, rentab, discountApplied, netMargin, netRentab, costedCount: costed.length, missingCost };
}

// ---- style builders (mirror the reference inline styles) ---------------------
const chipStyle = (color, on) => (on
  ? { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 13px', borderRadius: '9px', cursor: 'pointer', fontWeight: 700,
      border: '1px solid ' + color, background: color, color: '#0a0e14',
      boxShadow: '0 0 0 3px color-mix(in srgb,' + color + ' 30%,transparent), 0 5px 16px -5px color-mix(in srgb,' + color + ' 65%,transparent)' }
  : { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 13px', borderRadius: '9px', cursor: 'pointer', fontWeight: 600,
      border: '1px solid color-mix(in srgb,' + color + ' 26%,transparent)', background: 'var(--panel)', color });

const advStyle = (color) => ({ width: '32px', height: '34px', borderRadius: '8px', border: '1px solid ' + color, background: 'color-mix(in srgb,' + color + ' 14%,transparent)', color, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: '0 0 auto' });

// Faithful port of buildPartsVM. Inputs are plain data; handlers are wired by
// the React component using row.id / group.carId (VM stays pure/testable).
//   parts:  [{ id, carId, name, article|code, replArticle, qty, supplier, cost, price, status, kind, orderedAt, eta }]
//   cars:   { [carId]: { model, plate, num, client } }
//   paint:  { [carId]: { code, type, volume, status, cost } }
//   cells:  { [cellId]: { plate, orderNum, parts:[{qty}] } }
// `frozenOrder` («замороженный порядок»): пока экран «Запчасти» открыт,
// строки и карточки держат позицию, снятую при первой смене статуса, и НЕ
// пересортировываются от смены статусов. Форма: { cars:[carId…], parts:{ [carId]:[partId…] } }
// или null → канонический сорт (группы по минимальному приоритету статуса, позиции
// внутри — по приоритету статуса, затем по названию). `flashId` — id только что
// изменённой позиции для лёгкой подсветки на ~5 с.
export function buildPartsVM({ parts = [], cars = {}, paint = {}, cells = {}, filter = 'all', search = '', today = new Date(), rentabTarget = RENTAB_TARGET, flagOrigParts = true, frozenOrder = null, flashId = null } = {}) {
  const t0 = new Date(today); t0.setHours(0, 0, 0, 0);
  const year = t0.getFullYear();
  const q = String(search).trim().toLowerCase();

  // normalize article field name (real data uses `code`, reference uses `article`)
  const P = parts.map((p) => ({ ...p, article: p.article ?? p.code ?? '' }));

  let list = P.slice();
  if (filter === 'overdue') list = list.filter((p) => p.status === 'ordered' && parseDay(p.eta, year) && parseDay(p.eta, year) < t0);
  else if (filter !== 'all') list = list.filter((p) => p.status === filter);
  if (q) list = list.filter((p) => { const c = cars[p.carId] || {}; return [p.name, p.article, p.supplier, c.model, c.plate].some((v) => String(v || '').toLowerCase().includes(q)); });

  const counts = { need: 0, ordered: 0, in: 0, issued: 0 };
  P.forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });

  // Полная выручка по ЗН каждой машины (ВСЕ её позиции, до фильтра). Это база,
  // по которой единая скидка заказа (cars[cid].discount, §авто) размазывается на
  // запчасти: в маржу попадает лишь доля скидки, приходящаяся на позиции с
  // введённой себестоимостью — иначе незаполненные закупки давали бы ложный минус.
  const fullPartsOrderByCar = {};
  P.forEach((p) => { fullPartsOrderByCar[p.carId] = (fullPartsOrderByCar[p.carId] || 0) + num(p.price) * num(p.qty); });

  const scopeFiltered = (filter !== 'all' || !!q);
  const carsInList = {}; list.forEach((p) => { carsInList[p.carId] = true; });
  const totalCost = list.reduce((a, p) => a + num(p.cost) * num(p.qty), 0);
  const totalOrder = list.reduce((a, p) => a + num(p.price) * num(p.qty), 0);
  const missingCost = list.filter((p) => !num(p.cost) && p.status !== 'need').length;
  const actionNeeded = list.filter((p) => p.status === 'need' || p.status === 'ordered').length;

  const costedParts = list.filter((p) => num(p.cost) > 0);
  const rentBase = costedParts.reduce((a, p) => a + num(p.price) * num(p.qty), 0);
  const rentPaintCost = Object.keys(paint).reduce((a, cid) => a + ((carsInList[cid] && num(paint[cid].cost) > 0) ? num(paint[cid].cost) : 0), 0);
  const rentCost = costedParts.reduce((a, p) => a + num(p.cost) * num(p.qty), 0) + rentPaintCost;
  const totalMargin = rentBase - rentCost;
  const rentab = rentBase > 0 ? Math.round((totalMargin / rentBase) * 100) : 0;

  const scopeLabel = (scopeFiltered ? 'по фильтру' : 'по всем') + ' · ' + list.length + ' поз.';
  const scopeStyle = { alignSelf: 'center', marginLeft: '22px', display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 11px', borderRadius: '8px', whiteSpace: 'nowrap',
    border: '1px solid ' + (scopeFiltered ? 'color-mix(in srgb,var(--brand) 45%,transparent)' : 'var(--line2)'),
    background: scopeFiltered ? 'color-mix(in srgb,var(--brand) 12%,transparent)' : 'var(--panel)',
    color: scopeFiltered ? 'var(--brand)' : 'var(--text3)' };

  const searchStyle = { width: '100%', height: '40px', padding: '0 12px 0 36px', borderRadius: '10px', color: 'var(--text)', fontFamily: "'Manrope'", fontSize: '13px', outline: 'none', boxSizing: 'border-box',
    border: '1px solid ' + (q ? 'var(--brand)' : 'var(--line2)'),
    background: q ? 'color-mix(in srgb,var(--brand) 9%,var(--panel))' : 'var(--panel)' };

  const statusChips = partStatusMeta.map((s) => { const on = filter === s.id; return { id: s.id, label: s.label, count: counts[s.id] || 0, active: on, style: chipStyle(s.color, on), dotStyle: { width: '8px', height: '8px', borderRadius: '2px', background: on ? '#0a0e14' : s.color } }; });
  const overdueCount = P.filter((p) => p.status === 'ordered' && parseDay(p.eta, year) && parseDay(p.eta, year) < t0).length;
  const overdueChip = { count: overdueCount, active: filter === 'overdue', style: chipStyle('var(--delay)', filter === 'overdue') };

  const byCar = {}; const order = [];
  list.forEach((p) => { if (!byCar[p.carId]) { byCar[p.carId] = []; order.push(p.carId); } byCar[p.carId].push(p); });

  // Индексы «замороженного» порядка (id → позиция). Позиции/машины, которых нет в
  // снимке (добавлены после заморозки), уходят в конец своей группы / списка машин.
  const frozenCarIdx = frozenOrder ? new Map(frozenOrder.cars.map((id, i) => [id, i])) : null;
  const frozenPartIdx = {};
  if (frozenOrder) for (const cid in frozenOrder.parts) frozenPartIdx[cid] = new Map(frozenOrder.parts[cid].map((id, i) => [id, i]));

  let totalDiscApplied = 0; // сумма скидки, фактически отнесённой на видимые costed-позиции
  const groups = order.map((cid) => {
    const c = cars[cid] || {};
    const fp = frozenPartIdx[cid];
    const items = byCar[cid].slice().sort((a, b) => {
      if (fp) {
        const ra = fp.get(a.id); const rb = fp.get(b.id);
        const na = ra === undefined; const nb = rb === undefined;
        if (na !== nb) return na ? 1 : -1;      // новая позиция (не в снимке) → в конец
        if (!na && ra !== rb) return ra - rb;   // обе в снимке → по зафиксированному порядку
        return String(a.name).localeCompare(String(b.name), 'ru'); // обе новые → по названию
      }
      return psMeta(a.status).pr - psMeta(b.status).pr || String(a.name).localeCompare(String(b.name), 'ru');
    });
    const minPr = Math.min(...items.map((p) => psMeta(p.status).pr));
    const subtotal = items.reduce((a, p) => a + num(p.cost) * num(p.qty), 0);
    const pt = paint[cid];
    const orderSum = items.reduce((a, p) => a + num(p.price) * num(p.qty), 0);
    const cItems = items.filter((p) => num(p.cost) > 0);
    const cRentBase = cItems.reduce((a, p) => a + num(p.price) * num(p.qty), 0);
    const cRentCost = cItems.reduce((a, p) => a + num(p.cost) * num(p.qty), 0) + ((pt && num(pt.cost) > 0) ? num(pt.cost) : 0);
    const margin = cRentBase - cRentCost;
    const cardMissing = items.filter((p) => !num(p.cost) && p.status !== 'need').length;

    // Скидка заказа → на запчасти. Доля, приходящаяся на costed-выручку (см.
    // fullPartsOrderByCar). При полностью заполненных закупках вычитается вся
    // скидка; при незаполненных — только её costed-часть (остальное «висит» на
    // позициях без себестоимости, которые и так исключены из рентабельности).
    const gDiscount = num(c.discount);
    const gFullOrder = fullPartsOrderByCar[cid] || 0;
    const gDiscApplied = (gDiscount > 0 && gFullOrder > 0) ? (gDiscount * cRentBase / gFullOrder) : 0;
    const gNetMargin = margin - gDiscApplied;
    const gNetRentabPct = cRentBase > 0 ? (gNetMargin / cRentBase * 100) : null;
    const gDiscPartial = gDiscount > 0 && (gDiscount - gDiscApplied) > 1;
    totalDiscApplied += gDiscApplied;

    const groupCells = Object.keys(cells).filter((id) => { const d = cells[id]; return d && d.plate && c.plate && d.plate === c.plate; })
      .map((id) => { const d = cells[id]; const n = (d.parts || []).reduce((a, x) => a + (num(x.qty) || 1), 0); return { id, count: n, title: 'Ячейка ' + id + ' · ' + (d.orderNum || '') + ' · ' + n + ' поз.' }; });

    const rows = items.map((p) => {
      const m = psMeta(p.status); const km = pkMeta(p.kind || 'new'); const kc = kindColor(km, flagOrigParts);
      const eta = parseDay(p.eta, year); const overdue = (p.status === 'ordered') && eta && eta < t0;
      const cost = num(p.cost); const price = num(p.price); const qty = num(p.qty) || 1;
      return {
        id: p.id, carId: cid, flash: p.id === flashId, name: p.name, article: p.article, qty: p.qty, supplier: p.supplier, cost: p.cost,
        costStr: cost ? cost.toLocaleString('ru-RU') : '', status: p.status, statusColor: m.color, statusLabel: m.label,
        kind: p.kind || 'new', kindColor: kc, kindLabel: km.label,
        isAnalog: (p.kind === 'analog' || p.kind === 'analog_orig'), replArticle: p.replArticle || '',
        hasRepl: (p.kind === 'analog' || p.kind === 'analog_orig') && !!(p.replArticle && p.replArticle.trim()),
        noReplAnalog: (p.kind === 'analog' || p.kind === 'analog_orig') && !(p.replArticle && p.replArticle.trim()),
        kindOptions: partKindMeta.map((k) => ({ value: k.id, label: k.label })),
        kindBadgeStyle: { display: 'inline-flex', alignItems: 'center', height: '22px', maxWidth: '118px', padding: '0 8px', borderRadius: '6px', fontFamily: "'Manrope'", fontWeight: 600, fontSize: '10.5px', lineHeight: 1, cursor: 'pointer', outline: 'none', appearance: 'none', WebkitAppearance: 'none', flex: '0 0 auto', border: '1px solid color-mix(in srgb,' + kc + ' 42%,transparent)', background: 'color-mix(in srgb,' + kc + ' 13%,transparent)', color: kc },
        lineTotal: cost ? money(cost * qty) : '—',
        orderPriceStr: price ? money(price * qty) : '—',
        rentabStr: (cost && price) ? ((price - cost >= 0 ? '' : '−') + Math.abs(Math.round((price - cost) / price * 100)) + '%') : '—',
        rentabColor: (cost && price) ? rentColor((price - cost) / price * 100, rentabTarget) : 'var(--text3)',
        hasEta: !!p.eta, eta: p.eta, overdue, etaColor: overdue ? 'var(--delay)' : 'var(--text3)',
        etaFieldStyle: { width: '50px', height: '24px', padding: '0 6px', borderRadius: '6px', fontFamily: "'JetBrains Mono',monospace", fontSize: '11px', fontWeight: 600, outline: 'none', boxSizing: 'border-box',
          border: '1px solid ' + (overdue ? 'var(--delay)' : 'transparent'), background: overdue ? 'color-mix(in srgb,var(--delay) 16%,transparent)' : 'transparent', color: overdue ? 'var(--delay)' : 'var(--text3)' },
        hasArticle: !!(p.article && p.article.trim()),
        orderedAt: p.orderedAt, hasOrdered: !!p.orderedAt,
        isNeed: p.status === 'need', missingCost: !cost && p.status !== 'need',
        advIsOrder: p.status === 'need', advIsArrive: p.status === 'ordered', advIsIssue: p.status === 'in', advIsDone: p.status === 'issued',
        advOrderStyle: advStyle('var(--wait)'), advArriveStyle: advStyle('var(--done)'), advIssueStyle: advStyle('var(--progress)'),
        costBorder: (!cost && p.status !== 'need') ? 'color-mix(in srgb,var(--delay) 50%,transparent)' : 'var(--line2)',
        statusOptions: partStatusMeta.map((s) => ({ value: s.id, label: s.label })),
        rowStyle: { display: 'grid', gridTemplateColumns: '186px 1fr 44px 118px 120px 96px 96px 40px', gap: '12px', alignItems: 'center', padding: '11px 4px', borderBottom: '1px solid var(--line)', transition: 'background .5s ease, box-shadow .5s ease',
          ...(p.id === flashId ? { background: 'color-mix(in srgb,var(--brand) 12%,transparent)', boxShadow: 'inset 3px 0 0 var(--brand)' } : {}) },
        statusSelStyle: { height: '34px', padding: '0 8px', borderRadius: '8px', border: '1px solid color-mix(in srgb,' + m.color + ' 45%,transparent)', background: 'color-mix(in srgb,' + m.color + ' 12%,transparent)', color: m.color, fontFamily: "'Manrope'", fontWeight: 600, fontSize: '12px', outline: 'none', cursor: 'pointer', flex: '1 1 auto', minWidth: 0 },
      };
    });

    const pm = pt ? paMeta(pt.status) : paMeta('need');
    const paintVM = pt ? {
      code: pt.code, type: pt.type, volume: pt.volume, cost: pt.cost, costStr: pt.cost ? num(pt.cost).toLocaleString('ru-RU') : '', status: pt.status,
      statusColor: pm.color, statusLabel: pm.label, missingCost: !num(pt.cost) && pt.status !== 'need',
      costBorder: (!num(pt.cost) && pt.status !== 'need') ? 'color-mix(in srgb,var(--delay) 50%,transparent)' : 'var(--line2)',
      statusOptions: paintStatusMeta.map((s) => ({ value: s.id, label: s.label })),
      selStyle: { height: '34px', padding: '0 8px', borderRadius: '8px', border: '1px solid color-mix(in srgb,' + pm.color + ' 45%,transparent)', background: 'color-mix(in srgb,' + pm.color + ' 12%,transparent)', color: pm.color, fontFamily: "'Manrope'", fontWeight: 600, fontSize: '12px', outline: 'none', cursor: 'pointer' },
      swatchStyle: { width: '26px', height: '26px', borderRadius: '7px', flex: '0 0 auto', border: '1px solid var(--line2)', background: 'color-mix(in srgb,' + pm.color + ' 30%,var(--panel2))' },
    } : null;

    return {
      carId: cid, model: c.model || cid, plate: c.plate || '', num: c.num || '', client: c.client || '—', minPr,
      cells: groupCells, hasCells: groupCells.length > 0,
      subtotalStr: money(subtotal), orderSumStr: money(orderSum),
      marginStr: (margin >= 0 ? '+ ' : '− ') + money(Math.abs(margin)), marginColor: margin >= 0 ? 'var(--done)' : 'var(--delay)',
      grentabStr: cRentBase > 0 ? ((margin >= 0 ? '' : '−') + Math.abs(Math.round(margin / cRentBase * 100)) + '%') : '—',
      grentabColor: cRentBase > 0 ? rentColor(margin / cRentBase * 100, rentabTarget) : 'var(--text3)',
      // Скидка + «чистая» (со скидкой) маржа/рентаб — показываются, когда у машины есть скидка.
      hasDiscount: gDiscount > 0,
      discountStr: money(gDiscApplied),
      discountFullStr: money(gDiscount),
      netMarginStr: (gNetMargin >= 0 ? '+ ' : '− ') + money(Math.abs(gNetMargin)), netMarginColor: gNetMargin >= 0 ? 'var(--done)' : 'var(--delay)',
      netRentabStr: (gNetRentabPct != null) ? ((gNetMargin >= 0 ? '' : '−') + Math.abs(Math.round(gNetRentabPct)) + '%') : '—',
      netRentabColor: (gNetRentabPct != null) ? rentColor(gNetRentabPct, rentabTarget) : 'var(--text3)',
      discountTitle: gDiscount > 0
        ? ('Скидка по заказу −' + money(gDiscount) + ' отнесена на запчасти. '
          + (gDiscPartial
            ? ('В марже учтено −' + money(gDiscApplied) + ' (доля на запчасти с введённой себестоимостью); остальное приходится на позиции без закупки, исключённые из рентабельности.')
            : 'Маржа и рентабельность показаны уже за вычетом скидки.'))
        : '',
      cardMissing, grentabTitle: cardMissing > 0 ? ('Рентаб. и маржа — по ' + cItems.length + ' поз. с себестоимостью; ' + cardMissing + ' без закупки исключены') : '',
      count: items.length, rows, paint: paintVM,
    };
  });
  if (frozenCarIdx) {
    groups.sort((a, b) => {
      const ra = frozenCarIdx.get(a.carId); const rb = frozenCarIdx.get(b.carId);
      const na = ra === undefined; const nb = rb === undefined;
      if (na !== nb) return na ? 1 : -1;      // новая машина (не в снимке) → в конец
      if (!na && ra !== rb) return ra - rb;   // обе в снимке → по зафиксированному порядку
      return String(a.model).localeCompare(String(b.model), 'ru');
    });
  } else {
    groups.sort((a, b) => a.minPr - b.minPr || String(a.model).localeCompare(String(b.model), 'ru'));
  }

  // Итог со скидкой: сумма долей скидки, отнесённых на видимые costed-позиции
  // (Σ по машинам). netTotalMargin = «грязная» маржа − эта скидка.
  const netTotalMargin = totalMargin - totalDiscApplied;
  const netRentabPct = rentBase > 0 ? Math.round(netTotalMargin / rentBase * 100) : 0;
  const hasDiscountTotal = totalDiscApplied > 0;

  return {
    groups, isEmpty: groups.length === 0, statusChips, overdueChip,
    hasFilter: scopeFiltered,
    totalCostStr: money(totalCost), totalOrderStr: money(totalOrder), actionNeeded, missingCost,
    totalMarginStr: (totalMargin >= 0 ? '+ ' : '− ') + money(Math.abs(totalMargin)),
    rentabStr: rentBase > 0 ? ((totalMargin >= 0 ? '' : '−') + Math.abs(rentab) + '%') : '—',
    rentabColor: rentBase > 0 ? rentColor(rentab, rentabTarget) : 'var(--text3)',
    // «Чистые» итоги со скидкой (показываются, когда есть скидка хоть у одной машины в срезе).
    hasDiscountTotal, discountTotalStr: money(totalDiscApplied),
    netTotalMarginStr: (netTotalMargin >= 0 ? '+ ' : '− ') + money(Math.abs(netTotalMargin)),
    netRentabStr: rentBase > 0 ? ((netTotalMargin >= 0 ? '' : '−') + Math.abs(netRentabPct) + '%') : '—',
    netRentabColor: rentBase > 0 ? rentColor(netRentabPct, rentabTarget) : 'var(--text3)',
    rentCountedStr: missingCost > 0 ? ('по ' + costedParts.length + ' с себест.') : '',
    missingHint: missingCost > 0 ? (missingCost + ' поз. без себестоимости исключены из расчёта рентабельности и маржи — заполните закупку, чтобы учесть их') : '',
    scopeFiltered, scopeLabel, scopeStyle, searchStyle,
  };
}
