// Потоки биллинга машины: по одному автомобилю страховая может завести НЕСКОЛЬКО
// убытков (страховых дел), и по каждому нужен свой комплект документов со своим
// номером заказ-наряда, своим № убытка и своей франшизой. Плюс клиент может
// доплачивать за допродажи — это ещё один поток.
//
// Модуль держим без зависимостей (как phase.js), чтобы его мог импортировать и
// слой данных (api.js), и любой экран, и чистые модули (orderDoc.js, costing.js).
//
// ===== ГЛАВНАЯ ИДЕЯ =====
// Не заводим позициям НОВОЕ поле. Расширяем область значений СУЩЕСТВУЮЩЕГО поля
// `payer` с двух значений до N: payer — это id потока биллинга.
//
//   payer: undefined | 'insurance'  → убыток №1 (весь легаси)
//   payer: 'client'                 → допродажи клиента
//   payer: 'cl_k3f9'                → убыток №2, №3, …
//
// ПОЧЕМУ ТАК, А НЕ ОТДЕЛЬНЫМ ПОЛЕМ claim_id:
//  1. Ноль миграций. claims[0].id === 'insurance' === легаси-значение payer, поэтому
//     все накопленные позиции сами собой попадают в убыток №1. Отдельное поле
//     потребовало бы бэкфилла всех job.parts на проде — с риском для стабильного id
//     позиции, server-owned receiving_log и лавины записей в склад (syncParts
//     дёргается из каждого savePart).
//  2. normalizePart (parts.js) — WHITELIST: он пересобирает позицию из фиксированного
//     набора полей и вырезал бы claim_id на каждом снапшоте. `payer` там уже есть.
//  3. Направление промаха. У непереписанного кода фильтр «payer !== 'client'» ОСТАЁТСЯ
//     истинным для второго убытка, то есть отдельное поле дало бы СМЕШИВАНИЕ дел
//     (счёт в страховую с чужими позициями). Здесь же поток 'cl_*' просто не совпадёт
//     ни с одним старым фильтром и ВЫПАДЕТ: недосчитали, а не испортили.
//
// ЦЕНА: поле навсегда называется неправильно — оно хранит id потока, а не «кто платит».
// Любой читающий код ОБЯЗАН звать streamOf(), а не сравнивать payer напрямую.
// Переименовать нельзя: это и есть та самая перезапись всех позиций на проде.

// id первого страхового потока. РАВЕН легаси-значению payer — на этом инварианте
// держится вся обратная совместимость.
export const STREAM_INSURANCE = 'insurance';
// Поток допродаж клиента. Тоже легаси-значение payer.
export const STREAM_CLIENT = 'client';
// Псевдо-поток «все позиции» — обычная (не страховая) машина, один комплект документов.
export const STREAM_ALL = 'all';

// Поток, которому принадлежит работа/запчасть. Нетегированная позиция — это весь
// легаси: до появления убытков другого потока и не было, значит это убыток №1.
export function streamOf(item) {
  const p = item && item.payer;
  return p ? String(p) : STREAM_INSURANCE;
}

// Вид потока: допродажи клиента или страховое дело. Нужен, чтобы документ знал,
// печатать ли страховой блок (полис / № убытка / франшиза).
export function streamKindOf(streamId) {
  if (streamId === STREAM_CLIENT) return 'client';
  if (streamId === STREAM_ALL) return 'all';
  return 'insurance';
}

// Позиции одного потока. 'all' → весь массив (обычная машина).
//
// ЭКВИВАЛЕНТНОСТЬ НА ЛЕГАСИ-ДАННЫХ: пока у позиций только undefined/'insurance'/'client',
// itemsForStream(items,'insurance') даёт ПОБУКВЕННО то же множество, что старое
// itemsForRecipient(items,'insurance') = filter(payer !== 'client'). Расходятся они
// только там, где появился второй убыток — и расходятся в безопасную сторону.
export function itemsForStream(items = [], streamId = STREAM_ALL) {
  if (streamId === STREAM_ALL) return items || [];
  return (items || []).filter((x) => x && streamOf(x) === streamId);
}

