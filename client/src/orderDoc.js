import { numberToWordsRu } from './rubleWords.js';
import { itemsForStream, orderMatchesStream, claimOf, streamOf } from './billing.js';

// Pure helpers for the заказ-наряд document. No React, no Firestore here.
// The whole point: buildOrderSnapshot() makes a fully self-contained COPY of
// the job's data (fresh objects, fresh ids), so editing the document can never
// reach back into the job / warehouse / gantt.

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function money(v) {
  return `${(Number(v) || 0).toLocaleString('ru-RU')} ₽`;
}

export function lineTotal(item) {
  return num(item.qty, 0) * num(item.price, 0);
}

// ===== Разделение позиций по потоку биллинга =====
// УСТАРЕЛО — оставлено как тонкая обёртка над billing.js, чтобы не держать в проекте
// две параллельные механики разделения. В НОВОМ КОДЕ зовите itemsForStream /
// orderMatchesStream напрямую.
//
// Разница ровно одна и она намеренная: старое правило «страховой поток = всё, что не
// client» подмешало бы в убыток №1 позиции убытка №2. Новое сопоставляет поток точно.
// На легаси-данных (payer только undefined | 'insurance' | 'client') результаты
// побуквенно совпадают — это закреплено тестом эквивалентности в billing.test.js.
//
//   recipient 'insurance' → убыток №1 (весь легаси: payer undefined | 'insurance')
//   recipient 'cl_*'      → конкретный убыток №2, №3, …
//   recipient 'client'    → только допродажи   (payer === 'client')
//   recipient 'all'       → все позиции        (обычная, не страховая машина)
export function itemsForRecipient(items = [], recipient = 'all') {
  return itemsForStream(items, recipient);
}

// Подходит ли сохранённый заказ-наряд под поток (для подстановки позиций в акт/счёт
// и в себестоимость). Старые ЗН без поля recipient трактуются как относящиеся к
// убытку №1 — до появления допродаж другого варианта и не было.
export function orderMatchesRecipient(doc, recipient) {
  return orderMatchesStream(doc, recipient);
}

