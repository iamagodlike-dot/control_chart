// Поиск дублей машин по гос.номеру. Zero-dependency — run with:
//   node --test src/dedupe.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlate, findDuplicateGroups, suggestPrimaryId, tagServicesForPrimary } from './dedupe.js';

test('normalizePlate — кириллица/латиница/пробелы приводятся к одному канону', () => {
  assert.equal(normalizePlate('А123ВС 96'), 'A123BC96');
  assert.equal(normalizePlate('a123bc96'), 'A123BC96');
  assert.equal(normalizePlate('А123ВС96'), 'A123BC96');   // без пробела
  assert.equal(normalizePlate('  а123вс96 '), 'A123BC96'); // лишние пробелы
  assert.equal(normalizePlate(''), '');
  assert.equal(normalizePlate(null), '');
});

test('findDuplicateGroups — группирует активные по номеру, только 2+', () => {
  const jobs = [
    { id: 'a', plate_number: 'А123ВС96', created_at: 100, payment_type: 'insurance' },
    { id: 'b', plate_number: 'a123bc 96', created_at: 200, payment_type: 'cash' }, // тот же номер
    { id: 'c', plate_number: 'В777ОР177', created_at: 150 },                        // одиночка
    { id: 'd', plate_number: '', created_at: 50 },                                  // без номера — пропуск
  ];
  const groups = findDuplicateGroups(jobs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'A123BC96');
  assert.deepEqual(groups[0].cars.map((c) => c.id), ['a', 'b']); // по дате создания
  assert.equal(groups[0].suggestedPrimaryId, 'a');                // страховая = основная
});

test('findDuplicateGroups — архивные не участвуют', () => {
  const jobs = [
    { id: 'a', plate_number: 'X001XX', created_at: 1 },
    { id: 'b', plate_number: 'X001XX', created_at: 2, archived: true },
  ];
  assert.equal(findDuplicateGroups(jobs).length, 0); // остаётся одна активная → не группа
});

test('suggestPrimaryId — страховая приоритетнее; иначе самая старая', () => {
  assert.equal(suggestPrimaryId([
    { id: 'x', created_at: 300, payment_type: 'cash' },
    { id: 'y', created_at: 100, payment_type: 'insurance' },
  ]), 'y');
  assert.equal(suggestPrimaryId([
    { id: 'x', created_at: 300, payment_type: 'cash' },
    { id: 'y', created_at: 100, payment_type: 'cash' },
  ]), 'y'); // страховой нет → старейшая
});

test('tagServicesForPrimary — для страховой основной помечает допродажей', () => {
  const src = [{ name: 'Химчистка', qty: 1, price: 5000 }];
  assert.deepEqual(tagServicesForPrimary(src, true), [{ name: 'Химчистка', qty: 1, price: 5000, payer: 'client' }]);
  assert.deepEqual(tagServicesForPrimary(src, false), [{ name: 'Химчистка', qty: 1, price: 5000 }]);
});
