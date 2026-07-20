// Regression guard for the «Согласование по запчастям» block. Zero-dependency —
// run with:  node --test src/orderDoc.test.js
// Only Б/У (used) and Замена (analog) go into the document; «под оригинал»
// (used_orig / analog_orig) and «Новое» (new) must produce NO lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPartsConsentText, buildOrderSnapshot, buildActSnapshot, computeOrderTotals, formatDocNumber, pad4, DOC_PREFIX, itemsForRecipient, orderMatchesRecipient, pickSeedItems, buildInvoiceSnapshot, planDocItemsToCar } from './orderDoc.js';
import { streamOf } from './billing.js';

test('Б/У → строка о согласии на установку Б/У с артикулом', () => {
  const txt = buildPartsConsentText([{ name: 'Бампер передний', code: '52119-42973', kind: 'used' }]);
  assert.equal(txt, 'Запчасть «Бампер передний» (арт. 52119-42973) устанавливается бывшей в употреблении (Б/У) с согласия Заказчика.');
});

test('Замена → строка о замене оригинала на аналог с обоими артикулами', () => {
  const txt = buildPartsConsentText([{ name: 'Фара левая', code: '81150-42', replArticle: 'DEPO-212', kind: 'analog' }]);
  assert.equal(txt, 'Оригинальная запчасть «Фара левая» (арт. 81150-42) заменена на аналог (арт. DEPO-212) с согласия Заказчика.');
});

test('«под оригинал» и «Новое» → в документ НЕ выносятся', () => {
  const txt = buildPartsConsentText([
    { name: 'A', kind: 'new' },
    { name: 'B', kind: 'used_orig' },
    { name: 'C', kind: 'analog_orig' },
  ]);
  assert.equal(txt, '');
});

test('несколько позиций → строки через перевод строки, только used/analog', () => {
  const lines = buildPartsConsentText([
    { name: 'Крыло', kind: 'used' },
    { name: 'Капот', kind: 'new' },
    { name: 'Решётка', kind: 'analog' },
  ]).split('\n');
  assert.equal(lines.length, 2);
});

test('buildOrderSnapshot — блок включён, когда есть Б/У/замена', () => {
  const on = buildOrderSnapshot({ parts: [{ name: 'X', kind: 'used' }] });
  assert.equal(on.show_parts_consent, true);
  assert.ok(on.parts_consent_text.includes('Б/У'));
  const off = buildOrderSnapshot({ parts: [{ name: 'X', kind: 'new' }] });
  assert.equal(off.show_parts_consent, false);
  assert.equal(off.parts_consent_text, '');
});

test('buildActSnapshot — kind переносится из заказ-наряда, блок собирается', () => {
  // Акт сеется из последнего заказ-наряда; его позиции несут kind.
  const order = buildOrderSnapshot({ parts: [{ name: 'Дверь', code: 'D1', kind: 'analog', replArticle: 'AN-9' }] });
  const act = buildActSnapshot({}, {}, {
    services: order.services, parts: order.parts,
    discount: 0, prepayment: 0, source: 'order', source_number: 'ЗН-1',
  });
  assert.equal(act.show_parts_consent, true);
  assert.ok(act.parts_consent_text.includes('аналог'));
});

// ===== Франшиза (страховые ремонты) =====
test('buildOrderSnapshot — франшиза переносится в блок insurance', () => {
  const snap = buildOrderSnapshot({ payment_type: 'insurance', insurer_name: 'СОГАЗ', franchise: 15000 });
  assert.equal(snap.insurance.franchise, 15000);
});

test('computeOrderTotals — франшиза платит клиент, остальное страховая', () => {
  const t = computeOrderTotals({
    services: [{ qty: 1, price: 60000 }],
    parts: [{ qty: 1, price: 40000 }],
    insurance: { payment_type: 'insurance', franchise: 15000 },
  });
  assert.equal(t.total, 100000);
  assert.equal(t.franchise, 15000);
  assert.equal(t.insurer_pays, 85000); // total − франшиза
});

test('computeOrderTotals — франшиза больше итога → страховая платит 0, не минус', () => {
  const t = computeOrderTotals({
    services: [{ qty: 1, price: 10000 }],
    insurance: { payment_type: 'insurance', franchise: 50000 },
  });
  assert.equal(t.franchise, 10000); // ограничена итогом
  assert.equal(t.insurer_pays, 0);
});