// «Обновить карточку машины» из документа: спланировать, как перенести УСЛУГИ и
// ЗАПЧАСТИ из снапшота документа обратно в карточку (job), по семантике
// «Добавить и обновить, ничего не удалять» (выбор пользователя).
//
// ПОЧЕМУ так, а не «перезаписать job целиком»: позиции документа несут СВЕЖИЕ
// uid() и НЕ хранят метаданные запчасти (payer, поставщик, cost, статус закупки,
// receiving_log/фото приёмки, kind/аналог). Слепая перезапись сломала бы стабильный
// id (экран «Запчасти» молча перестаёт удалять/править), сбросила бы закупку и
// стёрла бы историю приёмки. Поэтому:
//   • услуги — целый массив, слитый по получателю (совпадение по названию → правим
//     цену/кол-во; новые дописываем; чужой поток и удалённые в документе не трогаем);
//   • запчасти — пооперационно: совпадение по «артикул+название» → savePart поверх
//     оригинала (metadata сохраняется), новые → savePart с новым id; ничего не
//     удаляем.
// Функция ЧИСТАЯ: возвращает план { services, partOps }, который вызывающий
// исполняет через api.jobs.update({services}) и api.jobs.savePart(...). `newId` —
// генератор id для новых запчастей (передайте genPartId).
//
// recipient — id потока (см. billing.js): 'insurance' | 'cl_*' | 'client' | 'all'.
//
// ОСТОРОЖНО С МЕТКОЙ НОВОЙ ПОЗИЦИИ. Раньше страховая ветка не писала payer ВООБЩЕ
// (тег ставился только допродажам) — и это работало, потому что «нет метки» = убыток
// №1. С несколькими убытками так больше нельзя: новая позиция из ЗН убытка №2 без
// метки молча упала бы в убыток №1 и уехала в страховую в чужом документе. Поэтому
// поток проставляем ЯВНО — и только в ветке НОВОЙ позиции: в ветке существующей
// `...orig` раскладывается первым и любая правка там затрёт метаданные (payer, cost,
// статус закупки, receiving_log) и сломает стабильный id.
export function planDocItemsToCar(job = {}, snapshot = {}, recipient = 'all', newId = uid) {
  // 'all' (обычная машина) метки не имеет и не должен её получать — иначе позиции
  // наличной машины внезапно станут «убытком №1».
  const tag = recipient === 'all' ? null : recipient;
  const tagged = tag ? { payer: tag } : {};
  const inScope = (x) => recipient === 'all' ? true : streamOf(x) === recipient;

  // --- УСЛУГИ: целый массив, «добавить + обновить», без удаления ---
  const svcKey = (s) => String((s && s.name) || '').trim().toLowerCase();
  const docServices = (snapshot.services || [])
    .map((s) => ({ name: String((s && s.name) || '').trim(), qty: num(s && s.qty, 1), price: num(s && s.price, 0) }))
    .filter((s) => s.name);
  const outOfScopeServices = (job.services || []).filter((s) => !inScope(s));
  const scopeServices = (job.services || []).filter(inScope).map((s) => ({ ...s }));
  const usedSvc = new Set();
  const newServices = [];
  for (const ds of docServices) {
    const k = svcKey(ds);
    const idx = scopeServices.findIndex((s, i) => !usedSvc.has(i) && svcKey(s) === k);
    if (idx >= 0) {
      usedSvc.add(idx);
      scopeServices[idx] = { ...scopeServices[idx], name: ds.name, qty: ds.qty, price: ds.price };
    } else {
      newServices.push({ name: ds.name, qty: ds.qty, price: ds.price, ...tagged });
    }
  }
  const services = [...outOfScopeServices, ...scopeServices, ...newServices];

  // --- ЗАПЧАСТИ: пооперационно, «добавить + обновить», без удаления ---
  const partKey = (p) => `${String((p && p.code) || '').trim().toLowerCase()}|${String((p && p.name) || '').trim().toLowerCase()}`;
  const origByKey = new Map();
  for (const p of (job.parts || []).filter(inScope)) {
    const k = partKey(p);
    if (!origByKey.has(k)) origByKey.set(k, p); // первый выигрывает
  }
  const usedKeys = new Set();
  const partOps = [];
  for (const dp of (snapshot.parts || [])) {
    const code = String((dp && dp.code) || '').trim();
    const name = String((dp && dp.name) || '').trim();
    if (!code && !name) continue; // пустую строку не пишем
    const k = `${code.toLowerCase()}|${name.toLowerCase()}`;
    const orig = usedKeys.has(k) ? undefined : origByKey.get(k);
    if (orig) {
      usedKeys.add(k);
      // ...orig ПЕРВЫМ — сохраняем payer/kind/поставщика/cost/статус/receiving_log;
      // savePart всё равно пересчитает receiving_log на сервере и синхронизирует склад.
      partOps.push({ ...orig, id: orig.id, code, name, qty: num(dp.qty, 1), unit: dp.unit || 'шт.', price: num(dp.price, 0) });
    } else {
      partOps.push({
        id: newId(), code, name, qty: num(dp.qty, 1), unit: dp.unit || 'шт.', price: num(dp.price, 0),
        kind: dp.kind || 'new', replArticle: dp.replArticle || '', status: 'need',
        ...tagged,
      });
    }
  }
  return { services, partOps };
}

// ===== Автонумерация документов =====
// Формат: ПРЕФИКС-ГОД-NNNN (напр. ЗН-2026-0007). У каждого типа документа — своя
// годовая очередь; сам порядковый номер выдаёт атомарный счётчик в Firestore
// (см. api.counters, api.jobs.create, api.orderDocuments.create). Здесь только
// чистое форматирование — чтобы покрыть тестами без обращения к базе.
// `invoice` (СЧ) — счёт КЛИЕНТУ (доход). `supplier` (СП) — счёт ПОСТАВЩИКА на
// запчасти, который оплачивает учредитель (расход). Разные документы, не путать.
export const DOC_PREFIX = { order: 'ЗН', act: 'АКТ', invoice: 'СЧ', handover: 'ПП', purchase: 'ЗАК', supplier: 'СП' };

export function pad4(n) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(4, '0');
}

export function formatDocNumber(type, year, n) {
  return `${DOC_PREFIX[type] || 'ДОК'}-${year}-${pad4(n)}`;
}

export const DEFAULT_WARRANTY =
  'Гарантия на выполненные работы — 6 месяцев, на кузовные и окрасочные работы — ' +
  '12 месяцев с даты выдачи ТС. Гарантия не распространяется на детали и материалы, ' +
  'предоставленные Заказчиком, а также на повреждения, возникшие вследствие эксплуатации ' +
  'с нарушением рекомендаций, ДТП или естественного износа.';

