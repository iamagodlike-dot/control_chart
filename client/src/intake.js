// Экран «Приёмка авто» — предремонтная приёмка машины мастером-приёмщиком.
//
// ЧТО ЭТО. Машина заехала на площадку и стоит в колонке «Осмотр / дефектовка»
// доски «Согласование» (phase = approval, approval_status = 'inspection'). До
// того как её отдадут в калькуляцию, приёмщик обязан зафиксировать состояние:
// пробег, топливо, ключи, документы, комплектность, все видимые повреждения и
// обязательный набор фотографий. Это защита сервиса в споре «а вот этой царапины
// не было» — и одновременно исходник для сметы.
//
// ГДЕ ЖИВУТ ДАННЫЕ. Всё лежит в самом документе машины, в поле `job.intake`
// (см. api.jobs.saveIntake). Отдельная коллекция не заводится сознательно: экран
// и так подписан на машины, лишние чтения Firestore не нужны — при бесплатной
// квоте это заметно (см. память «Нагрузка на Firebase»). Фотографии — в общем
// `job.photos` с категорией `intake:<слот>`, чтобы переиспользовать готовую
// загрузку на свой сервер и удаление файлов вместе с машиной.
//
// НАСТРОЙКИ. Шаблоны чек-листов, рубрики фото, зоны повреждений и списки
// комплектности редактируются управленцем в «Настройки → Приёмка авто»
// (settings/intake). Здесь — только ДЕФОЛТЫ и чистая логика поверх них.
//
// Модуль намеренно без зависимостей (как billing.js / monitor.js), чтобы
// гоняться юнит-тестами:  node --test src/intake.test.js

import { isApproval } from './phase.js';

// Под-статус согласования, машины которого попадают на экран приёмки.
export const INTAKE_APPROVAL_STATUS = 'inspection';

// Префикс категории фото приёмки в общем job.photos. Именно по нему экран
// отбирает свои снимки, а зона «Фото — до ремонта» в карточке машины их НЕ
// подхватывает (она фильтрует category === 'before').
export const INTAKE_PHOTO_PREFIX = 'intake:';

export const photoCategory = (slotId) => `${INTAKE_PHOTO_PREFIX}${slotId}`;
export const photoSlotId = (category) =>
  (typeof category === 'string' && category.startsWith(INTAKE_PHOTO_PREFIX)
    ? category.slice(INTAKE_PHOTO_PREFIX.length)
    : null);

// ─── Дефолтные справочники ───────────────────────────────────────────────────

// Обязательные ракурсы съёмки. `required: true` → без снимка приёмку не закрыть.
// «Повреждения крупно» обязателен всегда: именно эти кадры потом решают спор.
export const DEFAULT_PHOTO_SLOTS = [
  { id: 'front_left', label: 'Перед ¾ слева', required: true },
  { id: 'rear_right', label: 'Зад ¾ справа', required: true },
  { id: 'side_left', label: 'Левый борт', required: true },
  { id: 'side_right', label: 'Правый борт', required: true },
  { id: 'vin', label: 'VIN-табличка', required: true },
  { id: 'odometer', label: 'Панель приборов (пробег)', required: true },
  { id: 'interior', label: 'Салон', required: false },
  { id: 'damage', label: 'Повреждения крупно', required: true },
];

// Уровень топлива — как на приборной панели, восемь делений слишком мелко.
export const FUEL_LEVELS = [
  { id: 'empty', label: 'Пусто' },
  { id: 'quarter', label: '¼' },
  { id: 'half', label: '½' },
  { id: 'three_quarters', label: '¾' },
  { id: 'full', label: 'Полный' },
];

// Документы, которые клиент передаёт вместе с машиной.
export const DEFAULT_DOC_ITEMS = [
  { id: 'sts', label: 'СТС' },
  { id: 'pts', label: 'ПТС' },
  { id: 'policy', label: 'Полис (ОСАГО/КАСКО)' },
  { id: 'referral', label: 'Направление страховой' },
  { id: 'passport', label: 'Паспорт собственника (копия)' },
  { id: 'power_of_attorney', label: 'Доверенность' },
];