test('computeOrderTotals — не страховая: франшиза игнорируется', () => {
  const t = computeOrderTotals({
    services: [{ qty: 1, price: 10000 }],
    insurance: { payment_type: 'cash', franchise: 5000 },
  });
  assert.equal(t.franchise, 0);
  assert.equal(t.insurer_pays, 0);
});

// ===== Скидка: рубли / проценты =====
test('computeOrderTotals — скидка в рублях (по умолчанию, как раньше)', () => {
  const t = computeOrderTotals({ services: [{ qty: 1, price: 100000 }], discount: 8000 });
  assert.equal(t.discount, 8000);
  assert.equal(t.discount_mode, 'rub');
  assert.equal(t.total, 92000);
});

test('computeOrderTotals — скидка в процентах считается от суммы работ+запчастей', () => {
  const t = computeOrderTotals({
    services: [{ qty: 1, price: 60000 }],
    parts: [{ qty: 1, price: 40000 }],
    discount_mode: 'pct', discount_pct: 10, discount: 0,
  });
  assert.equal(t.discount, 10000); // 10% от 100000
  assert.equal(t.discount_mode, 'pct');
  assert.equal(t.discount_pct, 10);
  assert.equal(t.total, 90000);
});

test('computeOrderTotals — процент скидки ограничен 100 и не даёт минус', () => {
  const t = computeOrderTotals({
    services: [{ qty: 1, price: 50000 }],
    discount_mode: 'pct', discount_pct: 250,
  });
  assert.equal(t.discount, 50000); // 100% максимум = вся сумма
  assert.equal(t.total, 0);
});

// ===== Автонумерация: форматирование номера =====
test('pad4 — дополняет нулями до 4 знаков, отсекает мусор', () => {
  assert.equal(pad4(1), '0001');
  assert.equal(pad4(216), '0216');
  assert.equal(pad4(12345), '12345'); // пятизначные не режем
  assert.equal(pad4(0), '0000');
  assert.equal(pad4(undefined), '0000');
  assert.equal(pad4('7'), '0007');
});

test('formatDocNumber — ПРЕФИКС-ГОД-NNNN по типам документов', () => {
  assert.equal(formatDocNumber('order', 2026, 1), 'ЗН-2026-0001');
  assert.equal(formatDocNumber('act', 2026, 5), 'АКТ-2026-0005');
  assert.equal(formatDocNumber('invoice', 2026, 203), 'СЧ-2026-0203');
  assert.equal(formatDocNumber('handover', 2027, 1), 'ПП-2027-0001');
});

// СЧ — счёт КЛИЕНТУ (доход), СП — счёт ПОСТАВЩИКА на запчасти (расход). Разные
// документы со своими годовыми очередями — не путать.
test('DOC_PREFIX — шесть типов: заказ-наряд, акт, счёт, приём-передача, заявка на закупку, счёт поставщика', () => {
  assert.deepEqual(DOC_PREFIX, { order: 'ЗН', act: 'АКТ', invoice: 'СЧ', handover: 'ПП', purchase: 'ЗАК', supplier: 'СП' });
});

// ===== Разделение позиций: страховая ↔ допродажи клиента =====
// Один автомобиль, два потока: страховой ремонт (payer !== 'client') и допродажи
// (payer === 'client'). Из одной машины формируются ДВА комплекта документов.
const insJob = () => ({
  payment_type: 'insurance', insurer_name: 'СОГАЗ', claim_number: 'У-77', policy_type: 'kasko', franchise: 5000,
  services: [
    { name: 'Окраска двери', qty: 1, price: 10000 },                 // страховая (без payer)
    { name: 'Полировка фар', qty: 1, price: 3000, payer: 'client' }, // допродажа
  ],
  parts: [
    { name: 'Дверь', code: 'D1', qty: 1, price: 20000 },                  // страховая
    { name: 'Коврики', code: 'K1', qty: 1, price: 4000, payer: 'client' }, // допродажа
  ],
});

