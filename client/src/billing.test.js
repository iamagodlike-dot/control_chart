// Потоки биллинга: несколько убытков на одной машине. Zero-dependency —
// run with:  node --test src/billing.test.js
//
// Главный тест здесь — ЭКВИВАЛЕНТНОСТЬ (см. ниже). Он доказывает, что на живых
// данных прода новая логика даёт побуквенно то же, что старая. Если он покраснел —
// значит фича трогает существующие машины, и это НЕЛЬЗЯ выкатывать.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STREAM_INSURANCE, STREAM_CLIENT, STREAM_ALL,
  streamOf, streamKindOf, itemsForStream, orderMatchesStream,
  claimsOf, claimOf, streamsOf, defaultStream, claimLabel, genClaimId,
} from './billing.js';

// СТАРАЯ реализация, дословно скопированная из orderDoc.js до появления убытков.
// Сверяться с нынешним itemsForRecipient НЕЛЬЗЯ: он теперь тонкая обёртка над
// itemsForStream, и тест сравнивал бы функцию сам с собой (тавтология).
function legacyItemsForRecipient(items = [], recipient = 'all') {
  if (recipient === 'client') return (items || []).filter((x) => x && x.payer === 'client');
  if (recipient === 'insurance') return (items || []).filter((x) => x && x.payer !== 'client');
  return items || [];
}
function legacyOrderMatchesRecipient(doc, recipient) {
  const r = (doc && doc.recipient) || 'all';
  if (recipient === 'insurance') return r === 'insurance' || r === 'all';
  return r === recipient;
}

// ===== ЭКВИВАЛЕНТНОСТЬ СО СТАРОЙ ЛОГИКОЙ =====
// Легаси-данные = позиции только с payer undefined | 'insurance' | 'client'.
// Ровно это лежит в проде у всех машин.
const LEGACY_ITEMS = [
  { name: 'Окраска двери', price: 10000 },                        // без payer
  { name: 'Замена крыла', price: 8000, payer: 'insurance' },      // явно страховая
  { name: 'Полировка фар', price: 3000, payer: 'client' },        // допродажа
];

test('ЭКВИВАЛЕНТНОСТЬ: на легаси-данных itemsForStream === старый itemsForRecipient', () => {
  // Страховой поток: старое правило — «всё, что не client». Новое — «поток insurance».
  assert.deepEqual(
    itemsForStream(LEGACY_ITEMS, STREAM_INSURANCE),
    legacyItemsForRecipient(LEGACY_ITEMS, 'insurance'),
    'страховой поток совпадает побуквенно',
  );
  assert.deepEqual(
    itemsForStream(LEGACY_ITEMS, STREAM_CLIENT),
    legacyItemsForRecipient(LEGACY_ITEMS, 'client'),
    'допродажи совпадают побуквенно',
  );
  assert.deepEqual(
    itemsForStream(LEGACY_ITEMS, STREAM_ALL),
    legacyItemsForRecipient(LEGACY_ITEMS, 'all'),
    'обычная машина — весь массив',
  );
  // И конкретно: нетегированная позиция НЕ теряется.
  assert.equal(itemsForStream(LEGACY_ITEMS, STREAM_INSURANCE).length, 2);
});

test('ЭКВИВАЛЕНТНОСТЬ: orderMatchesStream сохраняет легаси-люк для старых документов', () => {
  const oldDoc = { type: 'order' };                    // до появления допродаж — без recipient
  const allDoc = { type: 'order', recipient: 'all' };
  const insDoc = { type: 'order', recipient: 'insurance' };
  const cliDoc = { type: 'order', recipient: 'client' };
  for (const [d, name] of [[oldDoc, 'без recipient'], [allDoc, "recipient 'all'"], [insDoc, 'страховой'], [cliDoc, 'клиентский']]) {
    for (const r of ['insurance', 'client']) {
      assert.equal(orderMatchesStream(d, r), legacyOrderMatchesRecipient(d, r), `${name} ↔ поток ${r}`);
    }
  }
  // Явно: старый ЗН без recipient прилипает к убытку №1 и остаётся в «Ранее выданные».
  assert.equal(orderMatchesStream(oldDoc, STREAM_INSURANCE), true);
  assert.equal(orderMatchesStream(oldDoc, STREAM_CLIENT), false);
});