// Комплектность — то, из-за чего чаще всего возникают претензии при выдаче.
export const DEFAULT_EQUIPMENT_ITEMS = [
  { id: 'jack', label: 'Домкрат' },
  { id: 'spare', label: 'Запасное колесо' },
  { id: 'wheel_wrench', label: 'Баллонный ключ' },
  { id: 'tools', label: 'Набор инструмента' },
  { id: 'first_aid', label: 'Аптечка' },
  { id: 'extinguisher', label: 'Огнетушитель' },
  { id: 'warning_triangle', label: 'Знак аварийной остановки' },
  { id: 'radio', label: 'Магнитола / мультимедиа' },
  { id: 'mats', label: 'Коврики' },
  { id: 'wheel_lock_key', label: 'Секретка на колёса' },
];

// Зоны кузова для отметки повреждений. Плоский список, а не кликабельная схема:
// приёмщик работает с телефона одной рукой, галочки быстрее и надёжнее рисунка,
// и такой список потом переносится в смету построчно.
export const DEFAULT_DAMAGE_ZONES = [
  { id: 'bumper_front', label: 'Бампер передний', group: 'Перед' },
  { id: 'hood', label: 'Капот', group: 'Перед' },
  { id: 'grille', label: 'Решётка радиатора', group: 'Перед' },
  { id: 'headlight_left', label: 'Фара левая', group: 'Перед' },
  { id: 'headlight_right', label: 'Фара правая', group: 'Перед' },
  { id: 'windshield', label: 'Лобовое стекло', group: 'Перед' },

  { id: 'fender_front_left', label: 'Крыло переднее левое', group: 'Левый борт' },
  { id: 'door_front_left', label: 'Дверь передняя левая', group: 'Левый борт' },
  { id: 'door_rear_left', label: 'Дверь задняя левая', group: 'Левый борт' },
  { id: 'sill_left', label: 'Порог левый', group: 'Левый борт' },
  { id: 'fender_rear_left', label: 'Крыло заднее левое', group: 'Левый борт' },
  { id: 'mirror_left', label: 'Зеркало левое', group: 'Левый борт' },

  { id: 'fender_front_right', label: 'Крыло переднее правое', group: 'Правый борт' },
  { id: 'door_front_right', label: 'Дверь передняя правая', group: 'Правый борт' },
  { id: 'door_rear_right', label: 'Дверь задняя правая', group: 'Правый борт' },
  { id: 'sill_right', label: 'Порог правый', group: 'Правый борт' },
  { id: 'fender_rear_right', label: 'Крыло заднее правое', group: 'Правый борт' },
  { id: 'mirror_right', label: 'Зеркало правое', group: 'Правый борт' },

  { id: 'bumper_rear', label: 'Бампер задний', group: 'Зад' },
  { id: 'trunk', label: 'Крышка багажника', group: 'Зад' },
  { id: 'taillight_left', label: 'Фонарь левый', group: 'Зад' },
  { id: 'taillight_right', label: 'Фонарь правый', group: 'Зад' },
  { id: 'rear_window', label: 'Заднее стекло', group: 'Зад' },

  { id: 'roof', label: 'Крыша', group: 'Прочее' },
  { id: 'wheel_front_left', label: 'Диск переднего левого', group: 'Прочее' },
  { id: 'wheel_front_right', label: 'Диск переднего правого', group: 'Прочее' },
  { id: 'wheel_rear_left', label: 'Диск заднего левого', group: 'Прочее' },
  { id: 'wheel_rear_right', label: 'Диск заднего правого', group: 'Прочее' },
  { id: 'interior', label: 'Салон', group: 'Прочее' },
];