test('itemsForRecipient — делит позиции по плательщику', () => {
  const items = [{ name: 'A' }, { name: 'B', payer: 'insurance' }, { name: 'C', payer: 'client' }];
  assert.deepEqual(itemsForRecipient(items, 'insurance').map((x) => x.name), ['A', 'B']);
  assert.deepEqual(itemsForRecipient(items, 'client').map((x) => x.name), ['C']);
  assert.deepEqual(itemsForRecipient(items, 'all').map((x) => x.name), ['A', 'B', 'C']);
});

test('orderMatchesRecipient — старые ЗН без recipient считаются страховыми', () => {
  assert.equal(orderMatchesRecipient({ recipient: 'insurance' }, 'insurance'), true);
  assert.equal(orderMatchesRecipient({}, 'insurance'), true);            // legacy → страховой
  assert.equal(orderMatchesRecipient({ recipient: 'client' }, 'insurance'), false);
  assert.equal(orderMatchesRecipient({ recipient: 'client' }, 'client'), true);
  assert.equal(orderMatchesRecipient({}, 'client'), false);
});

test('buildOrderSnapshot(recipient=insurance) — только страховые позиции + страховой блок', () => {
  const snap = buildOrderSnapshot(insJob(), {}, 'insurance');
  assert.deepEqual(snap.services.map((s) => s.name), ['Окраска двери']);
  assert.deepEqual(snap.parts.map((p) => p.name), ['Дверь']);
  assert.equal(snap.insurance.payment_type, 'insurance');
  assert.equal(snap.insurance.insurer_name, 'СОГАЗ');
  assert.equal(snap.insurance.franchise, 5000);
  const t = computeOrderTotals(snap);
  assert.equal(t.total, 30000);      // 10000 + 20000
  assert.equal(t.franchise, 5000);
  assert.equal(t.insurer_pays, 25000);
});

test('buildOrderSnapshot(recipient=client) — только допродажи, как клиентский счёт (без страхового блока и франшизы)', () => {
  const snap = buildOrderSnapshot(insJob(), {}, 'client');
  assert.deepEqual(snap.services.map((s) => s.name), ['Полировка фар']);
  assert.deepEqual(snap.parts.map((p) => p.name), ['Коврики']);
  assert.equal(snap.insurance.payment_type, 'cash');   // клиентский документ
  assert.equal(snap.insurance.insurer_name, '');
  assert.equal(snap.insurance.franchise, 0);
  const t = computeOrderTotals(snap);
  assert.equal(t.total, 7000);       // 3000 + 4000
  assert.equal(t.franchise, 0);      // франшиза только для страхового потока
});

test('pickSeedItems — акт/счёт клиента подтягивают только допродажи (fallback из карточки)', () => {
  const seedIns = pickSeedItems(insJob(), [], 'insurance');
  assert.deepEqual(seedIns.services.map((s) => s.name), ['Окраска двери']);
  const seedCli = pickSeedItems(insJob(), [], 'client');
  assert.deepEqual(seedCli.services.map((s) => s.name), ['Полировка фар']);
  assert.equal(seedCli.discount, 0); // скидка Audatex на допродажи не переносится
});

test('pickSeedItems — берёт последний ЗН нужного потока', () => {
  const docs = [
    { type: 'order', recipient: 'client', doc_number: 'ЗН-Д', services: [{ name: 'Доп 1' }], parts: [] },
    { type: 'order', recipient: 'insurance', doc_number: 'ЗН-С', services: [{ name: 'Страх 1' }], parts: [] },
  ];
  assert.equal(pickSeedItems(insJob(), docs, 'client').source_number, 'ЗН-Д');
  assert.equal(pickSeedItems(insJob(), docs, 'insurance').source_number, 'ЗН-С');
});

test('buildInvoiceSnapshot(recipient=client) — счёт клиента без НДС-страхового, только допродажи', () => {
  const snap = buildInvoiceSnapshot(insJob(), {}, null, 'client');
  assert.deepEqual(snap.services.map((s) => s.name), ['Полировка фар']);
  assert.equal(snap.insurance.payment_type, 'cash');
  assert.equal(snap.recipient, 'client');
});

// ===== planDocItemsToCar: «Обновить карточку машины» из документа =====
// Семантика «добавить и обновить, не удалять» (выбор пользователя). id новых
// запчастей делаем детерминированным (seq), чтобы проверять без Math.random.
let _seq = 0;
const seqId = () => `new_${++_seq}`;