// ===== НАПРАВЛЕНИЕ ПРОМАХА =====
// Это страховка всей схемы: непереписанный код ВЫБРАСЫВАЕТ второй убыток
// (недосчитал), а не подмешивает его к первому (испортил документ в страховую).
test('второй убыток НЕ протекает в старые фильтры — промах в безопасную сторону', () => {
  const items = [...LEGACY_ITEMS, { name: 'Бампер по делу №2', price: 20000, payer: 'cl_x7' }];
  // Новая логика: позиция принадлежит своему убытку и только ему.
  assert.deepEqual(itemsForStream(items, 'cl_x7').map((x) => x.name), ['Бампер по делу №2']);
  assert.equal(itemsForStream(items, STREAM_INSURANCE).length, 2, 'в убыток №1 чужая позиция не попала');
  assert.equal(itemsForStream(items, STREAM_CLIENT).length, 1);
  // Старый (непереписанный) фильтр её ПОДМЕШАЛ БЫ — вот почему звать его больше нельзя.
  assert.equal(legacyItemsForRecipient(items, 'insurance').length, 3, 'старое правило смешивает — это и чиним');
  // А старый документ убытка №2 старым фильтром не матчится → выпадет, а не испортит.
  assert.equal(orderMatchesStream({ recipient: 'cl_x7' }, STREAM_INSURANCE), false);
  assert.equal(legacyOrderMatchesRecipient({ recipient: 'cl_x7' }, 'insurance'), false);
});

test('streamOf — нетегированная позиция это убыток №1, а не «ничьё»', () => {
  assert.equal(streamOf({}), STREAM_INSURANCE);
  assert.equal(streamOf({ payer: undefined }), STREAM_INSURANCE);
  assert.equal(streamOf({ payer: '' }), STREAM_INSURANCE, 'пустая строка — тоже легаси');
  assert.equal(streamOf({ payer: 'insurance' }), STREAM_INSURANCE);
  assert.equal(streamOf({ payer: 'client' }), STREAM_CLIENT);
  assert.equal(streamOf({ payer: 'cl_x7' }), 'cl_x7');
  assert.equal(streamOf(null), STREAM_INSURANCE);
});

test('streamKindOf — страховой блок печатается всем, кроме допродаж', () => {
  assert.equal(streamKindOf(STREAM_INSURANCE), 'insurance');
  assert.equal(streamKindOf('cl_x7'), 'insurance');
  assert.equal(streamKindOf(STREAM_CLIENT), 'client');
  assert.equal(streamKindOf(STREAM_ALL), 'all');
});

// ===== ЛЕНИВАЯ МИГРАЦИЯ =====
const legacyJob = {
  payment_type: 'insurance', claim_number: 'PVU-123', insurer_id: 'i1', insurer_name: 'СОГАЗ',
  policy_type: 'osago', franchise: 15000, order_number: 'ЗН-2026-0007', discount: 5000,
};

test('claimsOf — у машины БЕЗ поля claims убыток №1 собирается из плоских полей на лету', () => {
  const claims = claimsOf(legacyJob);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].id, STREAM_INSURANCE, 'убыток №1 держит легаси-id');
  assert.equal(claims[0].claim_number, 'PVU-123');
  assert.equal(claims[0].insurer_name, 'СОГАЗ');
  assert.equal(claims[0].franchise, 15000);
  assert.equal(claims[0].order_number, 'ЗН-2026-0007');
  assert.equal(claims[0].discount, 5000);
});

test('claimsOf — машина без страховой всё равно отдаёт убыток №1 (там номер ЗН и скидка)', () => {
  const cash = { payment_type: 'cash', order_number: 'ЗН-2026-0009', discount: 1000 };
  const claims = claimsOf(cash);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].order_number, 'ЗН-2026-0009');
  assert.equal(claims[0].discount, 1000);
});