// Характер повреждения. Порядок = по возрастанию тяжести, чтобы в акте строки
// читались единообразно.
export const DAMAGE_KINDS = [
  { id: 'scratch', label: 'Царапина' },
  { id: 'chip', label: 'Скол' },
  { id: 'dent', label: 'Вмятина' },
  { id: 'crack', label: 'Излом / трещина' },
  { id: 'tear', label: 'Разрыв' },
  { id: 'missing', label: 'Отсутствует' },
  { id: 'paint', label: 'Требует окраски' },
  { id: 'replace', label: 'Требует замены' },
];

export const DEFAULT_DAMAGE_KIND = 'scratch';

// ─── Дефолтные шаблоны чек-листов ────────────────────────────────────────────
// `payment_types` решает, какой шаблон подставится машине автоматически. Шаблон
// без payment_types считается универсальным (fallback, если ничего не подошло).

const INSURANCE_ITEMS = [
  { id: 'vin_check', text: 'Сверить VIN и госномер с документами', required: true },
  { id: 'mileage', text: 'Записать пробег', required: true },
  { id: 'fuel', text: 'Отметить уровень топлива', required: true },
  { id: 'keys', text: 'Принять ключи, записать количество комплектов', required: true },
  { id: 'docs', text: 'Принять документы: СТС, полис, направление страховой', required: true },
  { id: 'equipment', text: 'Проверить комплектность (домкрат, запаска, аптечка…)', required: true },
  { id: 'damages', text: 'Осмотреть кузов и отметить все видимые повреждения', required: true },
  { id: 'photos', text: 'Сделать круговую фотосъёмку', required: true },
  { id: 'upsell', text: 'Уточнить у клиента дополнительные пожелания (допродажи)', required: false },
  { id: 'act', text: 'Распечатать акт приёмки и подписать у клиента', required: true },
  { id: 'term', text: 'Согласовать с клиентом ориентировочный срок', required: false },
  { id: 'contact', text: 'Записать телефон и удобное время для звонка', required: true },
];

const CLIENT_ITEMS = [
  { id: 'vin_check', text: 'Сверить VIN и госномер с документами', required: true },
  { id: 'mileage', text: 'Записать пробег', required: true },
  { id: 'fuel', text: 'Отметить уровень топлива', required: true },
  { id: 'keys', text: 'Принять ключи, записать количество комплектов', required: true },
  { id: 'docs', text: 'Принять документы на машину', required: true },
  { id: 'equipment', text: 'Проверить комплектность (домкрат, запаска, аптечка…)', required: true },
  { id: 'damages', text: 'Осмотреть кузов и отметить все видимые повреждения', required: true },
  { id: 'photos', text: 'Сделать круговую фотосъёмку', required: true },
  { id: 'scope', text: 'Согласовать с клиентом объём работ', required: true },
  { id: 'prepay', text: 'Обсудить предоплату', required: false },
  { id: 'act', text: 'Распечатать акт приёмки и подписать у клиента', required: true },
  { id: 'contact', text: 'Записать телефон и удобное время для звонка', required: true },
];

export const DEFAULT_TEMPLATES = [
  { id: 'insurance', label: 'Страховая машина', payment_types: ['insurance'], items: INSURANCE_ITEMS },
  { id: 'client', label: 'Клиент / юрлицо', payment_types: ['cash', 'legal'], items: CLIENT_ITEMS },
];

// Юридический блок печатного акта приёмки. Правится управленцем в настройках —
// формулировки под конкретный сервис подбирает он, а не программа.
export const DEFAULT_ACT_TEXT =
  'Транспортное средство передано Исполнителю для проведения осмотра (дефектовки) и ' +
  'последующего ремонта. Настоящий акт фиксирует комплектность и состояние ТС на момент ' +
  'приёмки. Заказчик подтверждает, что перечень повреждений и комплектность, указанные в ' +
  'акте, соответствуют фактическому состоянию ТС, и что ценные вещи и документы из салона и ' +
  'багажника изъяты. Исполнитель не несёт ответственности за оставленные в ТС ценности. ' +
  'Скрытые повреждения и дефекты, не выявляемые при внешнем осмотре, фиксируются ' +
  'дополнительно в ходе дефектовки и согласуются с Заказчиком отдельно.';