test('planDocItemsToCar (all): услуги — обновляет совпадающую по имени, дописывает новую, не удаляет отсутствующую', () => {
  _seq = 0;
  const job = { services: [
    { name: 'Покраска', qty: 1, price: 1000 },
    { name: 'Полировка', qty: 1, price: 500 },
  ], parts: [] };
  const snapshot = { services: [
    { name: 'Покраска', qty: 2, price: 1200 }, // совпадение → обновить
    { name: 'Мойка', qty: 1, price: 300 },      // новая → дописать
  ], parts: [] };
  const { services } = planDocItemsToCar(job, snapshot, 'all', seqId);
  assert.deepEqual(services.map((s) => [s.name, s.qty, s.price]), [
    ['Покраска', 2, 1200], // обновлено из документа
    ['Полировка', 1, 500], // отсутствует в документе, но НЕ удалено
    ['Мойка', 1, 300],     // добавлено
  ]);
});

test('planDocItemsToCar (insurance): не трогает клиентские допродажи, новая услуга остаётся в убытке №1', () => {
  _seq = 0;
  const job = { services: [
    { name: 'Ремонт', qty: 1, price: 5000 },                 // страховая (payer отсутствует)
    { name: 'Полировка фар', qty: 1, price: 800, payer: 'client' }, // допродажа
  ], parts: [] };
  const snapshot = { services: [{ name: 'Ремонт', qty: 1, price: 5500 }, { name: 'Арматурные', qty: 1, price: 700 }], parts: [] };
  const { services } = planDocItemsToCar(job, snapshot, 'insurance', seqId);
  // клиентская допродажа осталась нетронутой
  assert.ok(services.find((s) => s.name === 'Полировка фар' && s.payer === 'client'));
  // страховая обновлена
  assert.equal(services.find((s) => s.name === 'Ремонт').price, 5500);
  // Новая позиция принадлежит убытку №1. Раньше здесь ассертилось `payer === undefined`
  // (страховая ветка не писала метку вовсе). Теперь поток проставляется ЯВНО — иначе
  // новая позиция из ЗН убытка №2 осталась бы без метки и молча упала в убыток №1.
  // Проверяем СМЫСЛ (принадлежность потоку), а не деталь хранения: для streamOf
  // undefined и 'insurance' — одно и то же.
  const added = services.find((s) => s.name === 'Арматурные');
  assert.equal(streamOf(added), 'insurance');
  assert.notEqual(added.payer, 'client', 'страховая позиция не стала допродажей');
});

test('planDocItemsToCar (client): новые услуги/запчасти получают payer:client, страховые не трогаются', () => {
  _seq = 0;
  const job = { services: [{ name: 'Ремонт', qty: 1, price: 5000 }], parts: [{ id: 'ins1', code: 'A', name: 'Бампер', qty: 1, price: 100, payer: 'insurance' }] };
  const snapshot = { services: [{ name: 'Химчистка', qty: 1, price: 900 }], parts: [{ code: 'K1', name: 'Коврики', qty: 1, price: 400 }] };
  const { services, partOps } = planDocItemsToCar(job, snapshot, 'client', seqId);
  assert.ok(services.find((s) => s.name === 'Ремонт' && s.payer === undefined)); // страховая цела
  assert.ok(services.find((s) => s.name === 'Химчистка' && s.payer === 'client'));
  assert.equal(partOps.length, 1);
  assert.equal(partOps[0].payer, 'client');
  assert.equal(partOps[0].name, 'Коврики');
  assert.equal(partOps[0].status, 'need');
});