test('claimsOf — инвариант: первый убыток ВСЕГДА id=insurance, даже если данные повреждены', () => {
  // Порядок нарушен — убыток №1 поднимается на место 0, остальные сохраняются.
  const shuffled = claimsOf({ claims: [{ id: 'cl_x7', claim_number: 'B' }, { id: STREAM_INSURANCE, claim_number: 'A' }] });
  assert.deepEqual(shuffled.map((c) => c.id), [STREAM_INSURANCE, 'cl_x7']);
  assert.deepEqual(shuffled.map((c) => c.claim_number), ['A', 'B']);
  // Легаси-id потерян вовсе — первый принудительно им становится, иначе ВСЕ
  // нетегированные позиции всех машин осиротеют.
  const orphaned = claimsOf({ claim_number: 'flat', claims: [{ id: 'cl_a', claim_number: 'X' }, { id: 'cl_b' }] });
  assert.equal(orphaned[0].id, STREAM_INSURANCE);
  assert.equal(orphaned[0].claim_number, 'X', 'реквизиты первого убытка сохранены');
  assert.equal(orphaned.length, 2);
});

test('claimOf — реквизиты потока; у допродаж их нет', () => {
  const job = { ...legacyJob, claims: [
    { id: STREAM_INSURANCE, claim_number: 'PVU-123', franchise: 15000, order_number: 'ЗН-2026-0007' },
    { id: 'cl_x7', claim_number: 'PVU-999', franchise: 0, order_number: 'ЗН-2026-0042' },
  ] };
  assert.equal(claimOf(job, STREAM_INSURANCE).claim_number, 'PVU-123');
  assert.equal(claimOf(job, 'cl_x7').claim_number, 'PVU-999');
  assert.equal(claimOf(job, 'cl_x7').order_number, 'ЗН-2026-0042', 'у каждого дела свой номер ЗН');
  assert.equal(claimOf(job, STREAM_CLIENT), null, 'у клиентского документа нет полиса и франшизы');
  assert.equal(claimOf(job, 'cl_missing'), null);
  assert.equal(claimOf(legacyJob, STREAM_ALL).order_number, 'ЗН-2026-0007', "'all' → реквизиты убытка №1");
});

// ===== ПЕРЕКЛЮЧАТЕЛИ =====
test('streamsOf — у страховой машины дела + допродажи; у обычной переключателя нет', () => {
  assert.deepEqual(streamsOf({ payment_type: 'cash' }), [], 'обычная машина — один поток, переключатель не нужен');
  assert.deepEqual(streamsOf({ payment_type: 'legal' }), []);

  // Один убыток — экран не меняется: подпись остаётся прежней «Страховой».
  const one = streamsOf(legacyJob);
  assert.deepEqual(one.map((s) => s.id), [STREAM_INSURANCE, STREAM_CLIENT]);
  assert.equal(one[0].docLabel, 'Страховой', 'при одном убытке подпись как была');
  assert.equal(one[1].docLabel, 'Клиенту (допродажи)');

  // Два убытка — подписи различают дела.
  const two = streamsOf({ ...legacyJob, claims: [
    { id: STREAM_INSURANCE, claim_number: 'PVU-123' },
    { id: 'cl_x7', claim_number: 'PVU-999' },
  ] });
  assert.deepEqual(two.map((s) => s.id), [STREAM_INSURANCE, 'cl_x7', STREAM_CLIENT]);
  assert.equal(two[0].label, 'Убыток 1 · PVU-123');
  assert.equal(two[1].label, 'Убыток 2 · PVU-999');
  assert.equal(two[0].docLabel, 'Страховой · Убыток 1 · PVU-123');
  assert.deepEqual(two.map((s) => s.kind), ['insurance', 'insurance', 'client']);
});

test('claimLabel — без номера убытка не показываем пустой хвост', () => {
  assert.equal(claimLabel({ claim_number: 'PVU-1' }, 0), 'Убыток 1 · PVU-1');
  assert.equal(claimLabel({ claim_number: '' }, 1), 'Убыток 2');
  assert.equal(claimLabel(null, 0), 'Убыток 1');
});

test('defaultStream — страховая открывается на убытке №1, обычная на «все позиции»', () => {
  assert.equal(defaultStream(legacyJob), STREAM_INSURANCE);
  assert.equal(defaultStream({ payment_type: 'cash' }), STREAM_ALL);
  assert.equal(defaultStream({}), STREAM_ALL);
});

test('genClaimId — узнаваемый префикс и уникальность (не спутать с легаси)', () => {
  const a = genClaimId();
  assert.match(a, /^cl_[a-z0-9]+$/);
  assert.notEqual(a, STREAM_INSURANCE);
  assert.notEqual(a, STREAM_CLIENT);
  const ids = new Set(Array.from({ length: 200 }, genClaimId));
  assert.equal(ids.size, 200, 'id не повторяются');
});