// Полные настройки экрана по умолчанию — то, что увидит управленец, ни разу не
// заходивший в «Настройки → Приёмка авто».
export const DEFAULT_INTAKE_SETTINGS = {
  templates: DEFAULT_TEMPLATES,
  photo_slots: DEFAULT_PHOTO_SLOTS,
  damage_zones: DEFAULT_DAMAGE_ZONES,
  equipment: DEFAULT_EQUIPMENT_ITEMS,
  docs: DEFAULT_DOC_ITEMS,
  act_text: DEFAULT_ACT_TEXT,
  require_mileage: true,
  require_photos: true,
  // Через сколько дней стояния без закрытой приёмки машина краснеет в списке.
  warn_days: 1,
  alert_days: 2,
};

// ─── Нормализация ────────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const bool = (v, fallback = false) => (typeof v === 'boolean' ? v : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);

// Список-справочник {id, label, …} из базы: выбрасываем мусор (записи без id или
// без подписи), но сохраняем прочие поля — так добавление нового поля в справочник
// не требует правок здесь.
function cleanDict(list, fallback) {
  const out = arr(list)
    .filter((x) => x && typeof x === 'object' && str(x.id).trim() && str(x.label).trim())
    .map((x) => ({ ...x, id: str(x.id).trim(), label: str(x.label).trim() }));
  return out.length ? out : fallback;
}

function cleanTemplate(t) {
  const items = arr(t.items)
    .filter((i) => i && typeof i === 'object' && str(i.id).trim() && str(i.text).trim())
    .map((i) => ({ id: str(i.id).trim(), text: str(i.text).trim(), required: bool(i.required, true) }));
  return {
    id: str(t.id).trim(),
    label: str(t.label).trim() || 'Без названия',
    payment_types: arr(t.payment_types).map(str).filter(Boolean),
    items,
  };
}

// Слитые с дефолтами настройки. Пустой/битый раздел откатывается к дефолту
// целиком — полупустой справочник (например, ноль рубрик фото) сломал бы правило
// «без фото не закрыть», а молчаливая поломка правила хуже, чем игнор кривых данных.
export function normalizeIntakeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const templates = arr(s.templates)
    .filter((t) => t && typeof t === 'object' && str(t.id).trim())
    .map(cleanTemplate)
    .filter((t) => t.items.length);
  return {
    templates: templates.length ? templates : DEFAULT_TEMPLATES,
    photo_slots: cleanDict(s.photo_slots, DEFAULT_PHOTO_SLOTS).map((x) => ({ ...x, required: bool(x.required, true) })),
    damage_zones: cleanDict(s.damage_zones, DEFAULT_DAMAGE_ZONES),
    equipment: cleanDict(s.equipment, DEFAULT_EQUIPMENT_ITEMS),
    docs: cleanDict(s.docs, DEFAULT_DOC_ITEMS),
    // Пустой текст = «печатать без юр-блока» и сохраняется как есть; к дефолту
    // откатываемся только если поля не было вовсе.
    act_text: typeof s.act_text === 'string' ? s.act_text : DEFAULT_ACT_TEXT,
    require_mileage: bool(s.require_mileage, true),
    require_photos: bool(s.require_photos, true),
    warn_days: Number.isFinite(Number(s.warn_days)) ? Math.max(0, Number(s.warn_days)) : 1,
    alert_days: Number.isFinite(Number(s.alert_days)) ? Math.max(1, Number(s.alert_days)) : 2,
  };
}

// Пустая приёмка — то, с чего начинается машина, которую ещё не трогали.
export function emptyIntake() {
  return {
    status: 'open',       // 'open' | 'done' | 'skipped'
    template_id: '',
    mileage: '',
    fuel: '',
    keys: '',
    docs: [],
    equipment: [],
    damages: [],
    checked: [],          // id отмеченных пунктов чек-листа
    notes: '',
  };
}

