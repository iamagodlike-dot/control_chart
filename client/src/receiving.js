// Pure view-model for the экспедитор «Приёмка запчастей» screen. No React, no
// Firestore — same style as parts.js / costing.js, so it can be unit-tested.
//
// The expeditor cares about exactly two things: which parts are on the way or
// have arrived, and which warehouse cell each car's parts go into. So we take
// the raw jobs + cells and produce car-grouped cards of only the relevant parts.
import { psMeta } from './parts.js';

// Statuses an expeditor acts on:
//   'ordered' — заказано, едет к складу ТК (в пути), забирать пока нечего;
//   'arrived' — доехало до склада ТК / поставщика — НАДО СЪЕЗДИТЬ ЗАБРАТЬ;
//   'in'      — экспедитор забрал и привёз к нам на склад.
// 'need' (ещё не заказано) and 'issued' (уже забрали в работу) are not their concern.
export const RECEIVING_STATUSES = ['ordered', 'arrived', 'in'];

// A job's linked warehouse cells. Mirror of api.js `jobCellIds` — kept local so
// this module carries no Firestore dependency.
const cellIdsOf = (job) => job.cell_ids || (job.cell_id ? [job.cell_id] : []);

// filter: 'ordered' | 'arrived' | 'in' | 'all'. Returns { groups, counts }.
export function buildReceiving(jobs = [], filter = 'arrived') {
  let ordered = 0;
  let arrived = 0;
  let inStock = 0;
  const groups = [];

  for (const job of (Array.isArray(jobs) ? jobs : [])) {
    if (!job) continue;
    const relevant = (job.parts || []).filter((p) => p && RECEIVING_STATUSES.includes(p.status));
    for (const p of relevant) {
      if (p.status === 'ordered') ordered += 1;
      else if (p.status === 'arrived') arrived += 1;
      else inStock += 1;
    }
    const shown = relevant.filter((p) => (filter === 'all' ? true : p.status === filter));
    if (!shown.length) continue;

    const cellIds = cellIdsOf(job);
    // readyPickup — по машине есть что забрать из ТК прямо сейчас (главный сигнал
    // экспедитору). waiting — есть незавершённые позиции (едут или к выдаче), т.е.
    // машина ещё не укомплектована. Ранг для сортировки: сначала «забрать», потом
    // «ждём в пути», потом полностью на складе.
    const readyPickup = shown.some((p) => p.status === 'arrived');
    const waiting = shown.some((p) => p.status === 'ordered' || p.status === 'arrived');

    // Фото приёмки этой машины, разложенные по позициям. Экспедитор снимает
    // деталь при заборе — снимок кладётся в job.photos[] с category:'receiving' и
    // partId (см. PartsReceiving.onAddPhoto). Общий массив job.photos хранит и
    // «до/после» карточки машины — поэтому фильтруем строго по category+partId.
    // Сортировка по времени загрузки, чтобы порядок миниатюр не «прыгал».
    const photosByPart = {};
    for (const ph of (job.photos || [])) {
      if (ph && ph.category === 'receiving' && ph.partId) {
        (photosByPart[ph.partId] = photosByPart[ph.partId] || []).push(ph);
      }
    }
    for (const id in photosByPart) {
      photosByPart[id].sort((a, b) => (a.uploaded_at || 0) - (b.uploaded_at || 0));
    }

    groups.push({
      jobId: job.id,
      car: job.car_model || 'Без модели',
      plate: job.plate || job.plate_number || '',
      orderNum: job.order_number || '',
      client: job.client_name || '',
      cellIds,
      hasCell: cellIds.length > 0,
      readyPickup,
      waiting,
      rank: readyPickup ? 0 : waiting ? 1 : 2,
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
          // Фото приёмки этой позиции (id/url/path — достаточно для показа и
          // удаления). Пустой массив, если ещё не снимали.
          photos: (photosByPart[p.id] || []).map((ph) => ({ id: ph.id, url: ph.url, path: ph.path })),
          photoCount: (photosByPart[p.id] || []).length,
          // Свободный комментарий к позиции (напр. «коробка мятая», «привёз 1 из 2»).
          // Живёт на самой запчасти → виден везде, где показывается деталь.
          comment: p.comment || '',
        })),
    });
  }

  // Машины «есть что забрать» — вверх, затем «ждём в пути», затем укомплектованные;
  // внутри ранга — по алфавиту.
  groups.sort((a, b) => (a.rank === b.rank
    ? String(a.car).localeCompare(String(b.car), 'ru')
    : a.rank - b.rank));

  return { groups, counts: { ordered, arrived, in: inStock, total: ordered + arrived + inStock } };
}
