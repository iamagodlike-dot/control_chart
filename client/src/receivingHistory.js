// Pure view-model for the «История приёмки» screen. No React, no Firestore — same
// style as receiving.js / parts.js, so it can be unit-tested in isolation.
//
// A receiving event is one moment on a part's journey to our shelf. Two sources
// feed the timeline:
//   1) part.receiving_log[] — status changes recorded by api.jobs.savePart the
//      moment someone advances a part («Заказано» → «Приехало в ТК» → «На складе»).
//      Each entry is { status, at, by }. This is the real history going forward.
//   2) job.photos[] with category:'receiving' — a photo the expeditor took while
//      picking a part up. Each carries uploaded_at + uploaded_by, so it is a real,
//      already-recorded receiving action — we fold these in so the screen has
//      content from day one, before the status log has had time to fill up.
//
// The result is a single flat, newest-first feed the owner/expeditor can scan:
// who accepted which part on which car, and when.
import { psMeta } from './parts.js';

// Which status each history entry means, phrased for приёмка. Colour mirrors the
// part life-cycle (psMeta) so a chip here matches the same status on other screens.
const EVENT_LABELS = {
  ordered: 'Заказано',
  arrived: 'Приехало в ТК',
  in: 'Принято на склад',
};

const norm = (v) => String(v || '').toLowerCase();

// filter: 'all' | 'in' | 'arrived' | 'ordered' | 'photo'. query: free-text search
// over car / plate / ЗН / client / part / person. Returns { events, counts }.
export function buildReceivingHistory(jobs = [], { filter = 'all', query = '' } = {}) {
  const events = [];
  const counts = { ordered: 0, arrived: 0, in: 0, photo: 0, total: 0 };

  for (const job of (Array.isArray(jobs) ? jobs : [])) {
    if (!job) continue;
    const car = job.car_model || 'Без модели';
    const plate = job.plate || job.plate_number || '';
    const orderNum = job.order_number || '';
    const client = job.client_name || '';
    const archived = !!job.archived;

    const parts = Array.isArray(job.parts) ? job.parts : [];
    const partsById = {};
    for (const p of parts) if (p && p.id != null) partsById[p.id] = p;

    const base = { jobId: job.id, car, plate, orderNum, client, archived };

    // 1) Status-change events from each part's receiving_log.
    for (const p of parts) {
      if (!p || !Array.isArray(p.receiving_log)) continue;
      p.receiving_log.forEach((e, idx) => {
        if (!e || !Number.isFinite(e.at)) return;      // can't place on a timeline
        const status = e.status;
        if (!EVENT_LABELS[status]) return;             // ignore unknown/untracked
        counts[status] += 1;
        events.push({
          ...base,
          id: `${job.id}:${p.id}:${status}:${e.at}:${idx}`,
          kind: 'status',
          at: e.at,
          by: e.by || null,
          status,
          statusLabel: EVENT_LABELS[status],
          statusColor: psMeta(status).color,
          eventLabel: EVENT_LABELS[status],
          partId: p.id,
          partName: p.name || 'Без названия',
          partCode: p.code || '',
          photo: null,
        });
      });
    }

    // 2) Receiving-photo events (already carry who + when).
    for (const ph of (Array.isArray(job.photos) ? job.photos : [])) {
      if (!ph || ph.category !== 'receiving' || ph.partId == null) continue;
      if (!Number.isFinite(ph.uploaded_at)) continue;
      const part = partsById[ph.partId];
      counts.photo += 1;
      events.push({
        ...base,
        id: `photo:${ph.id}`,
        kind: 'photo',
        at: ph.uploaded_at,
        by: ph.uploaded_by || null,
        status: null,
        statusLabel: 'Фото приёмки',
        statusColor: 'var(--color-primary)',
        eventLabel: 'Фото приёмки',
        partId: ph.partId,
        partName: part ? (part.name || 'Без названия') : 'Запчасть удалена',
        partCode: part ? (part.code || '') : '',
        photo: { id: ph.id, url: ph.url, path: ph.path },
      });
    }
  }

  counts.total = events.length;

  let shown = events;
  if (filter === 'photo') shown = shown.filter((e) => e.kind === 'photo');
  else if (filter !== 'all') shown = shown.filter((e) => e.kind === 'status' && e.status === filter);

  const q = norm(query).trim();
  if (q) {
    shown = shown.filter((e) => [e.car, e.plate, e.orderNum, e.client, e.partName, e.partCode, e.by]
      .some((v) => norm(v).includes(q)));
  }

  // Newest first; ties broken by id so the order is stable across renders.
  shown = shown.slice().sort((a, b) => (b.at - a.at) || (a.id < b.id ? 1 : -1));

  return { events: shown, counts };
}