// Приёмка машины в нормальном виде. Старые машины (поля нет вовсе) → пустая.
export function readIntake(job) {
  const raw = job && typeof job.intake === 'object' && job.intake ? job.intake : null;
  const base = emptyIntake();
  // Пробег у машины один. Если приёмщик его ещё не вписал, показываем пробег из
  // карточки (мог прийти из Audatex или из документа) — чтобы экран приёмки, акт
  // приёмки и акт приёма-передачи не расходились. Вписанное на экране приёмки
  // сильнее и уходит обратно в карточку (см. api.jobs.saveIntake).
  const fromCar = str(job?.mileage);
  if (!raw) return { ...base, mileage: fromCar };
  return {
    ...base,
    ...raw,
    status: ['open', 'done', 'skipped'].includes(raw.status) ? raw.status : 'open',
    mileage: str(raw.mileage) || fromCar,
    fuel: str(raw.fuel),
    keys: str(raw.keys),
    notes: str(raw.notes),
    docs: arr(raw.docs).map(str),
    equipment: arr(raw.equipment).map(str),
    checked: arr(raw.checked).map(str),
    damages: arr(raw.damages)
      .filter((d) => d && typeof d === 'object' && str(d.zone).trim())
      .map((d) => ({
        id: str(d.id) || str(d.zone),
        zone: str(d.zone),
        kind: str(d.kind) || DEFAULT_DAMAGE_KIND,
        note: str(d.note),
      })),
  };
}

// Машина вообще ни разу не открывалась приёмщиком? (Нужно, чтобы отличить
// «заехала до внедрения экрана» от «начали и бросили».)
export function isIntakeUntouched(job) {
  return !(job && job.intake && typeof job.intake === 'object');
}

// ─── Выбор шаблона ───────────────────────────────────────────────────────────

// Шаблон чек-листа для машины: сначала явно выбранный приёмщиком, иначе — по
// типу оплаты, иначе — универсальный (без payment_types), иначе — первый.
export function pickTemplate(job, settings) {
  const s = normalizeIntakeSettings(settings);
  const intake = readIntake(job);
  const byId = s.templates.find((t) => t.id === intake.template_id);
  if (byId) return byId;
  const pay = str(job?.payment_type) || 'cash';
  return (
    s.templates.find((t) => t.payment_types.includes(pay))
    || s.templates.find((t) => !t.payment_types.length)
    || s.templates[0]
  );
}

// ─── Готовность приёмки ──────────────────────────────────────────────────────

// Фото машины, относящиеся к приёмке, разложенные по рубрикам: { slotId: [фото] }.
export function intakePhotosBySlot(job) {
  const out = {};
  for (const p of arr(job?.photos)) {
    const slot = photoSlotId(p?.category);
    if (!slot) continue;
    (out[slot] || (out[slot] = [])).push(p);
  }
  return out;
}

// Полная сводка по одной машине: что заполнено, чего не хватает, можно ли
// закрывать приёмку. ЕДИНСТВЕННОЕ место, где живёт правило «что обязательно» —
// его читают и список машин (прогресс-бары), и кнопка «Завершить приёмку»,
// поэтому они не могут разойтись.
export function intakeStatus(job, settings) {
  const s = normalizeIntakeSettings(settings);
  const intake = readIntake(job);
  const tpl = pickTemplate(job, s);
  const items = tpl ? tpl.items : [];
  const checked = new Set(intake.checked);

  const checklistDone = items.filter((i) => checked.has(i.id)).length;
  const checklistMissing = items.filter((i) => i.required && !checked.has(i.id));

  const bySlot = intakePhotosBySlot(job);
  const slots = s.photo_slots.map((slot) => ({
    ...slot,
    count: (bySlot[slot.id] || []).length,
  }));
  const photosDone = slots.filter((slot) => slot.count > 0).length;
  const photosMissing = s.require_photos ? slots.filter((slot) => slot.required && !slot.count) : [];

  // Поля-обязаловка вне чек-листа: пробег нужен и в акте, и в смете.
  const fieldsMissing = [];
  if (s.require_mileage && !str(intake.mileage).trim()) fieldsMissing.push('Пробег');

  // Человекочитаемый список причин, почему кнопка «Завершить» ещё не горит.
  const blockers = [
    ...fieldsMissing,
    ...checklistMissing.map((i) => i.text),
    ...photosMissing.map((slot) => `Фото: ${slot.label}`),
  ];

  return {
    intake,
    template: tpl,
    items,
    slots,
    checklist: { done: checklistDone, total: items.length },
    photos: { done: photosDone, total: slots.length },
    damages: intake.damages.length,
    checklistMissing,
    photosMissing,
    fieldsMissing,
    blockers,
    ready: blockers.length === 0,
    done: intake.status === 'done',
    skipped: intake.status === 'skipped',
    untouched: isIntakeUntouched(job),
  };
}

