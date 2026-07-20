// Regression guard for the two spec rules in parts.js. Zero-dependency —
// run with:  node --test src/parts.test.js
// These rules are deliberate (CLAUDE.md / BACKEND_SPEC §12.2, §13) — do NOT
// "simplify" costed-only rentability back to counting every position.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partNeedsOrderInfo, partsFin, partRentab, buildPartsVM, withPartIds, partStatusMeta } from './parts.js';

test('статусы: «Выставлен счёт» между need и ordered, «Приехало» между ordered и «На складе»', () => {
  const ids = partStatusMeta.map((s) => s.id);
  assert.deepEqual(ids, ['need', 'invoiced', 'ordered', 'arrived', 'in', 'issued']);
  // приоритеты строго по порядку 0..5 — от этого зависит onAdvance (pr+1)
  assert.deepEqual(partStatusMeta.map((s) => s.pr), [0, 1, 2, 3, 4, 5]);
});

test('buildPartsVM — «Приехало» считается и даёт кнопку «на склад» (advIsToStock)', () => {
  const cars = { c1: { model: 'BMW' } };
  const parts = [
    { id: 'a', carId: 'c1', name: 'A', supplier: 'Exist', cost: 100, price: 200, status: 'arrived' },
    { id: 'b', carId: 'c1', name: 'B', status: 'ordered' },
  ];
  const vm = buildPartsVM({ parts, cars });
  // чип «Приехало» есть и считает позицию
  const chip = vm.statusChips.find((s) => s.id === 'arrived');
  assert.ok(chip);
  assert.equal(chip.count, 1);
  // строка arrived предлагает следующий шаг → «привезли на склад», не «заказать/выдать»
  const row = vm.groups[0].rows.find((r) => r.id === 'a');
  assert.equal(row.advIsToStock, true);
  assert.equal(row.advIsArrive, false);
  assert.equal(row.advIsIssue, false);
  // «Приехало» — позиция, требующая действия (забрать) → в actionNeeded
  assert.equal(vm.actionNeeded, 2); // arrived (a) + ordered (b)
});

test('buildPartsVM — комментарий позиции пробрасывается в строку (comment/hasComment)', () => {
  const cars = { c1: { model: 'Lada' } };
  const parts = [
    { id: 'a', carId: 'c1', name: 'Бампер', status: 'ordered', comment: 'предоплата 50%' },
    { id: 'b', carId: 'c1', name: 'Фара', status: 'need' },              // без комментария
    { id: 'd', carId: 'c1', name: 'Капот', status: 'need', comment: '   ' }, // пробелы ≠ комментарий
  ];
  const vm = buildPartsVM({ parts, cars });
  const rows = vm.groups[0].rows;
  const ra = rows.find((r) => r.id === 'a');
  const rb = rows.find((r) => r.id === 'b');
  const rd = rows.find((r) => r.id === 'd');
  assert.equal(ra.comment, 'предоплата 50%');
  assert.equal(ra.hasComment, true);
  assert.equal(rb.comment, '');
  assert.equal(rb.hasComment, false);
  assert.equal(rd.hasComment, false); // только пробелы → не считаем комментарием
});

test('buildPartsVM — фильтр «без себестоимости» (nocost) показывает только заказанные без закупки', () => {
  const cars = { c1: { model: 'BMW' } };
  const parts = [
    { id: 'a', carId: 'c1', name: 'A', supplier: 'Exist', cost: 100, price: 200, status: 'ordered' }, // с себест. → скрыт
    { id: 'b', carId: 'c1', name: 'B', supplier: 'Exist', cost: 0, price: 300, status: 'ordered' },   // без себест. → показан
    { id: 'd', carId: 'c1', name: 'D', cost: 0, price: 0, status: 'need' },                            // «Требуется» → не флажим, скрыт
  ];
  const vmAll = buildPartsVM({ parts, cars });
  assert.equal(vmAll.missingCost, 1, 'бейдж считает 1 позицию без себестоимости');
  assert.equal(vmAll.missingActive, false);

  const vm = buildPartsVM({ parts, cars, filter: 'nocost' });
  assert.equal(vm.missingActive, true, 'фильтр активен');
  const rowIds = vm.groups.flatMap((g) => g.rows.map((r) => r.id));
  assert.deepEqual(rowIds, ['b'], 'в списке только позиция без себестоимости, «Требуется» исключён');
});

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
  // сменили a → issued (pr 5): канонически b (need) уходит вперёд a
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