export const DEFAULT_CONSENT =
  'Заказчик ознакомлен и согласен с перечнем, стоимостью и сроками работ, указанными ' +
  'в настоящем заказ-наряде. Заказчик уведомлён, что в ходе выполнения работ может ' +
  'потребоваться проведение дополнительных работ и замена дополнительных запчастей, о чём ' +
  'Исполнитель обязуется предварительно проинформировать Заказчика. Заказчик подтверждает ' +
  'передачу транспортного средства в ремонт и достоверность указанных сведений. Настоящий ' +
  'заказ-наряд является основанием для выполнения работ и расчётов между сторонами; после ' +
  'подписания сторонами имеет силу договора.';

// «Согласование по запчастям» — строки для заказ-наряда и акта. Письменного
// согласия клиента в документе требуют ТОЛЬКО Б/У (used) и Замена на аналог
// (analog). Виды «под оригинал» (used_orig / analog_orig) — это внутренняя
// подготовка детали к товарному виду; в документ они НЕ выносятся (только
// предупреждение в карточке авто). Возвращает готовый текст (строки через \n),
// пустую строку — если таких запчастей нет. Требует поле p.kind у деталей.
export function partsConsentLines(parts = []) {
  const lines = [];
  for (const p of parts || []) {
    const name = String(p.name || '').trim() || 'запчасть';
    const code = String(p.code || '').trim();
    const repl = String(p.replArticle || '').trim();
    if (p.kind === 'used') {
      lines.push(`Запчасть «${name}»${code ? ` (арт. ${code})` : ''} устанавливается бывшей в употреблении (Б/У) с согласия Заказчика.`);
    } else if (p.kind === 'analog') {
      lines.push(`Оригинальная запчасть «${name}»${code ? ` (арт. ${code})` : ''} заменена на аналог${repl ? ` (арт. ${repl})` : ''} с согласия Заказчика.`);
    }
  }
  return lines;
}

export function buildPartsConsentText(parts = []) {
  return partsConsentLines(parts).join('\n');
}

function pad2(x) {
  return String(x).padStart(2, '0');
}

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoToDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// "2026-07-01" -> "01.07.2026"
export function formatDocDate(input) {
  if (!input) return '—';
  const [y, m, d] = String(input).split('-');
  if (!y || !m || !d) return input;
  return `${d}.${m}.${y}`;
}

// Payer / insurance block copied onto every document snapshot. `recipient` — это id
// ПОТОКА БИЛЛИНГА (см. billing.js): конкретный убыток ('insurance' | 'cl_*'),
// допродажи клиента ('client') или 'all' для обычной машины. Документ «клиенту»
// (допродажи) — это обычный клиентский счёт, поэтому страховой блок и франшиза в нём
// НЕ печатаются, даже если сама машина страховая.
//
// У КАЖДОГО УБЫТКА СВОИ реквизиты: страховая, № убытка, тип полиса, франшиза. Берём
// их из claimOf(job, recipient), а не из плоских полей машины — иначе ЗН убытка №2
// ушёл бы в страховую с номером убытка №1.
function insuranceFrom(job, recipient = 'all') {
  if (recipient === 'client') {
    return { payment_type: 'cash', insurer_name: '', claim_number: '', policy_type: '', franchise: 0 };
  }
  const claim = claimOf(job, recipient);
  return {
    payment_type: job.payment_type || 'cash',
    insurer_name: (claim && claim.insurer_name) || '',
    claim_number: (claim && claim.claim_number) || '',
    policy_type: (claim && claim.policy_type) || '',
    // Франшиза — часть стоимости ремонта, которую по договору со страховой платит
    // сам клиент; остальное покрывает страховая. Своя у каждого дела. Замораживается
    // в документе, как и прочие данные плательщика (см. предупреждение в CarCard.saveInfo).
    franchise: num(claim && claim.franchise, 0),
  };
}

// Номер заказ-наряда потока. У каждого убытка СВОЙ номер из годовой очереди
// (ЗН-2026-0007 у дела №1, ЗН-2026-0042 у дела №2) — страховая заводит дело по
// номеру ЗН, поэтому два дела с одним номером недопустимы. Допродажи печатаются под
// номером убытка №1 (номер редактируется вручную — так было и до убытков).
function orderNumberFor(job, recipient = 'all') {
  const claim = claimOf(job, recipient);
  return (claim && claim.order_number) || job.order_number
    || `ЗН-${String(job.id || '').slice(0, 6).toUpperCase()}`;
}

