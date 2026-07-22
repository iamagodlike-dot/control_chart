// Правила переноса калькуляции Audatex в таблицы карточки. Без зависимостей —
// запуск:  node --test src/audatexImport.test.js
// Главное, что здесь закреплено: у КАЖДОЙ запчасти свой стабильный id. Без него
// правка и удаление на экране «Запчасти» молча не работают (см. parts.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audatexServiceRows, audatexPartRows, audatexSummary } from './audatexImport.js';

// Счётчик вместо genPartId: тест не должен зависеть от случайности.
function makeGen() {
  let n = 0;
  return () => `id${++n}`;
}

const DATA = {
  vehicle: { car_model: 'Geely Atlas Pro', vin: 'LB37', plate: 'А123ВС96', mileage: '84000' },
  services: [
    { name: 'Замена бампера переднего', qty: 1, price: 4200 },
    { name: '  ', qty: 1, price: 100 },          // строка-разделитель парсера
    { name: 'Окраска бампера', qty: '2', price: '8500.5' },
  ],
  parts: [
    { code: '6044151400', name: 'Бампер передний', qty: 1, price: 32000 },
    { code: '', name: '', qty: 1, price: 500 },   // пустая — не берём
    { code: 'KN1234', name: '', qty: '3', price: '1200' },
    { code: '', name: 'Лакокрасочные материалы', price: 18000 },
  ],
  meta: { number: 'PVU-999', discount: 3000, repair_total: 257076, hasPaint: true },
};

test('работы: пустые строки отброшены, числа приведены, у каждой свой id', () => {
  const rows = audatexServiceRows(DATA, makeGen());
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { id: 'id1', name: 'Замена бампера переднего', qty: 1, price: 4200 });
  assert.deepEqual(rows[1], { id: 'id2', name: 'Окраска бампера', qty: 2, price: 8500.5 });
});

test('запчасти: берём позицию с названием ИЛИ артикулом, unit по умолчанию «шт.»', () => {
  const rows = audatexPartRows(DATA, makeGen());
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { id: 'id1', code: '6044151400', name: 'Бампер передний', qty: 1, unit: 'шт.', price: 32000 });
  // артикул без названия — «прочее» из сметы, его всё равно надо купить
  assert.deepEqual(rows[1], { id: 'id2', code: 'KN1234', name: '', qty: 3, unit: 'шт.', price: 1200 });
  // ЛКМ приходят без количества — это одна позиция, а не ноль
  assert.deepEqual(rows[2], { id: 'id3', code: '', name: 'Лакокрасочные материалы', qty: 1, unit: 'шт.', price: 18000 });
});

test('ИНВАРИАНТ: у каждой запчасти СВОЙ id (общий id сломал бы правку на «Запчастях»)', () => {
  const rows = audatexPartRows(DATA, makeGen());
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.ok(rows.every((r) => r.id));
});

test('мусор на входе не роняет импорт', () => {
  assert.deepEqual(audatexServiceRows(null, makeGen()), []);
  assert.deepEqual(audatexPartRows({}, makeGen()), []);
  const dirty = audatexPartRows({ parts: [{ name: 'Крыло', qty: 'абв', price: null }] }, makeGen());
  assert.deepEqual(dirty, [{ id: 'id1', code: '', name: 'Крыло', qty: 1, unit: 'шт.', price: 0 }]);
});

test('сводка: модель, счётчики, краска, скидка и итог', () => {
  // toLocaleString('ru-RU') разделяет тысячи НЕРАЗРЫВНЫМ пробелом — сверяем по обычному.
  const s = audatexSummary(DATA).replace(/\u00a0/g, ' ');
  assert.match(s, /^Geely Atlas Pro · работ: 3 · запчастей: 4 · краска: да/);
  assert.ok(s.includes('скидка: 3 000 ₽'));
  assert.ok(s.includes('итог: 257 076 ₽'));
});

test('сводка: без скидки и итога — только то, что реально распознали', () => {
  const s = audatexSummary({ services: [{ name: 'A' }], parts: [], meta: {} });
  assert.equal(s, 'работ: 1 · запчастей: 0');
});
