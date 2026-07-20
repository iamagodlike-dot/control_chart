// Pure helpers for the «Заявки на закупку» / «Закупки» screens. No React, no
// Firestore — same style as expenses.js / parts.js, so it's unit-testable.

// Единицы измерения в форме заявки.
export const REQUEST_UNITS = ['шт', 'упак', 'л', 'кг', 'м', 'компл'];

// Статусы заявки и как их показывать. tone → класс цвета бейджа в вёрстке
// (wait/ok/done/bad). Держим лейблы здесь, чтобы экран и тесты не расходились.
export const REQUEST_STATUS = {
  new: { label: 'на одобрении', tone: 'wait' },
  approved: { label: 'одобрено', tone: 'ok' },
  purchased: { label: 'куплено', tone: 'done' },
  rejected: { label: 'отклонено', tone: 'bad' },
};

export function requestStatus(s) {
  return REQUEST_STATUS[s] || REQUEST_STATUS.new;
}

// Newest first, by created_at. Returns a new array (does not mutate input).
export function sortRequestsNewest(list = []) {
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => ((b && b.created_at) || 0) - ((a && a.created_at) || 0));
}

// Заявки в конкретном статусе (approved → «к покупке», new → «на одобрении»…).
export function requestsByStatus(list = [], status) {
  return (Array.isArray(list) ? list : []).filter((r) => r && r.status === status);
}

// Сколько заявок в каждом статусе — для сводки вверху экрана.
export function countByStatus(list = []) {
  const out = { new: 0, approved: 0, purchased: 0, rejected: 0 };
  for (const r of (Array.isArray(list) ? list : [])) {
    if (r && out[r.status] != null) out[r.status] += 1;
  }
  return out;
}

// Метка машины для выпадающего списка «для какой машины».
export function jobLabel(job = {}) {
  const parts = [job.car_model, job.plate_number].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.join(' · ') || 'без названия';
}