// Подходит ли сохранённый документ под поток (для подстановки позиций в акт/счёт,
// истории «Ранее выданные» и себестоимости).
//
// ЛЕГАСИ-ЛЮК: старые документы писались без поля recipient либо с 'all'. Они относятся
// к убытку №1 — до появления допродаж другого потока не существовало. Люк работает
// ТОЛЬКО для потока 'insurance': для 'cl_*' его не нужно (таких документов в истории
// физически нет), а для 'client' он был бы неверен.
export function orderMatchesStream(doc, streamId) {
  const r = (doc && doc.recipient) || STREAM_ALL;
  if (streamId === STREAM_INSURANCE) return r === STREAM_INSURANCE || r === STREAM_ALL;
  return r === streamId;
}

// id нового убытка. Префикс 'cl_' — чтобы поток нельзя было спутать с легаси-значениями
// и чтобы он был узнаваем в базе глазами.
export function genClaimId() {
  return 'cl_' + Math.random().toString(36).slice(2, 8);
}

// Реквизиты убытка, собранные из плоских полей машины. Ленивая миграция: у машин,
// заведённых до появления убытков, поля claims нет — собираем убыток №1 на лету,
// ровно как phase.js трактует отсутствие job.phase. Ноль фоновых записей: claims
// материализуется в базе только когда заводят ВТОРОЙ убыток.
function legacyClaim(job = {}) {
  return {
    id: STREAM_INSURANCE,
    claim_number: job.claim_number || '',
    insurer_id: job.insurer_id || '',
    insurer_name: job.insurer_name || '',
    policy_type: job.policy_type || '',
    franchise: job.franchise ?? null,
    order_number: job.order_number || '',
    discount: Number(job.discount) || 0,
    deadline: job.deadline || null,
    approval_status: job.approval_status || null,
    approval_since: job.approval_since || null,
  };
}

// Все страховые дела машины, всегда минимум одно. claims[0].id === STREAM_INSURANCE —
// несущий инвариант: это значение одновременно id убытка №1 И дефолт для всех
// нетегированных позиций. Если оно исчезнет или переедет, легаси-позиции ВСЕХ машин
// осиротеют разом (см. запрет в api.jobs.removeClaim).
export function claimsOf(job = {}) {
  const list = Array.isArray(job.claims) ? job.claims.filter(Boolean) : [];
  if (!list.length) return [legacyClaim(job)];
  // Страховка от повреждённых данных: первый убыток обязан держать легаси-id.
  if (list[0].id !== STREAM_INSURANCE) {
    const idx = list.findIndex((c) => c.id === STREAM_INSURANCE);
    if (idx > 0) return [list[idx], ...list.slice(0, idx), ...list.slice(idx + 1)];
    return [{ ...legacyClaim(job), ...list[0], id: STREAM_INSURANCE }, ...list.slice(1)];
  }
  return list;
}

// Реквизиты конкретного потока. Для допродаж (и неизвестного потока) — null:
// у клиентского документа нет ни полиса, ни № убытка, ни франшизы.
// Для 'all' (обычная машина) — реквизиты убытка №1: там лежат номер ЗН и скидка.
export function claimOf(job = {}, streamId = STREAM_ALL) {
  if (streamId === STREAM_CLIENT) return null;
  const claims = claimsOf(job);
  if (streamId === STREAM_ALL) return claims[0] || null;
  return claims.find((c) => c.id === streamId) || null;
}

// Короткая подпись убытка для вкладок/чипов: «Убыток 1 · PVU-123».
export function claimLabel(claim, index) {
  const n = 'Убыток ' + (index + 1);
  return claim && claim.claim_number ? n + ' · ' + claim.claim_number : n;
}

// Потоки машины для переключателей (карточка, окно «Документы»).
// Обычная (не страховая) машина — потоков нет: один комплект документов, recipient 'all',
// переключатель не показывается.
export function streamsOf(job = {}) {
  if (!job || job.payment_type !== 'insurance') return [];
  const claims = claimsOf(job);
  const out = claims.map((c, i) => ({
    id: c.id,
    kind: 'insurance',
    claim: c,
    label: claimLabel(c, i),
    docLabel: claims.length > 1 ? 'Страховой · ' + claimLabel(c, i) : 'Страховой',
  }));
  out.push({ id: STREAM_CLIENT, kind: 'client', claim: null, label: 'Допродажи клиента', docLabel: 'Клиенту (допродажи)' });
  return out;
}

// Поток по умолчанию для машины: убыток №1 у страховой, «все позиции» у остальных.
export function defaultStream(job = {}) {
  return job && job.payment_type === 'insurance' ? STREAM_INSURANCE : STREAM_ALL;
}
