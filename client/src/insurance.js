// Insurance / payer support, shared across the car card, documents, sidebar,
// history and config. Kept dependency-free so any component can import it.

export const PAYMENT_TYPES = [
  { id: 'cash', label: 'Клиент (наличные)' },
  { id: 'insurance', label: 'Страховая компания' },
  { id: 'legal', label: 'Юридическое лицо' },
];

// Short labels for badges / compact lists.
export const PAYMENT_SHORT = {
  cash: 'Наличные',
  insurance: 'Страховая',
  legal: 'Юрлицо',
};

// Тип страхового полиса, по которому идёт ремонт.
export const POLICY_TYPES = [
  { id: 'osago', label: 'ОСАГО' },
  { id: 'kasko', label: 'КАСКО' },
];

// Человекочитаемая метка типа полиса по id (для документов и списков).
// Пустой/неизвестный id → '' (строка/блок просто не показывается).
export function policyTypeLabel(id) {
  const t = POLICY_TYPES.find((p) => p.id === id);
  return t ? t.label : '';
}

// Максимальный срок восстановительного ремонта по ОСАГО — 30 рабочих дней со дня
// передачи машины на СТОА (п. 15.2 ст. 12 ФЗ «Об ОСАГО»). За превышение страховщик
// платит потерпевшему неустойку 0,5% от стоимости ремонта за каждый день просрочки.
export const OSAGO_MAX_REPAIR_WORKDAYS = 30;
export const OSAGO_PENALTY_PER_DAY = 0.005; // 0,5% в день от стоимости ремонта

// Рабочих дней (пн–пт) в интервале (from, to]. Праздники не учитываются — это
// приблизительная оценка срока, слегка в запас (реальных рабочих дней с учётом
// праздников будет меньше). from/to — Date, ISO-строка или локальный datetime.
export function workdaysBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return 0;
  let count = 0;
  const cur = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) count += 1;
  }
  return count;
}

// Дата, наступающая через `n` рабочих дней после `from` (пропуская сб/вс).
// Нужна, чтобы найти законный дедлайн ремонта = заезд + 30 рабочих дней.
export function addWorkdays(from, n) {
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return d;
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) added += 1;
  }
  return d;
}

// Ремонт по ОСАГО с заездом `from` и дедлайном `to` выходит за законный срок?
// Возвращает число рабочих дней срока, если оно превышает лимит, иначе 0.
export function osagoTermOverrun(from, to) {
  if (!from || !to) return 0;
  const wd = workdaysBetween(from, to);
  return wd > OSAGO_MAX_REPAIR_WORKDAYS ? wd : 0;
}

// Seeded once into the `insurers` collection; the shop edits the list afterwards.
export const DEFAULT_INSURERS = [
  'СОГАЗ',
  'Ингосстрах',
  'РЕСО-Гарантия',
  'АльфаСтрахование',
  'ВСК',
  'Росгосстрах',
  'Согласие',
  'Ренессанс Страхование',
  'Т-Страхование (Тинькофф)',
  'СберСтрахование',
  'Зетта Страхование',
  'Энергогарант',
];

// A job/snapshot is an insurance repair when its payer is a страховая.
export function isInsurance(x) {
  return !!x && x.payment_type === 'insurance';
}
