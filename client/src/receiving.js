// Pure view-model for the экспедитор «Приёмка запчастей» screen. No React, no
// Firestore — same style as parts.js / costing.js, so it can be unit-tested.
//
// The expeditor cares about exactly two things: which parts are on the way or
// have arrived, and which warehouse cell each car's parts go into. So we take
// the raw jobs + cells and produce car-grouped cards of only the relevant parts.
import { psMeta } from './parts.js';

// Statuses an expeditor acts on: 'ordered' (в пути) and 'in' (на складе).
// 'need' (ещё не заказано) and 'issued' (уже забрали) are not their concern.
export const RECEIVING_STATUSES = ['ordered', 'in'];

// A job's linked warehouse cells. Mirror of api.js `jobCellIds` — kept local so
// this module carries no Firestore dependency.
const cellIdsOf = (job) => job.cell_ids || (job.cell_id ? [job.cell_id] : []);

// filter: 'ordered' | 'in' | 'all'. Returns { groups, counts }.
export function buildReceiving(jobs = [], filter = 'ordered') {
  let ordered = 0;
  let inStock = 0;
  const groups = [];

  for (const job of (Array.isArray(jobs) ? jobs : [])) {
    if (!job) continue;
    const relevant = (job.parts || []).filter((p) => p && RECEIVING_STATUSES.includes(p.status));
    for (const p of relevant) {
      if (p.status === 'ordered') ordered += 1;
      else inStock += 1;
    }
    const shown = relevant.filter((p) => (filter === 'all' ? true : p.status === filter));
    if (!shown.length) continue;

    const cellIds = cellIdsOf(job);
    groups.push({
      jobId: job.id,
      car: job.car_model || 'Без модели',
      plate: job.plate || job.plate_number || '',
      orderNum: job.order_number || '',
      client: job.client_name || '',
      cellIds,
      hasCell: cellIds.length > 0,
      waiting: shown.some((p) => p.status === 'ordered'),
      parts: shown
        .slice()
        .sort((a, b) => psMeta(a.status).pr - psMeta(b.status).pr
          || String(a.name || '').localeCompare(String(b.name || ''), 'ru'))
        .map((p) => ({
          id: p.id,
          name: p.name || 'Без названия',
          code: p.code || '',
          qty: p.qty ?? 1,
          supplier: (p.supplier || '').trim(), // где забирать — ключ для экспедитора
          status: p.status,
          statusLabel: psMeta(p.status).label,
          statusColor: psMeta(p.status).color,
          eta: p.eta || '',
        })),
    });
  }

  // Cars still waiting for deliveries float to the top; then alphabetical.
  groups.sort((a, b) => (a.waiting === b.waiting
    ? String(a.car).localeCompare(String(b.car), 'ru')
    : (a.waiting ? -1 : 1)));

  return { groups, counts: { ordered, in: inStock, total: ordered + inStock } };
}
