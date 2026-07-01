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
