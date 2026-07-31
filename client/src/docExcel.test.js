// Проверка выгрузки документа в Excel. Без зависимостей — запуск:
//   node --test src/docExcel.test.js
// Главное, что здесь стережём: (1) файл — валидный zip с обязательными частями
// OOXML (иначе Excel скажет «файл повреждён»); (2) суммы лежат ЧИСЛАМИ, а не
// строками «12 300 ₽» — иначе по колонке нельзя посчитать итог.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocSheet, docExcelFileName } from './docExcel.js';
import { sheetsToXlsx, colName, safeSheetName, safeFileName, esc, crc32 } from './xlsx.js';
import { buildOrderSnapshot, buildInvoiceSnapshot, buildHandoverSnapshot, buildActSnapshot } from './orderDoc.js';

const COMPANY = {
  name: 'ИП Иванов', inn: '246300000000', ogrn: '318246800000000',
  address: 'Красноярск, ул. Свободы, 1', phone: '+7 999 000-00-00', director: 'Иванов И.И.',
  bank_name: 'ФИЛИАЛ БАНКА', bik: '040407627', account: '40802810000000000001', corr_account: '30101810000000000001',
};

const JOB = {
  id: 'job1', car_model: 'Geely Atlas', plate_number: 'Х123УС124', vin: 'LB37622Z0KX000001',
  year: '2021', mileage: '48 000', client_name: 'Петров П.П.', client_phone: '+7 913 000-00-00',
  payment_type: 'insurance', insurer_name: 'Ингосстрах', claim_number: 'У-123/24', policy_type: 'kasko',
  discount: 1000, prepayment: 5000,
  services: [{ id: 's1', name: 'Окраска капота', qty: 1, price: 12000 }],
  parts: [{ id: 'p1', code: '6044151400', name: 'Бампер передний', qty: 2, unit: 'шт.', price: 8500 }],
};

// Все ячейки листа одним массивом — так удобнее искать.
function cellsOf(sheet) {
  return sheet.rows.flatMap((r) => (Array.isArray(r) ? r : r.cells)).filter(Boolean);
}
function values(sheet) {
  return cellsOf(sheet).map((c) => (typeof c === 'object' ? c.v : c));
}

test('заказ-наряд: шапка, позиции и итоги попадают на лист', () => {
  const snap = buildOrderSnapshot(JOB, COMPANY, 'all');
  const sheet = buildDocSheet(snap);
  const v = values(sheet);
  assert.ok(v.includes('ЗАКАЗ-НАРЯД'));
  assert.ok(v.includes('Окраска капота'));
  assert.ok(v.includes('Бампер передний'));
  assert.ok(v.includes('6044151400'));
  assert.ok(v.includes('Geely Atlas'));
  assert.ok(v.includes('Х123УС124'));
  // Страховой блок печатается только у страховых машин — здесь она страховая.
  assert.ok(v.includes('У-123/24'));
});

test('суммы — числа с денежным стилем, а не текст', () => {
  const snap = buildOrderSnapshot(JOB, COMPANY, 'all');
  const sheet = buildDocSheet(snap);
  const cells = cellsOf(sheet).filter((c) => typeof c === 'object');
  // 2 × 8500 = 17000 — сумма строки запчасти
  const line = cells.find((c) => c.v === 17000);
  assert.ok(line, 'сумма строки должна быть числом 17000');
  assert.equal(line.s, 'money');
  // Итого: (12000 + 17000) − 1000 скидки = 28000
  const total = cells.find((c) => c.v === 28000 && c.s === 'total');
  assert.ok(total, 'ИТОГО должно быть числом 28000');
  // Ни одна ячейка не должна содержать «12 000 ₽» строкой
  assert.ok(!values(sheet).some((x) => typeof x === 'string' && /\d\s?₽/.test(x)));
});

