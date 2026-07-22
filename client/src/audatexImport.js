// Приведение распознанной калькуляции Audatex (см. audatexParse.js) к строкам
// таблиц карточки автомобиля.
//
// Модуль ЧИСТЫЙ и без зависимостей: pdfjs и разбор PDF остаются в audatexParse.js,
// сюда приходит уже разобранный объект {services, parts, vehicle, meta}. Поэтому
// правила «что берём в таблицу» покрыты node-тестами (audatexImport.test.js).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ: одну и ту же калькуляцию грузят В ДВУХ местах карточки —
// при заведении машины и в убыток УЖЕ заведённой (страховая завела второе дело по
// той же машине). Правило должно быть одно на оба места, потому что цена ошибки
// разная только на вид: у каждой запчасти обязан быть стабильный id, иначе правка
// и удаление на экране «Запчасти» молча ломаются (см. parts.js / withPartIds).

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const money = (n) => `${Math.round(num(n)).toLocaleString('ru-RU')} ₽`;

// Работы калькуляции → строки таблицы «Работы». Строки без названия отбрасываем:
// парсер иногда отдаёт пустую строку-разделитель, а пустая работа в заказ-наряде —
// это пустая строка в документе для страховой.
export function audatexServiceRows(data, genId) {
  return (data?.services || [])
    .filter((s) => String(s?.name || '').trim())
    .map((s) => ({
      id: genId(),
      name: String(s.name).trim(),
      qty: num(s.qty, 1) || 1,
      price: num(s.price, 0),
    }));
}

// Запчасти калькуляции → строки таблицы «Запчасти». Позицию берём, если есть хотя
// бы название ИЛИ артикул: в калькуляциях встречается и то и другое по отдельности
// (артикул без названия — это «прочее» из сметы, его всё равно надо купить).
export function audatexPartRows(data, genId) {
  return (data?.parts || [])
    .filter((p) => String(p?.name || '').trim() || String(p?.code || '').trim())
    .map((p) => ({
      id: genId(),
      code: String(p.code || '').trim(),
      name: String(p.name || '').trim(),
      qty: num(p.qty, 1) || 1,
      unit: p.unit || 'шт.',
      price: num(p.price, 0),
    }));
}

// Строка отчёта «что распознали» — одна на оба места импорта, чтобы приёмщик
// видел одно и то же независимо от того, где грузил файл. Считаем по данным
// ПАРСЕРА (а не по отфильтрованным строкам): расхождение с итогом Audatex должно
// быть заметно, а не сглажено.
export function audatexSummary(data) {
  const v = data?.vehicle || {};
  const meta = data?.meta || {};
  const bits = [];
  if (v.car_model) bits.push(v.car_model);
  bits.push(`работ: ${(data?.services || []).length}`);
  bits.push(`запчастей: ${(data?.parts || []).length}`);
  if (meta.hasPaint) bits.push('краска: да');
  if (num(meta.discount) > 0) bits.push(`скидка: ${money(meta.discount)}`);
  if (num(meta.repair_total) > 0) bits.push(`итог: ${money(meta.repair_total)}`);
  return bits.join(' · ');
}
