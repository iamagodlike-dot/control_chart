// Regression guard for the two spec rules in parts.js. Zero-dependency —
// run with:  node --test src/parts.test.js
// These rules are deliberate (CLAUDE.md / BACKEND_SPEC §12.2, §13) — do NOT
// "simplify" costed-only rentability back to counting every position.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partNeedsOrderInfo, partsFin, partRentab, buildPartsVM, withPartIds } from './parts.js';

test('§13 — need→ordered requires supplier AND cost>0', () => {
  assert.equal(partNeedsOrderInfo({ supplier: '', cost: 0 }), true);
  assert.equal(partNeedsOrderInfo({ supplier: 'Exist', cost: 0 }), true);
  assert.equal(partNeedsOrderInfo({ supplier: '', cost: 100 }), true);
  assert.equal(partNeedsOrderInfo({ supplier: '  ', cost: 100 }), true); // whitespace ≠ supplier
  assert.equal(partNeedsOrderInfo({ supplier: 'Exist', cost: 100 }), false);
});

test('§12.2 — margin/rentability use ONLY costed (cost>0) positions', () => {
  const parts = [
    { cost: 100, price: 200, qty: 1, status: 'in' },   // costed
    { cost: 0, price: 300, qty: 1, status: 'in' },     // priced, no cost → excluded + flagged
    { cost: 0, price: 0, qty: 1, status: 'need' },      // need → excluded, NOT flagged
  ];
  const f = partsFin(parts);
  assert.equal(f.totalOrder, 500, 'сумма по ЗН считает все позиции');
  assert.equal(f.rentBase, 200, 'база рентабельности — только costed');
  assert.equal(f.margin, 100);
  assert.equal(f.rentab, 50);
  assert.equal(f.missingCost, 1, 'без себестоимости флажим только не-need');
  assert.equal(f.costedCount, 1);
});

test('§12.2 — no costed positions → rentab is null (not 0/100%)', () => {
  const f = partsFin([{ cost: 0, price: 500, qty: 2, status: 'in' }]);
  assert.equal(f.rentab, null);
  assert.equal(f.margin, 0);
  assert.equal(f.totalOrder, 1000);
});

test('скидка — размазывается по всей выручке ЗН, в маржу берётся costed-доля', () => {
  const parts = [
    { cost: 42000, price: 60000, qty: 1, status: 'in' },   // costed → база 60 000
    { cost: 0, price: 40000, qty: 1, status: 'need' },       // без себест. → в базу не входит
  ];
  // totalOrder=100 000, rentBase=60 000, margin=18 000 (30%)
  const f = partsFin(parts, 0, 15000);
  assert.equal(Math.round(f.discountApplied), 9000, 'скидка 15 000 × 60 000/100 000 = 9 000');
  assert.equal(Math.round(f.netMargin), 9000, 'чистая маржа = 18 000 − 9 000');
  assert.equal(f.netRentab, 15, 'чистая рентаб. = 9 000/60 000');
  assert.equal(f.margin, 18000, 'грязная маржа не меняется');
  assert.equal(f.rentab, 30);
});

test('скидка — при полностью заполненных закупках вычитается целиком', () => {
  const parts = [{ cost: 70000, price: 100000, qty: 1, status: 'in' }];
  const f = partsFin(parts, 0, 15000);
  assert.equal(Math.round(f.discountApplied), 15000);
  assert.equal(Math.round(f.netMargin), 15000); // 30 000 − 15 000
  assert.equal(f.netRentab, 15);
});

test('скидка — без скидки поля net совпадают с грязными', () => {
  const f = partsFin([{ cost: 70000, price: 100000, qty: 1, status: 'in' }]);
  assert.equal(f.discountApplied, 0);
  assert.equal(f.netMargin, f.margin);
  assert.equal(f.netRentab, f.rentab);
});

test('скидка в buildPartsVM — флаги и «чистые» итоги по машине', () => {
  const cars = { c1: { model: 'BMW', discount: 15000 } };
  const parts = [
    { id: 'a', carId: 'c1', name: 'A', cost: 42000, price: 60000, qty: 1, status: 'in' },
    { id: 'b', carId: 'c1', name: 'B', cost: 0, price: 40000, qty: 1, status: 'need' },
  ];
  const vm = buildPartsVM({ parts, cars });
  assert.equal(vm.hasDiscountTotal, true);
  assert.equal(vm.groups[0].hasDiscount, true);
  // 9 000 применено (60 000/100 000 от 15 000); netMargin 9 000 → +, netRentab 15%
  assert.match(vm.groups[0].netRentabStr, /15%/);
  assert.ok(vm.groups[0].netMarginStr.startsWith('+'));
  // без скидки в cars → флаги выключены
  const vm0 = buildPartsVM({ parts, cars: { c1: { model: 'BMW' } } });
  assert.equal(vm0.hasDiscountTotal, false);
  assert.equal(vm0.groups[0].hasDiscount, false);
});

test('§12.1 — per-line rentability only when both cost & price set', () => {
  assert.equal(partRentab({ cost: 0, price: 300 }).has, false);
  assert.equal(partRentab({ cost: 100, price: 0 }).has, false);
  assert.deepEqual(partRentab({ cost: 100, price: 200 }), { has: true, pct: 50 });
  assert.deepEqual(partRentab({ cost: 250, price: 200 }), { has: true, pct: -25 }); // loss
});