test('planDocItemsToCar (all): запчасть совпала по артикул+название — сохраняет id/метаданные, обновляет цену/кол-во', () => {
  _seq = 0;
  const orig = { id: 'p1', code: '52119', name: 'Бампер', qty: 1, unit: 'шт.', price: 100, payer: 'insurance', kind: 'used', status: 'ordered', supplier: 'Экзист', cost: 80, receiving_log: [{ status: 'ordered', at: 1, by: 'x' }] };
  const job = { services: [], parts: [orig] };
  const snapshot = { parts: [{ id: 'FRESH_UID', code: '52119', name: 'Бампер', qty: 2, unit: 'шт.', price: 150 }] };
  const { partOps } = planDocItemsToCar(job, snapshot, 'all', seqId);
  assert.equal(partOps.length, 1);
  const op = partOps[0];
  assert.equal(op.id, 'p1');            // стабильный id сохранён (НЕ из документа)
  assert.equal(op.qty, 2);              // обновлено
  assert.equal(op.price, 150);          // обновлено
  assert.equal(op.status, 'ordered');   // метаданные закупки сохранены
  assert.equal(op.supplier, 'Экзист');
  assert.equal(op.cost, 80);
  assert.equal(op.kind, 'used');        // kind оригинала не сброшен в 'new'
  assert.ok(op.receiving_log);          // история приёмки сохранена (savePart всё равно пересчитает на сервере)
});

test('planDocItemsToCar: новая запчасть получает свежий id и status:need; пустые строки игнорируются', () => {
  _seq = 0;
  const job = { services: [], parts: [] };
  const snapshot = { parts: [
    { code: 'K1', name: 'Коврики', qty: 1, price: 400 },
    { code: '', name: '', qty: 1, price: 0 }, // пустая — пропустить
  ] };
  const { partOps } = planDocItemsToCar(job, snapshot, 'all', seqId);
  assert.equal(partOps.length, 1);
  assert.equal(partOps[0].id, 'new_1');
  assert.equal(partOps[0].status, 'need');
  assert.equal(partOps[0].kind, 'new');
});

test('planDocItemsToCar (insurance): запчасть, которой нет в документе, НЕ попадает в partOps (не удаляется)', () => {
  _seq = 0;
  const job = { services: [], parts: [
    { id: 'keep', code: 'X', name: 'Крыло', qty: 1, price: 200, payer: 'insurance' },
  ] };
  const snapshot = { parts: [{ code: 'Y', name: 'Дверь', qty: 1, price: 300 }] };
  const { partOps } = planDocItemsToCar(job, snapshot, 'insurance', seqId);
  // Только новая позиция из документа. 'Крыло' не трогаем (нет removePart-операций).
  assert.equal(partOps.length, 1);
  assert.equal(partOps[0].name, 'Дверь');
  assert.ok(!partOps.find((p) => p.id === 'keep'));
});

// ===== Несколько убытков на одной машине =====
// У каждого дела СВОИ реквизиты и СВОЙ номер ЗН. Страховая заводит дело по номеру
// заказ-наряда, поэтому чужой номер/чужой № убытка в документе — это брак.
const twoClaimJob = () => ({
  id: 'j1', payment_type: 'insurance', car_model: 'GEELY ATLAS', plate_number: 'А123ВС196',
  // Плоские поля = зеркало убытка №1 (их читает непереписанный код и бот).
  claim_number: 'PVU-123', insurer_name: 'СОГАЗ', policy_type: 'osago', franchise: 15000,
  order_number: 'ЗН-2026-0007', discount: 1000,
  claims: [
    { id: 'insurance', claim_number: 'PVU-123', insurer_name: 'СОГАЗ', policy_type: 'osago',
      franchise: 15000, order_number: 'ЗН-2026-0007', discount: 1000 },
    { id: 'cl_x7', claim_number: 'PVU-999', insurer_name: 'СОГАЗ', policy_type: 'kasko',
      franchise: 0, order_number: 'ЗН-2026-0042', discount: 500 },
  ],
  services: [
    { name: 'Окраска двери', qty: 1, price: 10000 },                  // убыток №1
    { name: 'Окраска бампера', qty: 1, price: 8000, payer: 'cl_x7' }, // убыток №2
    { name: 'Полировка фар', qty: 1, price: 3000, payer: 'client' },  // допродажа
  ],
  parts: [
    { name: 'Дверь', code: 'D1', qty: 1, price: 20000 },
    { name: 'Бампер', code: 'B2', qty: 1, price: 15000, payer: 'cl_x7' },
    { name: 'Коврики', code: '', qty: 1, price: 4000, payer: 'client' },
  ],
});

