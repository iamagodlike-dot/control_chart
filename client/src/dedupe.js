// Поиск дублей машин и подготовка сращивания. Дубль = одна и та же машина,
// заведённая дважды (например, страховой ремонт + отдельная карточка под
// допродажи клиента). Матчим по нормализованному ГОС.НОМЕРУ. Чистые функции —
// без React/Firestore, покрыты тестами. Само сращивание (запись в Firestore)
// делает компонент DuplicateCars через api.jobs.

// Русские номера пишут кириллицей или латиницей-двойником (А↔A, В↔B, …), плюс
// по-разному ставят пробелы/регион. Приводим к канону: верхний регистр, только
// буквы/цифры, кириллические двойники → латиница. «А123ВС 96» и «a123bc96» → «A123BC96».
const CYR2LAT = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };

export function normalizePlate(plate) {
  const up = String(plate || '').toUpperCase();
  let out = '';
  for (const ch of up) {
    if (CYR2LAT[ch]) out += CYR2LAT[ch];
    else if (ch >= 'A' && ch <= 'Z') out += ch;
    else if (ch >= '0' && ch <= '9') out += ch;
    // всё прочее (пробелы, дефисы, регионные разделители) выбрасываем
  }
  return out;
}

// Основная (в которую сращиваем) по умолчанию: страховая машина; если страховой
// нет — самая старая (по created_at). Именно её позиции остаются «страховыми», а
// позиции остальных карточек группы добавятся к ней как допродажи клиента.
export function suggestPrimaryId(cars = []) {
  const ins = cars.find((c) => c && c.payment_type === 'insurance');
  if (ins) return ins.id;
  const oldest = cars.slice().sort((a, b) => (a.created_at || 0) - (b.created_at || 0))[0];
  return oldest ? oldest.id : null;
}

// Сгруппировать активные машины по нормализованному гос.номеру и вернуть только
// группы, где машин 2+ (кандидаты в дубли). Архивные и без номера — пропускаем.
// Внутри группы машины отсортированы по дате создания (старые сверху); группы —
// по числу машин (крупные сверху). Каждой группе проставлен suggestedPrimaryId.
export function findDuplicateGroups(jobs = []) {
  const byPlate = new Map();
  for (const j of jobs || []) {
    if (!j || j.archived) continue;
    const key = normalizePlate(j.plate_number);
    if (!key) continue;
    if (!byPlate.has(key)) byPlate.set(key, []);
    byPlate.get(key).push(j);
  }
  const groups = [];
  for (const [key, list] of byPlate) {
    if (list.length < 2) continue;
    const cars = list.slice().sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    groups.push({ key, plate: cars[0].plate_number || '', cars, suggestedPrimaryId: suggestPrimaryId(cars) });
  }
  groups.sort((a, b) => b.cars.length - a.cars.length || String(a.plate).localeCompare(String(b.plate), 'ru'));
  return groups;
}

const numOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// Сколько позиций перенесётся при сращивании (для превью в диалоге).
export function mergePreview(primary, dups = []) {
  let services = 0;
  let parts = 0;
  for (const d of dups) {
    services += (d.services || []).length;
    parts += (d.parts || []).length;
  }
  return { services, parts, cars: dups.length };
}

// Позиции-работы дубля, помеченные плательщиком для основной машины: для страховой
// основной — «допродажи клиента» (payer:'client'), иначе — обычные (без метки).
// Id генерит вызывающий (нужен uniq в Firestore); здесь — чистое преобразование.
export function tagServicesForPrimary(services = [], primaryIsInsurance) {
  return (services || []).map((s) => ({
    name: s.name || '',
    qty: numOr(s.qty, 1),
    price: numOr(s.price, 0),
    ...(primaryIsInsurance ? { payer: 'client' } : {}),
  }));
}