// ─── Список машин на экране ──────────────────────────────────────────────────

// Сортировки списка — общий словарь для реального экрана и демо-страницы.
export const INTAKE_SORTS = [
  { id: 'urgent', label: 'Сначала просроченные' },
  { id: 'new', label: 'Сначала новые' },
  { id: 'plate', label: 'По госномеру' },
];

export const DAY_MS = 86400000;

// Полных дней между двумя моментами (ms). Не бывает отрицательным.
export function daysBetween(fromMs, toMs) {
  const a = Number(fromMs);
  const b = Number(toMs);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

// Машина стоит на приёмке? = согласование + под-статус «Осмотр / дефектовка».
// Пустой approval_status трактуем как 'inspection' — ровно так же, как доска
// «Согласование» (DEFAULT_APPROVAL_STATUS), иначе машина без статуса потерялась
// бы между двумя экранами.
export function isOnIntake(job) {
  if (!job || job.archived) return false;
  if (!isApproval(job)) return false;
  const st = str(job.approval_status) || INTAKE_APPROVAL_STATUS;
  return st === INTAKE_APPROVAL_STATUS;
}

// Светофор строки: сколько дней машина стоит с незакрытой приёмкой.
function severity(daysWaiting, done, s) {
  if (done) return 'done';
  if (daysWaiting >= s.alert_days) return 'alert';
  if (daysWaiting >= s.warn_days) return 'warn';
  return 'ok';
}

const SEVERITY_ORDER = { alert: 0, warn: 1, ok: 2, done: 3 };

// Вью-модель списка. `nowMs` передаём снаружи (Date.now() в рендере запрещён
// правилом чистоты проекта — см. Approval.jsx).
export function buildIntakeList(jobs, settings, { query = '', sort = 'urgent', nowMs = 0 } = {}) {
  const s = normalizeIntakeSettings(settings);
  const q = str(query).trim().toLowerCase();

  const rows = arr(jobs)
    .filter(isOnIntake)
    .map((job) => {
      const st = intakeStatus(job, s);
      const since = Number(job.approval_since || job.created_at) || 0;
      const daysWaiting = since ? daysBetween(since, nowMs) : 0;
      return {
        id: job.id,
        job,
        car_model: str(job.car_model) || 'Без модели',
        plate_number: str(job.plate_number),
        client_name: str(job.client_name),
        payment_type: str(job.payment_type) || 'cash',
        insurer_name: str(job.insurer_name),
        daysWaiting,
        severity: severity(daysWaiting, st.done || st.skipped, s),
        status: st,
      };
    })
    .filter((r) => {
      if (!q) return true;
      return [r.car_model, r.plate_number, r.client_name, r.insurer_name]
        .some((v) => v.toLowerCase().includes(q));
    });

  rows.sort((a, b) => {
    if (sort === 'plate') return a.plate_number.localeCompare(b.plate_number, 'ru');
    if (sort === 'new') return a.daysWaiting - b.daysWaiting;   // сначала только что заехавшие
    // 'urgent' (по умолчанию): сначала самые проблемные, внутри — кто дольше стоит.
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity) return bySeverity;
    return b.daysWaiting - a.daysWaiting;
  });

  const counts = {
    total: rows.length,
    ready: rows.filter((r) => r.status.ready && !r.status.done).length,
    done: rows.filter((r) => r.status.done || r.status.skipped).length,
    alert: rows.filter((r) => r.severity === 'alert').length,
  };

  return { rows, counts, settings: s };
}