// Скидка потока: своя у каждого убытка. У допродаж скидки нет (их и раньше не было).
function discountFor(job, recipient = 'all') {
  if (recipient === 'client') return 0;
  const claim = claimOf(job, recipient);
  return num(claim ? claim.discount : job.discount, 0);
}

// Build the auto-filled snapshot from the job + company settings. Every array
// item is a brand-new object with a fresh id — no shared references with `job`.
// `recipient` (см. itemsForRecipient) выбирает, чьи позиции войдут в документ:
// страховой ремонт, допродажи клиента или (для не-страховых машин) всё сразу.
export function buildOrderSnapshot(job = {}, company = {}, recipient = 'all') {
  const srcServices = itemsForStream(job.services, recipient);
  const srcParts = itemsForStream(job.parts, recipient);
  return {
    type: 'order',
    recipient,
    insurance: insuranceFrom(job, recipient),
    job_id: job.id || null,
    doc_number: orderNumberFor(job, recipient),
    doc_date: todayInput(),
    planned_ready_at: isoToDateInput(job.deadline) || isoToDateInput(job.expected_at) || '',
    company: {
      name: company.name || '',
      inn: company.inn || '',
      ogrn: company.ogrn || '',
      address: company.address || '',
      phone: company.phone || '',
      director: company.director || '',
    },
    customer: {
      name: job.client_name || '',
      phone: job.client_phone || '',
    },
    vehicle: {
      car_model: job.car_model || '',
      plate_number: job.plate_number || '',
      vin: job.vin || '',
      year: job.year || '',
      mileage: job.mileage || '',
    },
    reason: job.reason || '',
    services: srcServices.map((s) => ({
      id: uid(),
      name: s.name || '',
      qty: num(s.qty, 1),
      price: num(s.price, 0),
    })),
    parts: srcParts.map((p) => ({
      id: uid(),
      code: p.code || '',
      name: p.name || '',
      qty: num(p.qty, 1),
      unit: p.unit || 'шт.',
      price: num(p.price, 0),
      // kind/replArticle не печатаются в таблице, но нужны, чтобы пересобрать
      // блок «Согласование по запчастям» и чтобы он пережил перенос в акт.
      kind: p.kind || 'new',
      replArticle: p.replArticle || '',
    })),
    discount: discountFor(job, recipient),
    discount_mode: 'rub',
    discount_pct: 0,
    prepayment: num(job.prepayment, 0),
    recommendations: job.recommendations || '',
    warranty_text: DEFAULT_WARRANTY,
    consent_text: DEFAULT_CONSENT,
    parts_consent_text: buildPartsConsentText(srcParts),
    show_recommendations: !!(job.recommendations && String(job.recommendations).trim()),
    show_warranty: true,
    show_consent: true,
    show_parts_consent: !!buildPartsConsentText(srcParts),
  };
}

// База, от которой считается ПРОЦЕНТ скидки. У страховых ремонтов скидка даётся
// НА ЗАПЧАСТИ: их стоимость страховая согласовывает, а работы считает по своему
// справочнику. У наличных и юрлиц — на весь ремонт, работы плюс запчасти.
// Рублёвой скидки не касается: там сумма задана прямо.
export function discountBaseFor(paymentType, services_sum = 0, parts_sum = 0) {
  return paymentType === 'insurance' ? parts_sum : services_sum + parts_sum;
}
export function discountBase(snapshot = {}, services_sum = 0, parts_sum = 0) {
  return discountBaseFor((snapshot.insurance || {}).payment_type, services_sum, parts_sum);
}
// Подпись базы для печати: «Скидка 10%» у страхового ремонта без уточнения читается
// как процент от всего ремонта, хотя считается от запчастей.
export function discountBaseLabel(snapshot = {}) {
  return (snapshot.insurance || {}).payment_type === 'insurance' ? 'на запчасти' : '';
}