// ---- «замороженный» порядок строк -------------------------------------------
const rowIds = (vm, i = 0) => vm.groups[i].rows.map((r) => r.id);
const carIds = (vm) => vm.groups.map((g) => g.carId);

test('freeze — без снимка сортирует канонически (по приоритету статуса)', () => {
  const cars = { c1: { model: 'BMW' } };
  const parts = [
    { id: 'a', carId: 'c1', name: 'A', status: 'need' },
    { id: 'b', carId: 'c1', name: 'B', status: 'need' },
  ];
  // оба need → по названию: a, b
  assert.deepEqual(rowIds(buildPartsVM({ parts, cars })), ['a', 'b']);
  // сменили a → issued (pr 3): канонически b (need) уходит вперёд a
  const p2 = parts.map((p) => (p.id === 'a' ? { ...p, status: 'issued' } : p));
  assert.deepEqual(rowIds(buildPartsVM({ parts: p2, cars })), ['b', 'a']);
});

test('freeze — снимок держит позицию строки при смене статуса', () => {
  const cars = { c1: { model: 'BMW' } };
  const frozen = { cars: ['c1'], parts: { c1: ['a', 'b'] } };
  const p2 = [
    { id: 'a', carId: 'c1', name: 'A', status: 'issued' }, // статус ушёл вперёд
    { id: 'b', carId: 'c1', name: 'B', status: 'need' },
  ];
  // несмотря на issued, a остаётся первой — порядок закреплён снимком
  assert.deepEqual(rowIds(buildPartsVM({ parts: p2, cars, frozenOrder: frozen })), ['a', 'b']);
});

test('freeze — новая позиция уходит в конец своей группы', () => {
  const cars = { c1: { model: 'BMW' } };
  const frozen = { cars: ['c1'], parts: { c1: ['a', 'b'] } };
  const parts = [
    { id: 'a', carId: 'c1', name: 'A', status: 'issued' },
    { id: 'b', carId: 'c1', name: 'B', status: 'need' },
    { id: 'c', carId: 'c1', name: 'AAA', status: 'need' }, // добавлена после заморозки
  ];
  assert.deepEqual(rowIds(buildPartsVM({ parts, cars, frozenOrder: frozen })), ['a', 'b', 'c']);
});

test('freeze — порядок карточек авто закреплён; новая машина в конец', () => {
  const cars = { c1: { model: 'Zil' }, c2: { model: 'Audi' }, c3: { model: 'Kia' } };
  const parts = [
    { id: 'a', carId: 'c1', name: 'A', status: 'issued' }, // c1 хуже по статусу
    { id: 'b', carId: 'c2', name: 'B', status: 'need' },
    { id: 'd', carId: 'c3', name: 'D', status: 'need' },    // c3 не в снимке
  ];
  // канонически: need-машины впереди issued → c2, c3, c1
  assert.deepEqual(carIds(buildPartsVM({ parts, cars })), ['c2', 'c3', 'c1']);
  // снимок закрепляет c1, c2; новая c3 — в конец
  const frozen = { cars: ['c1', 'c2'], parts: { c1: ['a'], c2: ['b'] } };
  assert.deepEqual(carIds(buildPartsVM({ parts, cars, frozenOrder: frozen })), ['c1', 'c2', 'c3']);
});

test('flash — flashId помечает строку флагом flash', () => {
  const cars = { c1: { model: 'BMW' } };
  const parts = [
    { id: 'a', carId: 'c1', name: 'A', status: 'need' },
    { id: 'b', carId: 'c1', name: 'B', status: 'need' },
  ];
  const vm = buildPartsVM({ parts, cars, flashId: 'a' });
  assert.equal(vm.groups[0].rows.find((r) => r.id === 'a').flash, true);
  assert.equal(vm.groups[0].rows.find((r) => r.id === 'b').flash, false);
});

// Root cause of "удаляю запчасть, а она не исчезает": Audatex imports стороны saved
// parts without an id, so removePart/savePart (keyed by id) never matched them.
test('withPartIds — присваивает id только позициям без id, не трогая остальные поля', () => {
  const imported = [
    { code: 'A1', name: 'Бампер', qty: 1, unit: 'шт.', price: 5000 }, // no id (Audatex)
    { id: 'p_keep', code: 'B2', name: 'Фара', qty: 2, price: 3000 },  // already has id
  ];
  const out = withPartIds(imported);
  assert.ok(out[0].id, 'позиции без id присвоен id');
  assert.equal(out[1].id, 'p_keep', 'существующий id сохранён');
  // всё остальное — без изменений (unit из импорта не теряется)
  assert.deepEqual({ ...out[0], id: undefined }, { code: 'A1', name: 'Бампер', qty: 1, unit: 'шт.', price: 5000, id: undefined });
});

test('withPartIds — идемпотентна: id стабилен при повторном вызове', () => {
  const once = withPartIds([{ code: 'A1', name: 'Бампер', qty: 1 }]);
  const twice = withPartIds(once);
  assert.equal(once[0].id, twice[0].id, 'повторный проход не меняет уже присвоенный id');
});