// ===== Регрессия: метка «страховая ↔ допродажа» и ячейки склада =====
// Оба бага были ЖИВЫМИ в проде и невидимыми в демо.

// Лампочка плательщика показывается только у страховых машин (isInsuranceCar).
// В проде Parts.jsx не прокидывал payment_type → jobShell подставлял 'cash' →
// carInsurance всегда false → лампочки не было ни на одной машине. В demo поле
// передавалось, поэтому там всё работало — расхождение и маскировало регрессию.
test('buildPartsVM — метка плательщика включается payment_type машины, а не наличием payer', () => {
  const parts = [
    { id: 'a', carId: 'c1', name: 'Бампер', status: 'need' },                     // без payer → страховая
    { id: 'b', carId: 'c1', name: 'Коврики', status: 'need', payer: 'client' },   // допродажа
  ];
  const ins = buildPartsVM({ parts, cars: { c1: { model: 'BMW', payment_type: 'insurance' } } });
  assert.equal(ins.groups[0].isInsuranceCar, true, 'страховая машина → группа помечена');
  assert.equal(ins.groups[0].extrasCount, 1, 'допродажи посчитаны');
  assert.deepEqual(ins.groups[0].rows.map((r) => r.payer), ['insurance', 'client']);
  assert.equal(ins.groups[0].rows[0].isInsuranceCar, true, 'лампочка рендерится (isInsuranceCar у строки)');

  // Наличная машина — метки нет вообще, даже если у позиции лежит payer.
  const cash = buildPartsVM({ parts, cars: { c1: { model: 'BMW', payment_type: 'cash' } } });
  assert.equal(cash.groups[0].isInsuranceCar, false);
  assert.equal(cash.groups[0].extrasCount, 0);
  assert.equal(cash.groups[0].rows[0].isInsuranceCar, false, 'у наличной машины лампочки нет');
});

// Ячейки ищутся по связи job.cell_ids, а НЕ по гос.номеру: номер не уникален
// (задвоенные машины), и раньше каждая из них показывала ячейки чужой карточки.
test('buildPartsVM — ячейки берутся по cell_ids машины, а не по совпадению гос.номера', () => {
  const cars = {
    c1: { model: 'BMW', plate: 'А123ВС196', cell_ids: ['A-01'] },
    c2: { model: 'BMW', plate: 'А123ВС196', cell_ids: ['B-02'] }, // тот же номер — дубль
  };
  const parts = [
    { id: 'a', carId: 'c1', name: 'Бампер', status: 'need' },
    { id: 'b', carId: 'c2', name: 'Фара', status: 'need' },
  ];
  const cells = {
    'A-01': { orderNum: 'ЗН-2026-0001', parts: [{ qty: 2 }] },
    'B-02': { orderNum: 'ЗН-2026-0002', parts: [{ qty: 1 }] },
  };
  const vm = buildPartsVM({ parts, cars, cells });
  const g1 = vm.groups.find((g) => g.carId === 'c1');
  const g2 = vm.groups.find((g) => g.carId === 'c2');
  assert.deepEqual(g1.cells.map((x) => x.id), ['A-01'], 'машина видит ТОЛЬКО свою ячейку');
  assert.deepEqual(g2.cells.map((x) => x.id), ['B-02'], 'дубль с тем же номером не подмешивается');
  assert.equal(g1.cells[0].count, 2, 'позиции в ячейке посчитаны');
  assert.equal(g1.hasCells, true);

  // Машина без ячеек — пусто, а не «все ячейки без гос.номера».
  const noCells = buildPartsVM({ parts: [{ id: 'a', carId: 'c1', name: 'Бампер' }], cars: { c1: { model: 'BMW' } }, cells });
  assert.deepEqual(noCells.groups[0].cells, []);
  assert.equal(noCells.groups[0].hasCells, false);
});