// Скидку можно задавать в рублях (discount_mode 'rub', поле discount) ИЛИ процентом
// от базы (discount_mode 'pct', поле discount_pct; база — см. discountBase). В любом
// случае возвращаем discount как РУБЛИ (эффективную сумму) — так печать, costing
// (читает order.discount рублями) и старые сохранённые документы работают без
// изменений. discount_mode/discount_pct отдаём отдельно — чтобы на листе печатать
// «Скидка 10%». Потолок — subtotal: скидка не может превысить весь ремонт.
export function resolveDiscount(snapshot = {}, subtotal = 0, base = null) {
  const mode = snapshot.discount_mode === 'pct' ? 'pct' : 'rub';
  const pct = mode === 'pct' ? Math.min(100, Math.max(0, num(snapshot.discount_pct, 0))) : 0;
  const pctBase = base === null ? subtotal : base;
  const raw = mode === 'pct' ? (pctBase * pct) / 100 : num(snapshot.discount, 0);
  const amount = Math.min(subtotal, Math.max(0, Math.round(raw)));
  return { mode, pct, amount, base: pctBase };
}

export function computeOrderTotals(snapshot = {}) {
  const sum = (arr) => (arr || []).reduce((s, it) => s + num(it.qty, 0) * num(it.price, 0), 0);
  const services_sum = sum(snapshot.services);
  const parts_sum = sum(snapshot.parts);
  const subtotal = services_sum + parts_sum;
  const d = resolveDiscount(snapshot, subtotal, discountBase(snapshot, services_sum, parts_sum));
  const discount = d.amount;
  const total = Math.max(0, subtotal - discount);
  const prepayment = num(snapshot.prepayment, 0);
  const due = Math.max(0, total - prepayment);
  // Франшиза — только для страховых ремонтов. Сумму берём из блока insurance,
  // ограничиваем сверху итогом (страховая не может «доплатить» меньше нуля).
  const isIns = (snapshot.insurance || {}).payment_type === 'insurance';
  const franchise = isIns ? Math.min(total, num((snapshot.insurance || {}).franchise, 0)) : 0;
  const insurer_pays = isIns ? Math.max(0, total - franchise) : 0;
  // Сумма К ОПЛАТЕ ПО СЧЁТУ: счёт страховому уходит БЕЗ франшизы (её клиент платит
  // сам), поэтому payable = total − франшиза; для обычных машин payable = total.
  // total при этом остаётся ПОЛНОЙ стоимостью ремонта (ЗН/акт печатают её).
  const payable = isIns && franchise > 0 ? insurer_pays : total;
  const payable_due = Math.max(0, payable - prepayment);
  return { services_sum, parts_sum, subtotal, discount, discount_mode: d.mode, discount_pct: d.pct, discount_base: d.base, discount_base_label: discountBaseLabel(snapshot), total, prepayment, due, franchise, insurer_pays, payable, payable_due, total_words: numberToWordsRu(total) };
}

// ===== Акт выполненных работ / Акт приёма-передачи / Счёт на оплату =====
// Same isolation guarantee as buildOrderSnapshot: deep-copied arrays, fresh ids,
// stored in the orderDocuments collection with a distinct `type`. The заказ-наряд
// (buildOrderSnapshot / OrderDocument) is left untouched.

export const DEFAULT_ACT_TEXT =
  'Работы выполнены в полном объёме, в согласованные сроки и с надлежащим качеством. ' +
  'Заказчик к объёму, качеству и срокам выполненных работ претензий не имеет. Настоящий акт ' +
  'является основанием для окончательного расчёта между сторонами.';

export const DEFAULT_HANDOVER_TEXT =
  'Транспортное средство осмотрено сторонами. Стороны подтверждают соответствие фактического ' +
  'состояния, комплектности и показаний одометра сведениям, указанным в настоящем акте. ' +
  'Настоящий акт подтверждает факт приёма-передачи транспортного средства.';

// Текст для акта на ПРИЁМ авто в сервис (клиент сдаёт, сервис принимает).
export const DEFAULT_INTAKE_TEXT =
  'Транспортное средство передано Заказчиком и принято Исполнителем для проведения ремонтных ' +
  'работ / обслуживания. Стороны подтверждают соответствие фактического состояния, комплектности ' +
  'и показаний одометра сведениям, указанным в настоящем акте. Претензий к состоянию ТС на момент ' +
  'приёма стороны не имеют.';

export const DEFAULT_INVOICE_NOTE =
  'Оплата настоящего счёта означает согласие с условиями оказания услуг. Счёт действителен ' +
  'к оплате в течение 5 банковских дней. Услуги/товары отпускаются по факту поступления оплаты.';

