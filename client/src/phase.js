// Жизненная фаза машины: сначала «согласование со страховой», затем «ремонт».
// Модуль держим без зависимостей, чтобы его мог импортировать и слой данных
// (api.js), и любой экран.
//
// СОВМЕСТИМОСТЬ СО СТАРЫМИ МАШИНАМИ: у машин, заведённых до появления фазы, поля
// `phase` нет. Такие машины считаем находящимися в ремонте (isRepair === true) —
// они, как и раньше, видны на Графике, в Запчастях и Финансах. На доску
// согласования попадают только машины, которым фаза проставлена явно.

export const PHASE = {
  APPROVAL: 'approval', // на согласовании со страховой (ремонт ещё не начат)
  REPAIR: 'repair',     // согласовано → в ремонте / в очереди на ремонт
};

// Машина сейчас на согласовании со страховой?
export function isApproval(job) {
  return !!job && job.phase === PHASE.APPROVAL;
}

// Машина в ремонте (или в очереди на ремонт)? Всё, что НЕ помечено явно как
// «согласование», считается ремонтом — включая старые машины без поля phase.
export function isRepair(job) {
  return !isApproval(job);
}

// Под-статусы согласования = колонки доски «Согласование», слева направо.
// `side: true` — «боковые» тупиковые колонки (доплата / отказ): они рисуются
// отдельно от основного потока.
export const APPROVAL_STATUSES = [
  { id: 'inspection', label: 'Осмотр / дефектовка',    color: 'var(--status-planned)' },
  { id: 'calc',       label: 'Калькуляция',            color: 'var(--status-in-progress)' },
  { id: 'sent',       label: 'Отправлено страховой',   color: 'var(--status-queued)' },
  { id: 'approved',   label: 'Согласовано',            color: 'var(--status-done)' },
  { id: 'surcharge',  label: 'Нужна доплата / правки', color: 'var(--color-warning)', side: true },
  { id: 'rejected',   label: 'Отказ',                  color: 'var(--color-danger)',  side: true },
];

// «Основной поток» согласования — по нему двигают кнопки «назад» / «дальше».
// Боковые статусы (доплата, отказ) в поток не входят — в них переводят отдельно.
export const APPROVAL_FLOW = ['inspection', 'calc', 'sent', 'approved'];

export const APPROVAL_STATUS_BY_ID = Object.fromEntries(
  APPROVAL_STATUSES.map((s) => [s.id, s]),
);

// Статус, с которого машина начинает согласование.
export const DEFAULT_APPROVAL_STATUS = 'inspection';

// Статус «страховая одобрила» — единственный, из которого разрешён перевод
// машины «→ В работу» (в ремонт).
export const APPROVED_STATUS = 'approved';

// Человекочитаемая метка под-статуса по id (пустая строка для неизвестного).
export function approvalStatusLabel(id) {
  return APPROVAL_STATUS_BY_ID[id]?.label || '';
}