test('счёт: реквизиты банка и НДС на листе, позиции одним списком', () => {
  const snap = { ...buildInvoiceSnapshot(JOB, COMPANY, null, 'all'), vat_mode: 'vat20' };
  const sheet = buildDocSheet(snap);
  const v = values(sheet);
  assert.ok(v.includes('СЧЁТ НА ОПЛАТУ'));
  assert.ok(v.includes('40802810000000000001'));
  assert.ok(v.includes('В том числе НДС 20%'));
  // Работа и запчасть в одной таблице
  assert.ok(v.includes('Окраска капота') && v.includes('Бампер передний'));
  assert.ok(!v.includes('Перечень работ (услуг)'));
});

test('акт приёма-передачи: без таблиц позиций, с пробегом и состоянием', () => {
  const job = { ...JOB, condition_in: 'Царапина на двери' };
  const snap = buildHandoverSnapshot(job, COMPANY, 'all', 'intake');
  const sheet = buildDocSheet(snap);
  const v = values(sheet);
  assert.ok(v.some((x) => typeof x === 'string' && x.startsWith('АКТ ПРИЁМА-ПЕРЕДАЧИ ТС (ПРИЁМ')));
  assert.ok(v.includes('48 000'));
  assert.ok(v.includes('Царапина на двери'));
  assert.ok(!v.includes('Наименование'), 'таблицы позиций в акте ПП быть не должно');
});

test('акт выполненных работ строится и содержит текст акта', () => {
  const snap = buildActSnapshot(JOB, COMPANY, null, 'all');
  const sheet = buildDocSheet(snap);
  const v = values(sheet);
  assert.ok(v.includes('АКТ ВЫПОЛНЕННЫХ РАБОТ'));
  assert.ok(v.some((x) => typeof x === 'string' && x.includes('претензий не имеет')));
});

test('пустой документ не ломает лист', () => {
  const sheet = buildDocSheet({});
  assert.ok(sheet.rows.length > 0);
  assert.ok(values(sheet).includes('ЗАКАЗ-НАРЯД'));
  assert.ok(values(sheet).includes('Позиции не добавлены'));
});

test('имя файла — тип, номер и гос. номер', () => {
  const snap = buildOrderSnapshot({ ...JOB, order_number: 'ЗН-2026-0007' }, COMPANY, 'all');
  assert.equal(docExcelFileName(snap), 'Заказ-наряд ЗН-2026-0007 Х123УС124');
  assert.equal(safeFileName('Счёт №1/2 "А"'), 'Счёт №1 2 А');
});

test('объединения ссылаются на существующие строки и не выходят за колонки', () => {
  const sheet = buildDocSheet(buildOrderSnapshot(JOB, COMPANY, 'all'));
  for (const m of sheet.merges) {
    const [from, to] = m.split(':');
    const rf = Number(from.replace(/[A-Z]/g, ''));
    const rt = Number(to.replace(/[A-Z]/g, ''));
    assert.equal(rf, rt, `объединение в одну строку: ${m}`);
    assert.ok(rf >= 1 && rf <= sheet.rows.length, `строка существует: ${m}`);
    assert.ok(to.replace(/\d/g, '') <= 'G', `не выходит за колонку G: ${m}`);
  }
});

test('файл .xlsx — валидный zip с обязательными частями', () => {
  const bytes = sheetsToXlsx([buildDocSheet(buildOrderSnapshot(JOB, COMPANY, 'all'))]);
  assert.ok(bytes.length > 1000);
  // Сигнатура локального заголовка zip
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const text = new TextDecoder('latin1').decode(bytes);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
    assert.ok(text.includes(part), `в архиве есть ${part}`);
  }
  // Запись End of central directory на месте
  assert.ok(text.includes('PK\x05\x06'));
});

test('служебные помощники xlsx', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(6), 'G');
  assert.equal(colName(26), 'AA');
  assert.equal(safeSheetName('Счёт/на:оплату'), 'Счёт на оплату');
  assert.equal(safeSheetName('', 'Лист1'), 'Лист1');
  assert.equal(esc('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  // Контрольная сумма из спецификации zip для строки "123456789"
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});