function baseHead(job, company, type, recipient = 'all') {
  return {
    type,
    recipient,
    insurance: insuranceFrom(job, recipient),
    job_id: job.id || null,
    // Пустой номер = «присвоить автоматически при первом сохранении» (свой счётчик
    // на тип+год, см. api.orderDocuments.create). Вручную вписанный номер сохраняется
    // как есть. Заказ-наряд — исключение (buildOrderSnapshot): печатается под номером
    // машины job.order_number.
    doc_number: '',
    doc_date: todayInput(),
    company: {
      name: company.name || '', inn: company.inn || '', kpp: company.kpp || '',
      ogrn: company.ogrn || '', address: company.address || '', phone: company.phone || '',
      director: company.director || '',
    },
    customer: { name: job.client_name || '', phone: job.client_phone || '' },
    vehicle: {
      car_model: job.car_model || '', plate_number: job.plate_number || '',
      vin: job.vin || '', year: job.year || '', mileage: job.mileage || '',
    },
  };
}

function mapServices(arr) {
  return (arr || []).map((s) => ({ id: uid(), name: s.name || '', qty: num(s.qty, 1), price: num(s.price, 0) }));
}
function mapParts(arr) {
  return (arr || []).map((p) => ({ id: uid(), code: p.code || '', name: p.name || '', qty: num(p.qty, 1), unit: p.unit || 'шт.', price: num(p.price, 0), kind: p.kind || 'new', replArticle: p.replArticle || '' }));
}

// Seed works/parts for act & invoice from the LAST issued заказ-наряд of the SAME
// recipient (docs from api.orderDocuments.listByJob, newest-first); fall back to
// the car's own data filtered to that recipient. `recipient` (см. itemsForRecipient)
// keeps a страховой акт/счёт separate from a клиентский (допродажи) one.
export function pickSeedItems(job = {}, docs = [], recipient = 'all') {
  const lastOrder = (docs || []).find((d) => d.type === 'order' && orderMatchesStream(d, recipient));
  if (lastOrder && ((lastOrder.services || []).length || (lastOrder.parts || []).length)) {
    return {
      services: lastOrder.services || [], parts: lastOrder.parts || [],
      discount: num(lastOrder.discount, 0),
      discount_mode: lastOrder.discount_mode === 'pct' ? 'pct' : 'rub',
      discount_pct: num(lastOrder.discount_pct, 0),
      prepayment: num(lastOrder.prepayment, 0),
      source: 'order', source_number: lastOrder.doc_number || '',
    };
  }
  return {
    services: itemsForStream(job.services, recipient), parts: itemsForStream(job.parts, recipient),
    // Скидка из Audatex относится к страховому ремонту — на допродажи её не переносим.
    // У каждого убытка своя скидка (см. discountFor).
    discount: discountFor(job, recipient), discount_mode: 'rub', discount_pct: 0,
    prepayment: num(job.prepayment, 0),
    source: 'job', source_number: '',
  };
}

export function buildActSnapshot(job = {}, company = {}, seed = null, recipient = 'all') {
  const s = seed || pickSeedItems(job, [], recipient);
  const parts = mapParts(s.parts);
  return {
    ...baseHead(job, company, 'act', recipient),
    // «Основание» — номер ЗН СВОЕГО убытка (у каждого дела он свой), а не машины.
    order_ref: s.source_number || orderNumberFor(job, recipient) || '',
    services: mapServices(s.services),
    parts,
    discount: num(s.discount, 0),
    discount_mode: s.discount_mode === 'pct' ? 'pct' : 'rub',
    discount_pct: num(s.discount_pct, 0),
    prepayment: num(s.prepayment, 0),
    recommendations: job.recommendations || '',
    act_text: DEFAULT_ACT_TEXT,
    warranty_text: DEFAULT_WARRANTY,
    // Собираем из позиций акта (kind перенесён из заказ-наряда/машины) — тот же
    // блок «Согласование по запчастям», что и в заказ-наряде.
    parts_consent_text: buildPartsConsentText(parts),
    show_act_text: true,
    show_warranty: true,
    show_recommendations: !!(job.recommendations && String(job.recommendations).trim()),
    show_parts_consent: !!buildPartsConsentText(parts),
  };
}