test('buildOrderSnapshot — ЗН убытка №2 несёт СВОЙ номер, СВОЙ № убытка и СВОЮ франшизу', () => {
  const job = twoClaimJob();
  const zn1 = buildOrderSnapshot(job, {}, 'insurance');
  const zn2 = buildOrderSnapshot(job, {}, 'cl_x7');

  assert.equal(zn1.doc_number, 'ЗН-2026-0007');
  assert.equal(zn2.doc_number, 'ЗН-2026-0042', 'у второго дела свой номер из очереди');
  assert.equal(zn1.insurance.claim_number, 'PVU-123');
  assert.equal(zn2.insurance.claim_number, 'PVU-999', 'второе дело не печатается под номером первого');
  assert.equal(zn1.insurance.franchise, 15000);
  assert.equal(zn2.insurance.franchise, 0, 'своя франшиза у каждого дела');
  assert.equal(zn1.insurance.policy_type, 'osago');
  assert.equal(zn2.insurance.policy_type, 'kasko');
  assert.equal(zn1.discount, 1000);
  assert.equal(zn2.discount, 500, 'своя скидка');

  // Позиции не смешиваются.
  assert.deepEqual(zn1.services.map((s) => s.name), ['Окраска двери']);
  assert.deepEqual(zn2.services.map((s) => s.name), ['Окраска бампера']);
  assert.deepEqual(zn1.parts.map((p) => p.name), ['Дверь']);
  assert.deepEqual(zn2.parts.map((p) => p.name), ['Бампер']);
  assert.equal(zn1.recipient, 'insurance');
  assert.equal(zn2.recipient, 'cl_x7');
});

test('buildOrderSnapshot — допродажи по-прежнему без страхового блока и без франшизы', () => {
  const cli = buildOrderSnapshot(twoClaimJob(), {}, 'client');
  assert.equal(cli.insurance.payment_type, 'cash');
  assert.equal(cli.insurance.claim_number, '');
  assert.equal(cli.insurance.franchise, 0);
  assert.equal(cli.discount, 0);
  assert.deepEqual(cli.services.map((s) => s.name), ['Полировка фар']);
  assert.deepEqual(cli.parts.map((p) => p.name), ['Коврики']);
});

test('акт и счёт убытка №2 ссылаются на ЗН СВОЕГО дела (order_ref)', () => {
  const job = twoClaimJob();
  const act2 = buildActSnapshot(job, {}, null, 'cl_x7');
  const inv2 = buildInvoiceSnapshot(job, {}, null, 'cl_x7');
  assert.equal(act2.order_ref, 'ЗН-2026-0042', 'основание акта — ЗН своего дела');
  assert.equal(inv2.order_ref, 'ЗН-2026-0042', 'основание счёта — ЗН своего дела');
  assert.equal(act2.insurance.claim_number, 'PVU-999');
  assert.deepEqual(act2.services.map((s) => s.name), ['Окраска бампера']);

  const act1 = buildActSnapshot(job, {}, null, 'insurance');
  assert.equal(act1.order_ref, 'ЗН-2026-0007');
  assert.deepEqual(act1.services.map((s) => s.name), ['Окраска двери']);
});

test('pickSeedItems — акт/счёт берут позиции ЗН своего убытка, не чужого', () => {
  const job = twoClaimJob();
  const docs = [ // newest-first, как отдаёт listByJob
    { type: 'order', recipient: 'cl_x7', doc_number: 'ЗН-2026-0042', discount: 500, created_at: 200,
      services: [{ name: 'Окраска бампера ЗН', qty: 1, price: 9000 }], parts: [] },
    { type: 'order', recipient: 'insurance', doc_number: 'ЗН-2026-0007', discount: 1000, created_at: 100,
      services: [{ name: 'Окраска двери ЗН', qty: 1, price: 11000 }], parts: [] },
  ];
  const seed2 = pickSeedItems(job, docs, 'cl_x7');
  assert.deepEqual(seed2.services.map((s) => s.name), ['Окраска бампера ЗН']);
  assert.equal(seed2.source_number, 'ЗН-2026-0042');
  const seed1 = pickSeedItems(job, docs, 'insurance');
  assert.deepEqual(seed1.services.map((s) => s.name), ['Окраска двери ЗН']);
  assert.equal(seed1.source_number, 'ЗН-2026-0007');
});