// ===== Несколько убытков на экране «Запчасти» =====
test('buildPartsVM — один убыток: прежняя бинарная лампочка, селектора нет', () => {
  const cars = { c1: { model: 'BMW', payment_type: 'insurance', claim_number: 'PVU-1' } };
  const parts = [
    { id: 'a', carId: 'c1', name: 'Дверь', status: 'need' },
    { id: 'b', carId: 'c1', name: 'Коврики', status: 'need', payer: 'client' },
  ];
  const vm = buildPartsVM({ parts, cars });
  const g = vm.groups[0];
  assert.equal(g.rows[0].payerMulti, false, 'селектор не нужен');
  assert.deepEqual(g.rows[0].payerOptions, []);
  assert.deepEqual(g.rows.map((r) => r.payer), ['insurance', 'client']);
  assert.equal(g.rows[0].isExtra, false);
  assert.equal(g.rows[1].isExtra, true);
});

test('buildPartsVM — два убытка: селектор потока со всеми делами + допродажи', () => {
  const cars = { c1: { model: 'BMW', payment_type: 'insurance', claims: [
    { id: 'insurance', claim_number: 'PVU-123' },
    { id: 'cl_x7', claim_number: 'PVU-999' },
  ] } };
  const parts = [
    { id: 'a', carId: 'c1', name: 'Дверь', status: 'need' },                    // убыток №1 (без метки)
    { id: 'b', carId: 'c1', name: 'Бампер', status: 'need', payer: 'cl_x7' },   // убыток №2
    { id: 'c', carId: 'c1', name: 'Коврики', status: 'need', payer: 'client' }, // допродажа
  ];
  const vm = buildPartsVM({ parts, cars });
  const g = vm.groups[0];
  assert.equal(g.rows[0].payerMulti, true);
  // Подписи в селекторе — короткие: строка запчасти плотная, полный вариант с
  // номером убытка обрезался бы до нечитаемого «Убыток 2 · PV…».
  assert.deepEqual(g.rows[0].payerOptions, [
    { value: 'insurance', label: 'Убыток 1' },
    { value: 'cl_x7', label: 'Убыток 2' },
    { value: 'client', label: 'Допродажа' },
  ]);
  // Каждая позиция знает СВОЁ дело — не схлопывается в первое.
  const byId = Object.fromEntries(g.rows.map((r) => [r.id, r]));
  assert.equal(byId.a.payer, 'insurance');
  assert.equal(byId.b.payer, 'cl_x7');
  assert.equal(byId.c.payer, 'client');
  assert.equal(byId.a.payerStreamLabel, 'Убыток 1 · PVU-123');
  assert.equal(byId.b.payerStreamLabel, 'Убыток 2 · PVU-999');
  assert.equal(byId.c.payerStreamLabel, 'Допродажа');
  // Допродажи считаются по метке 'client', а не «всё, что не убыток №1».
  assert.equal(g.extrasCount, 1);
});

test('buildPartsVM — наличная машина: метки потока нет, даже если у машины есть claims', () => {
  const cars = { c1: { model: 'BMW', payment_type: 'cash', claims: [{ id: 'insurance' }, { id: 'cl_x7' }] } };
  const vm = buildPartsVM({ parts: [{ id: 'a', carId: 'c1', name: 'Фильтр' }], cars });
  assert.equal(vm.groups[0].isInsuranceCar, false);
  assert.equal(vm.groups[0].rows[0].payerMulti, false);
});