export function buildInvoiceSnapshot(job = {}, company = {}, seed = null, recipient = 'all') {
  const s = seed || pickSeedItems(job, [], recipient);
  const head = baseHead(job, company, 'invoice', recipient);
  head.company.bank = {
    bank_name: company.bank_name || '', bik: company.bik || '',
    account: company.account || '', corr_account: company.corr_account || '',
  };
  return {
    ...head,
    // «Основание» — номер ЗН СВОЕГО убытка (у каждого дела он свой), а не машины.
    order_ref: s.source_number || orderNumberFor(job, recipient) || '',
    services: mapServices(s.services),
    parts: mapParts(s.parts),
    discount: num(s.discount, 0),
    discount_mode: s.discount_mode === 'pct' ? 'pct' : 'rub',
    discount_pct: num(s.discount_pct, 0),
    // Предоплата переносится из заказ-наряда: в счёте печатаются строки «Предоплата»
    // и «К доплате», чтобы клиент оплатил остаток, а не всю сумму повторно. Это же
    // «к доплате» согласовано с кассой/долгом (computeCashFlow вычитает предоплату).
    prepayment: num(s.prepayment, 0),
    vat_mode: company.vat_mode === 'vat20' ? 'vat20' : 'none',
    invoice_note: DEFAULT_INVOICE_NOTE,
    show_invoice_note: true,
    show_qr: true,
    paid: false,
    paid_at: null,
  };
}

// direction: 'intake' — приём авто в сервис (Заказчик сдаёт, Исполнитель принимает),
// 'issue' — выдача клиенту (Исполнитель сдаёт, Заказчик принимает). У ранее сохранённых
// актов поля direction нет — DocSheet трактует их как выдачу (прежнее поведение).
export function buildHandoverSnapshot(job = {}, company = {}, recipient = 'all', direction = 'intake') {
  const isIntake = direction !== 'issue';
  return {
    ...baseHead(job, company, 'handover', recipient),
    direction: isIntake ? 'intake' : 'issue',
    condition: {
      mileage_in: job.mileage || '', equipment: job.equipment || '', condition_in: job.condition_in || '',
      mileage_out: job.mileage_out || '', condition_out: job.condition_out || '',
    },
    handover_text: isIntake ? DEFAULT_INTAKE_TEXT : DEFAULT_HANDOVER_TEXT,
    show_handover_text: true,
    // Приём — только блок «При приёме»; выдача — оба блока (для сверки состояния «до/после»).
    show_intake: true,
    show_issue: !isIntake,
  };
}

// Totals with VAT for the счёт. VAT 20% is treated as INCLUDED in the total
// ("в том числе НДС"), which is the usual case when prices already include tax.
export function computeDocTotals(snapshot = {}) {
  const base = computeOrderTotals(snapshot);
  const vat_mode = snapshot.vat_mode === 'vat20' ? 'vat20' : 'none';
  const vat_amount = vat_mode === 'vat20' ? Math.round((base.total * 20 / 120) * 100) / 100 : 0;
  return { ...base, vat_mode, vat_amount };
}

// Standard Russian payment QR (ГОСТ Р 56042-2014) — scannable in banking apps.
export function buildPaymentQrString(snapshot = {}) {
  const c = snapshot.company || {};
  const bank = c.bank || {};
  const totals = computeDocTotals(snapshot);
  const fields = [];
  const add = (k, v) => { if (v) fields.push(`${k}=${String(v).replace(/[|=]/g, ' ').trim()}`); };
  add('Name', c.name);
  add('PersonalAcc', bank.account);
  add('BankName', bank.bank_name);
  add('BIC', bank.bik);
  add('CorrespAcc', bank.corr_account);
  add('PayeeINN', c.inn);
  add('KPP', c.kpp);
  // Encode the amount actually left to pay so the banking app pre-fills exactly
  // what the счёт prints: payable_due = (total − франшиза, если страховая) − предоплата.
  const payable = totals.payable_due != null ? totals.payable_due : (totals.due != null ? totals.due : totals.total);
  const kopecks = Math.round((payable || 0) * 100);
  if (kopecks > 0) add('Sum', String(kopecks));
  add('Purpose', `Оплата по счёту № ${snapshot.doc_number || ''} от ${formatDocDate(snapshot.doc_date)}`);
  return `ST00012|${fields.join('|')}`;
}

// Does this payment QR have enough to be scannable? (requisites filled)
export function qrIsComplete(snapshot = {}) {
  const c = snapshot.company || {};
  const bank = c.bank || {};
  return !!(c.name && c.inn && bank.account && bank.bik && bank.bank_name && bank.corr_account);
}
