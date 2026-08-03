import { numberToWordsRu } from './rubleWords.js';
import { itemsForStream, orderMatchesStream, claimOf, streamOf, STREAM_ALL, STREAM_CLIENT, STREAM_INSURANCE } from './billing.js';

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

// Пробег у машины ОДИН — и в заказ-наряде, и в акте при приёме, и при выдаче:
// между приёмом и выдачей она не ездит. Основное место хранения — карточка
// (job.mileage); запасные — экран «Приёмка авто» (машина заезжала через него, а в
// карточку пробег ещё не перенесли) и старое поле «пробег при выдаче».
export function jobMileage(job = {}) {
  const intake = job && typeof job.intake === 'object' && job.intake ? job.intake : null;
  return String(job.mileage || (intake && intake.mileage) || job.mileage_out || '').trim();
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

// Ключи «на глаз» — ими сопоставляются позиции СТАРЫХ документов, у которых нет
// обратной ссылки src_id (см. matchDocRows).
const svcKeyOf = (s) => String((s && s.name) || '').trim().toLowerCase();
const partKeyOf = (p) => `${String((p && p.code) || '').trim().toLowerCase()}|${String((p && p.name) || '').trim().toLowerCase()}`;

// Сопоставление строк документа с позициями карточки. ДВА ПРОХОДА, и порядок важен:
//   1) по обратной ссылке src_id — она указывает на id позиции карточки, из которой
//      строка документа выросла. Именно это делает ПЕРЕИМЕНОВАНИЕ безопасным: поправили
//      название в документе — позиция в карточке переименуется, а не задвоится;
//   2) по названию (услуги) / «артикул+название» (запчасти) — для документов, выданных
//      до появления src_id, и для строк, добавленных в документе руками: если такая
//      строка совпала с существующей позицией, обновляем её, а не плодим дубль.
// Одна позиция карточки может быть занята только ОДНОЙ строкой документа (taken) —
// иначе две одинаковые строки документа затёрли бы друг друга в одной позиции.
// Возвращает pairs: индекс строки документа → индекс позиции карточки.
function matchDocRows(docRows, cardRows, keyOf, emptyKey) {
  const taken = new Set();
  const pairs = new Map();
  docRows.forEach((d, di) => {
    if (!d.src_id) return;
    const i = cardRows.findIndex((c, ci) => !taken.has(ci) && c && c.id === d.src_id);
    if (i >= 0) { taken.add(i); pairs.set(di, i); }
  });
  docRows.forEach((d, di) => {
    if (pairs.has(di)) return;
    const k = keyOf(d);
    if (!k || k === emptyKey) return;
    const i = cardRows.findIndex((c, ci) => !taken.has(ci) && keyOf(c) === k);
    if (i >= 0) { taken.add(i); pairs.set(di, i); }
  });
  return { pairs, taken };
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
//   • услуги — целый массив, слитый по получателю (совпадение → правим название/цену/
//     кол-во; новые дописываем; чужой поток и удалённые в документе не трогаем);
//   • запчасти — пооперационно: совпадение → savePart поверх оригинала (metadata
//     сохраняется), новые → savePart с новым id; ничего не удаляем.
// Функция ЧИСТАЯ: возвращает план { services, partOps, links, summary }, который
// вызывающий исполняет через api.jobs.update({services}) и api.jobs.savePart(...).
// `newId` — генератор id для новых позиций (передайте genPartId).
//
//   links   — id строки документа → id позиции карточки. Редактор записывает их обратно
//             в снапшот как src_id: без этого строка, ДОБАВЛЕННАЯ в документе, остаётся
//             без ссылки, и её последующее переименование опять создало бы дубль.
//   summary — что именно произойдёт (обновим / добавим / переименуем / останется в
//             карточке). Показывается в подтверждении, см. describeDocToCarPlan.
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
  const links = { services: {}, parts: {} };

  // id новой позиции. Если строка документа помнит src_id, а позиции с таким id в
  // карточке больше нет (её удалили на экране «Запчасти»), переиспользуем ЭТОТ id:
  // тогда повторное нажатие «Обновить карточку» найдёт её по ссылке и обновит, а не
  // создаст второй дубль. Занятый id переиспользовать нельзя — savePart затёр бы
  // позицию ЧУЖОГО потока (её сюда не пустил inScope, но в job.parts она есть).
  const takenSvcIds = new Set((job.services || []).map((s) => s && s.id).filter(Boolean));
  const takenPartIds = new Set((job.parts || []).map((p) => p && p.id).filter(Boolean));
  const claimId = (srcId, taken) => {
    const id = (srcId && !taken.has(srcId)) ? srcId : newId();
    taken.add(id);
    return id;
  };

  // --- УСЛУГИ: целый массив, «добавить + обновить», без удаления ---
  const docServices = (snapshot.services || [])
    .map((s) => ({
      doc_id: (s && s.id) || null,
      src_id: (s && s.src_id) || null,
      name: String((s && s.name) || '').trim(),
      qty: num(s && s.qty, 1),
      price: num(s && s.price, 0),
    }))
    .filter((s) => s.name);
  const outOfScopeServices = (job.services || []).filter((s) => !inScope(s));
  const scopeServices = (job.services || []).filter(inScope).map((s) => ({ ...s }));
  const svcMatch = matchDocRows(docServices, scopeServices, svcKeyOf, '');
  const svcSummary = { updated: 0, added: 0, renamed: [], leftover: [] };
  const newServices = [];
  docServices.forEach((ds, di) => {
    const ci = svcMatch.pairs.has(di) ? svcMatch.pairs.get(di) : -1;
    if (ci >= 0) {
      const prev = scopeServices[ci];
      const id = prev.id || claimId(ds.src_id, takenSvcIds);
      if (svcKeyOf(prev) !== svcKeyOf(ds)) svcSummary.renamed.push([prev.name || '—', ds.name]);
      svcSummary.updated += 1;
      scopeServices[ci] = { ...prev, id, name: ds.name, qty: ds.qty, price: ds.price };
      if (ds.doc_id) links.services[ds.doc_id] = id;
    } else {
      const id = claimId(ds.src_id, takenSvcIds);
      newServices.push({ id, name: ds.name, qty: ds.qty, price: ds.price, ...tagged });
      svcSummary.added += 1;
      if (ds.doc_id) links.services[ds.doc_id] = id;
    }
  });
  scopeServices.forEach((s, ci) => {
    if (!svcMatch.taken.has(ci) && String((s && s.name) || '').trim()) svcSummary.leftover.push(s.name);
  });
  const services = [...outOfScopeServices, ...scopeServices, ...newServices];

  // --- ЗАПЧАСТИ: пооперационно, «добавить + обновить», без удаления ---
  const docParts = (snapshot.parts || [])
    .map((p) => ({
      doc_id: (p && p.id) || null,
      src_id: (p && p.src_id) || null,
      code: String((p && p.code) || '').trim(),
      name: String((p && p.name) || '').trim(),
      qty: num(p && p.qty, 1),
      unit: (p && p.unit) || 'шт.',
      price: num(p && p.price, 0),
      kind: (p && p.kind) || 'new',
      replArticle: (p && p.replArticle) || '',
    }))
    .filter((p) => p.code || p.name); // пустую строку не пишем
  const scopeParts = (job.parts || []).filter(inScope);
  const partMatch = matchDocRows(docParts, scopeParts, partKeyOf, '|');
  const partSummary = { updated: 0, added: 0, renamed: [], leftover: [] };
  const partOps = [];
  docParts.forEach((dp, di) => {
    const ci = partMatch.pairs.has(di) ? partMatch.pairs.get(di) : -1;
    if (ci >= 0) {
      const orig = scopeParts[ci];
      const id = orig.id || claimId(dp.src_id, takenPartIds);
      if (partKeyOf(orig) !== partKeyOf(dp)) partSummary.renamed.push([orig.name || orig.code || '—', dp.name || dp.code]);
      partSummary.updated += 1;
      // ...orig ПЕРВЫМ — сохраняем payer/kind/поставщика/cost/статус/receiving_log;
      // savePart всё равно пересчитает receiving_log на сервере и синхронизирует склад.
      partOps.push({ ...orig, id, code: dp.code, name: dp.name, qty: dp.qty, unit: dp.unit, price: dp.price });
      if (dp.doc_id) links.parts[dp.doc_id] = id;
    } else {
      const id = claimId(dp.src_id, takenPartIds);
      partOps.push({
        id, code: dp.code, name: dp.name, qty: dp.qty, unit: dp.unit, price: dp.price,
        kind: dp.kind, replArticle: dp.replArticle, status: 'need',
        ...tagged,
      });
      partSummary.added += 1;
      if (dp.doc_id) links.parts[dp.doc_id] = id;
    }
  });
  scopeParts.forEach((p, ci) => {
    if (!partMatch.taken.has(ci)) partSummary.leftover.push(p.name || p.code || '—');
  });

  return { services, partOps, links, summary: { services: svcSummary, parts: partSummary } };
}

// Скидка документа → в карточку. Отдельно от позиций, потому что скидка — не строка
// таблицы, а РЕКВИЗИТ УБЫТКА (своя у каждого дела, см. discountFor): писать её надо не
// в job.services, а в само дело. Раньше «Обновить карточку машины» её вообще не несла —
// правишь скидку в заказ-наряде, а в карточке (и, значит, в P&L и марже запчастей,
// которые читают job.discount) остаётся прежняя.
//
// Считаем ЭФФЕКТИВНУЮ сумму В РУБЛЯХ (computeOrderTotals): в документе скидку можно
// задать процентом, а карточка и costing знают только рубли.
//
// Возвращает null, когда писать нечего: значение не изменилось ИЛИ это документ
// допродаж (у клиентского потока скидки нет и не было — иначе кнопка в нём обнуляла бы
// скидку страхового дела). claimId — В КАКОЕ дело писать, исполняет вызывающий.
export function planDocDiscountToCar(job = {}, snapshot = {}, recipient = STREAM_ALL) {
  if (recipient === STREAM_CLIENT) return null;
  const to = computeOrderTotals(snapshot).discount;
  const from = discountFor(job, recipient);
  if (to === from) return null;
  // 'all' (обычная машина) и 'insurance' — это одно и то же дело: убыток №1 (claimsOf
  // держит его первым, и его реквизиты зеркалятся в плоские поля машины).
  return { claimId: recipient === STREAM_ALL ? STREAM_INSURANCE : recipient, from, to };
}

// Текст подтверждения «Обновить карточку машины»: ЧТО именно произойдёт. Раньше здесь
// стояло общее «добавятся и обновят совпадающие» — по нему нельзя было понять, почему
// в карточке стало на позицию больше, и это и была главная путаница. Теперь считаем
// заранее и показываем: обновим / переименуем / добавим / останется в карточке.
export function describeDocToCarPlan(plan = {}, opts = {}) {
  const s = (plan.summary && plan.summary.services) || { updated: 0, added: 0, renamed: [], leftover: [] };
  const p = (plan.summary && plan.summary.parts) || { updated: 0, added: 0, renamed: [], leftover: [] };
  const lines = ['Обновить карточку машины данными из документа?', ''];
  if (opts.head) lines.push('• Марка, гос. номер, VIN, пробег и клиент — перезапишут карточку.');
  const group = (label, x) => {
    const bits = [];
    if (x.updated) bits.push(`обновим ${x.updated}`);
    if (x.added) bits.push(`добавим ${x.added}`);
    if (!bits.length) return;
    lines.push(`• ${label}: ${bits.join(', ')}.`);
    for (const [from, to] of x.renamed.slice(0, 5)) lines.push(`    переименуем «${from}» → «${to}»`);
    if (x.renamed.length > 5) lines.push(`    …и ещё переименований: ${x.renamed.length - 5}`);
  };
  group('Работы', s);
  group('Запчасти', p);
  // Скидку показываем «было → станет»: она перезаписывает карточку целиком (в отличие
  // от позиций, которые только добавляются и обновляются), в том числе обнуляет —
  // и человек должен увидеть это ДО нажатия «ОК», а не в P&L через неделю.
  if (opts.discount) lines.push(`• Скидка: ${money(opts.discount.from)} → ${money(opts.discount.to)}.`);
  const leftover = [...s.leftover, ...p.leftover];
  if (leftover.length) {
    lines.push('');
    lines.push(leftover.length === 1
      ? 'В карточке ОСТАНЕТСЯ 1 позиция, которой нет в документе (ничего не удаляем):'
      : `В карточке ОСТАНУТСЯ ${leftover.length} поз., которых нет в документе (ничего не удаляем):`);
    for (const name of leftover.slice(0, 6)) lines.push(`    ${name}`);
    if (leftover.length > 6) lines.push(`    …и ещё: ${leftover.length - 6}`);
    lines.push('Удалить их можно в карточке машины или на экране «Запчасти».');
  }
  return lines.join('\n');
}

// ===== Автонумерация документов =====
// Формат: ПРЕФИКС-ГОД-NNNN (напр. ЗН-2026-0007). У каждого типа документа — своя
// годовая очередь; сам порядковый номер выдаёт атомарный счётчик в Firestore
// (см. api.counters, api.jobs.create, api.orderDocuments.create). Здесь только
// чистое форматирование — чтобы покрыть тестами без обращения к базе.
// `invoice` (СЧ) — счёт КЛИЕНТУ (доход). `supplier` (СП) — счёт ПОСТАВЩИКА на
// запчасти, который оплачивает учредитель (расход). Разные документы, не путать.
// `intake` (ПР) — акт ПРиёмки ТС при заезде (экран «Приёмка авто»); не путать с
// `handover` (ПП) — актом приёма-передачи при ВЫДАЧЕ машины клиенту.
export const DOC_PREFIX = { order: 'ЗН', act: 'АКТ', invoice: 'СЧ', handover: 'ПП', purchase: 'ЗАК', supplier: 'СП', intake: 'ПР' };

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
      mileage: jobMileage(job),
    },
    reason: job.reason || '',
    services: srcServices.map((s) => ({
      id: uid(),
      // Обратная ссылка на позицию карточки, из которой выросла строка. НЕ печатается
      // и не участвует в суммах — нужна только «Обновить карточку машины», чтобы
      // переименование в документе переименовывало позицию, а не плодило дубль
      // (см. planDocItemsToCar). null, а не undefined: Firestore не пишет undefined.
      src_id: s.id || null,
      name: s.name || '',
      qty: num(s.qty, 1),
      price: num(s.price, 0),
    })),
    parts: srcParts.map((p) => ({
      id: uid(),
      src_id: p.id || null, // см. src_id у услуг выше
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

// Скидку можно задавать в рублях (discount_mode 'rub', поле discount) ИЛИ процентом
// от суммы работ+запчастей (discount_mode 'pct', поле discount_pct). В любом случае
// возвращаем discount как РУБЛИ (эффективную сумму) — так печать, costing (читает
// order.discount рублями) и старые сохранённые документы работают без изменений.
// discount_mode/discount_pct отдаём отдельно — чтобы на листе печатать «Скидка 10%».
export function resolveDiscount(snapshot = {}, subtotal = 0) {
  const mode = snapshot.discount_mode === 'pct' ? 'pct' : 'rub';
  const pct = mode === 'pct' ? Math.min(100, Math.max(0, num(snapshot.discount_pct, 0))) : 0;
  const raw = mode === 'pct' ? (subtotal * pct) / 100 : num(snapshot.discount, 0);
  const amount = Math.min(subtotal, Math.max(0, Math.round(raw)));
  return { mode, pct, amount };
}

export function computeOrderTotals(snapshot = {}) {
  const sum = (arr) => (arr || []).reduce((s, it) => s + num(it.qty, 0) * num(it.price, 0), 0);
  const services_sum = sum(snapshot.services);
  const parts_sum = sum(snapshot.parts);
  const subtotal = services_sum + parts_sum;
  const d = resolveDiscount(snapshot, subtotal);
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
  return { services_sum, parts_sum, subtotal, discount, discount_mode: d.mode, discount_pct: d.pct, total, prepayment, due, franchise, insurer_pays, payable, payable_due, total_words: numberToWordsRu(total) };
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
      vin: job.vin || '', year: job.year || '', mileage: jobMileage(job),
    },
  };
}

// id строки — всегда свежий (документ изолирован), а src_id ПРОНОСИМ насквозь: акт и
// счёт сидируются из заказ-наряда, и связь с позицией карточки не должна теряться на
// каждой пересадке (см. planDocItemsToCar).
function mapServices(arr) {
  return (arr || []).map((s) => ({ id: uid(), src_id: s.src_id || null, name: s.name || '', qty: num(s.qty, 1), price: num(s.price, 0) }));
}
function mapParts(arr) {
  return (arr || []).map((p) => ({ id: uid(), src_id: p.src_id || null, code: p.code || '', name: p.name || '', qty: num(p.qty, 1), unit: p.unit || 'шт.', price: num(p.price, 0), kind: p.kind || 'new', replArticle: p.replArticle || '' }));
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
    // Позиции берём прямо из карточки — значит их id и есть обратная ссылка src_id
    // (mapServices/mapParts проносят её в снапшот акта/счёта).
    services: itemsForStream(job.services, recipient).map((s) => ({ ...s, src_id: s.id || null })),
    parts: itemsForStream(job.parts, recipient).map((p) => ({ ...p, src_id: p.id || null })),
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
  // «При приёме» и «при выдаче» — одно и то же число (см. jobMileage). В редакторе
  // эти два поля тоже связаны: правка любого меняет оба.
  const mileage = jobMileage(job);
  return {
    ...baseHead(job, company, 'handover', recipient),
    direction: isIntake ? 'intake' : 'issue',
    condition: {
      mileage_in: mileage, equipment: job.equipment || '', condition_in: job.condition_in || '',
      mileage_out: mileage, condition_out: job.condition_out || '',
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
