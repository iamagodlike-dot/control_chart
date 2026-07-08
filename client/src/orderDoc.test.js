// Regression guard for the «Согласование по запчастям» block. Zero-dependency —
// run with:  node --test src/orderDoc.test.js
// Only Б/У (used) and Замена (analog) go into the document; «под оригинал»
// (used_orig / analog_orig) and «Новое» (new) must produce NO lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPartsConsentText, buildOrderSnapshot, buildActSnapshot, formatDocNumber, pad4, DOC_PREFIX } from './orderDoc.js';

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

test('DOC_PREFIX — четыре типа: заказ-наряд, акт, счёт, приём-передача', () => {
  assert.deepEqual(DOC_PREFIX, { order: 'ЗН', act: 'АКТ', invoice: 'СЧ', handover: 'ПП' });
});