// ОБРАТНАЯ СОВМЕСТИМОСТЬ: машина без поля claims (все ~100 машин прода).
test('buildOrderSnapshot — старая страховая машина (без claims) печатается ровно как раньше', () => {
  const legacy = {
    id: 'j0', payment_type: 'insurance', claim_number: 'У-77', insurer_name: 'Ингосстрах',
    policy_type: 'kasko', franchise: 5000, order_number: 'ЗН-2026-0003', discount: 2000,
    services: [{ name: 'Окраска', qty: 1, price: 10000 }, { name: 'Химчистка', qty: 1, price: 3000, payer: 'client' }],
    parts: [{ name: 'Дверь', code: 'D', qty: 1, price: 20000 }],
  };
  const zn = buildOrderSnapshot(legacy, {}, 'insurance');
  assert.equal(zn.doc_number, 'ЗН-2026-0003', 'номер машины — как раньше');
  assert.equal(zn.insurance.claim_number, 'У-77');
  assert.equal(zn.insurance.franchise, 5000);
  assert.equal(zn.discount, 2000);
  assert.deepEqual(zn.services.map((s) => s.name), ['Окраска'], 'нетегированная позиция = убыток №1');
  assert.deepEqual(zn.parts.map((p) => p.name), ['Дверь']);
});

// САМАЯ ТИХАЯ ЛОВУШКА ВСЕЙ ФИЧИ: «Обновить карточку машины» из ЗН убытка №2.
// Раньше страховая ветка не писала метку вовсе — новая позиция осталась бы без неё,
// а «без метки» = убыток №1. Позиция молча уехала бы в чужое дело и попала в счёт
// не той страховой. Ошибки при этом никакой.
test('planDocItemsToCar (cl_x7): новые позиции получают метку СВОЕГО убытка, чужие не тронуты', () => {
  _seq = 0;
  const job = {
    services: [
      { name: 'Окраска двери', qty: 1, price: 10000 },                    // убыток №1
      { name: 'Окраска бампера', qty: 1, price: 8000, payer: 'cl_x7' },   // убыток №2
      { name: 'Полировка', qty: 1, price: 3000, payer: 'client' },        // допродажа
    ],
    parts: [{ id: 'p1', code: 'D1', name: 'Дверь', qty: 1, price: 20000 }], // убыток №1
  };
  const snapshot = {
    services: [{ name: 'Окраска бампера', qty: 1, price: 9000 }, { name: 'Арматурные работы', qty: 1, price: 1500 }],
    parts: [{ code: 'B2', name: 'Бампер', qty: 1, price: 15000 }],
  };
  const { services, partOps } = planDocItemsToCar(job, snapshot, 'cl_x7', seqId);

  // Существующая позиция убытка №2 обновлена, метка сохранена.
  const upd = services.find((s) => s.name === 'Окраска бампера');
  assert.equal(upd.price, 9000);
  assert.equal(streamOf(upd), 'cl_x7');
  // НОВАЯ позиция получила метку убытка №2 — не упала в убыток №1.
  const added = services.find((s) => s.name === 'Арматурные работы');
  assert.equal(streamOf(added), 'cl_x7', 'новая работа осталась в своём деле');
  // Чужие потоки не тронуты и не удалены.
  assert.equal(streamOf(services.find((s) => s.name === 'Окраска двери')), 'insurance');
  assert.equal(services.find((s) => s.name === 'Полировка').payer, 'client');
  assert.equal(services.length, 4);
  // Новая запчасть — тоже в своём деле; чужая запчасть в partOps не попала.
  assert.equal(partOps.length, 1);
  assert.equal(partOps[0].name, 'Бампер');
  assert.equal(streamOf(partOps[0]), 'cl_x7');
});

// Обычная (наличная) машина метки не имеет и не должна её получить — иначе её
// позиции внезапно станут «убытком №1» у машины, где убытков нет вовсе.
test('planDocItemsToCar (all): наличная машина не получает метку потока', () => {
  _seq = 0;
  const job = { services: [], parts: [] };
  const snapshot = { services: [{ name: 'Мойка', qty: 1, price: 500 }], parts: [{ code: 'X', name: 'Фильтр', qty: 1, price: 900 }] };
  const { services, partOps } = planDocItemsToCar(job, snapshot, 'all', seqId);
  assert.equal(services[0].payer, undefined, 'метки нет');
  assert.equal(partOps[0].payer, undefined, 'метки нет');
});