// ─── Подписи для интерфейса и акта ───────────────────────────────────────────

const labelFrom = (list, id, fallback = '') => {
  const found = arr(list).find((x) => x && x.id === id);
  return found ? found.label : fallback;
};

export const fuelLabel = (id) => labelFrom(FUEL_LEVELS, id, '—');
export const damageKindLabel = (id) => labelFrom(DAMAGE_KINDS, id, '—');
export const zoneLabel = (zones, id) => labelFrom(zones, id, id || '—');

// Зоны, сгруппированные для колонок интерфейса: [{ group, zones: [...] }].
// Порядок групп — порядок первого появления в справочнике, чтобы правка списка
// в настройках сразу читалась в том же порядке на экране.
export function groupZones(zones) {
  const order = [];
  const map = new Map();
  for (const z of arr(zones)) {
    const g = str(z.group) || 'Прочее';
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    map.get(g).push(z);
  }
  return order.map((g) => ({ group: g, zones: map.get(g) }));
}

// Строки таблицы повреждений для печатного акта — уже с подписями, в порядке
// справочника зон (а не в порядке кликов приёмщика).
export function damageRows(intake, zones) {
  const index = new Map(arr(zones).map((z, i) => [z.id, i]));
  return arr(intake?.damages)
    .slice()
    .sort((a, b) => (index.get(a.zone) ?? 999) - (index.get(b.zone) ?? 999))
    .map((d) => ({
      zone: zoneLabel(zones, d.zone),
      kind: damageKindLabel(d.kind),
      note: str(d.note),
    }));
}

// ms → 'ГГГГ-ММ-ДД' в МЕСТНОМ времени (формат, который ждёт formatDocDate).
// Именно местное, а не UTC: сервис работает по Красноярску (UTC+7), и у ночной
// приёмки toISOString() напечатал бы в акте вчерашнее число.
function isoDay(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t) || !t) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Снимок для печатного акта приёмки. Как и у остальных документов проекта —
// «замороженные» данные, компонент листа ничего не дочитывает сам.
export function buildIntakeActSnapshot(job, settings, company, { docNumber = '', docDate = 0, acceptedBy = '' } = {}) {
  const s = normalizeIntakeSettings(settings);
  const intake = readIntake(job);
  const docSet = new Set(intake.docs);
  const eqSet = new Set(intake.equipment);
  return {
    doc_number: str(docNumber) || str(intake.act_number),
    doc_date: isoDay(Number(docDate) || Number(intake.act_date) || 0),
    accepted_by: str(acceptedBy),
    company: company || {},
    customer: {
      name: str(job?.client_name),
      phone: str(job?.client_phone),
    },
    vehicle: {
      car_model: str(job?.car_model),
      plate_number: str(job?.plate_number),
      vin: str(job?.vin),
      year: str(job?.year),
      color: str(job?.color),
    },
    insurance: {
      payment_type: str(job?.payment_type) || 'cash',
      insurer_name: str(job?.insurer_name),
      claim_number: str(job?.claim_number),
      policy_type: str(job?.policy_type),
      order_number: str(job?.order_number),
    },
    condition: {
      mileage: str(intake.mileage),
      fuel: str(intake.fuel),
      fuel_label: fuelLabel(intake.fuel),
      keys: str(intake.keys),
    },
    docs: s.docs.map((d) => ({ label: d.label, present: docSet.has(d.id) })),
    equipment: s.equipment.map((e) => ({ label: e.label, present: eqSet.has(e.id) })),
    damages: damageRows(intake, s.damage_zones),
    notes: str(intake.notes),
    act_text: str(s.act_text),
    photos_count: arr(job?.photos).filter((p) => photoSlotId(p?.category)).length,
  };
}
