import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ADVANCE, DEFAULT_PAY_TYPE, payType, isFixed, payTypeLabel, money,
  masterAdvance, masterSalary, normalizeMasterPay, masterPayForm, masterPaySummary,
  buildPayRows, payRowsTotal, buildMasterEarnings, buildPayroll, payrollWindow, salaryExpenseTx,
} from './salary.js';

const MASTERS = [
  { id: 'm1', name: 'Иванов' },
  { id: 'm2', name: 'Петров' },
  { id: 'm3', name: 'Сидоров' },
];

test('payType: откат на сдельную для старых/битых записей', () => {
  assert.equal(payType({ pay_type: 'fixed' }), 'fixed');
  assert.equal(payType({ pay_type: 'piece' }), 'piece');
  assert.equal(payType({}), DEFAULT_PAY_TYPE);
  assert.equal(payType({ pay_type: 'ерунда' }), DEFAULT_PAY_TYPE);
  assert.equal(payType(null), DEFAULT_PAY_TYPE);
  assert.equal(isFixed({ pay_type: 'fixed' }), true);
  assert.equal(isFixed({}), false);
});

test('money: неотрицательное целое из любого мусора', () => {
  assert.equal(money('40000'), 40000);
  assert.equal(money(''), 0);
  assert.equal(money('', 40000), 40000);
  assert.equal(money('-5'), 0);
  assert.equal(money('абв', 100), 100);
  assert.equal(money(1234.7), 1235);
});

test('masterAdvance: по умолчанию 40 000, иначе своё', () => {
  assert.equal(masterAdvance({}), DEFAULT_ADVANCE);
  assert.equal(masterAdvance({ advance: 0 }), 0);
  assert.equal(masterAdvance({ advance: 25000 }), 25000);
});

test('masterSalary: только для оклада', () => {
  assert.equal(masterSalary({ pay_type: 'fixed', salary: 60000 }), 60000);
  assert.equal(masterSalary({ pay_type: 'piece', salary: 60000 }), 0); // у сдельного оклада нет
  assert.equal(masterSalary({ pay_type: 'fixed' }), 0);
});

test('normalizeMasterPay: форма → поля Firestore', () => {
  assert.deepEqual(
    normalizeMasterPay({ pay_type: 'fixed', advance: '40000', salary: '60000' }),
    { pay_type: 'fixed', advance: 40000, salary: 60000 },
  );
  // пустой аванс → дефолт; мусорный тип → сдельная; salary держим даже у сдельного
  assert.deepEqual(
    normalizeMasterPay({ pay_type: 'x', advance: '', salary: '' }),
    { pay_type: 'piece', advance: DEFAULT_ADVANCE, salary: 0 },
  );
});

test('masterPayForm: запись → строки для формы, со старыми дефолтами', () => {
  assert.deepEqual(
    masterPayForm({ pay_type: 'fixed', advance: 40000, salary: 60000 }),
    { pay_type: 'fixed', advance: '40000', salary: '60000' },
  );
  assert.deepEqual(
    masterPayForm({}),
    { pay_type: 'piece', advance: String(DEFAULT_ADVANCE), salary: '' },
  );
  assert.equal(masterPayForm({ advance: 0 }).advance, '0'); // явный ноль не подменяем дефолтом
});

// toLocaleString('ru-RU') разделяет тысячи узким неразрывным пробелом — сводим
// любые пробелы к обычному, чтобы тест не зависел от версии ICU.
const sp = (s) => s.replace(/\s/g, ' ');

test('masterPaySummary: человекочитаемая подпись', () => {
  assert.equal(sp(masterPaySummary({ pay_type: 'piece', advance: 40000 })), 'сдельная · аванс 40 000');
  assert.equal(sp(masterPaySummary({ pay_type: 'fixed', advance: 40000, salary: 60000 })), 'оклад 60 000 · аванс 40 000');
  assert.equal(payTypeLabel('fixed'), 'Оклад');
});

test('buildPayRows: объединяет введённую оплату и назначенных мастеров', () => {
  const job = {
    costing: { labor: [{ id: 'l1', master_id: 'm1', name: 'Иванов', amount: 25000 }] },
    stages: [
      { master_id: 'm1' },            // уже есть в labor — не дублируем
      { master_id: 'm2' },            // назначен, оплаты ещё нет → добавить с 0
      { master_id: 'm2' },            // тот же мастер второй раз → один раз
      { master_id: '' },              // без мастера — пропустить
    ],
  };
  const rows = buildPayRows(job, MASTERS);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { id: 'l1', master_id: 'm1', name: 'Иванов', amount: 25000 });
  assert.deepEqual(rows[1], { id: 'st-m2', master_id: 'm2', name: 'Петров', amount: 0 });
  // Все id уникальны (React keys)
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
});

test('buildPayRows: имя подтягивается из справочника, пустой job → []', () => {
  const rows = buildPayRows({ stages: [{ master_id: 'm3' }] }, MASTERS);
  assert.deepEqual(rows, [{ id: 'st-m3', master_id: 'm3', name: 'Сидоров', amount: 0 }]);
  assert.deepEqual(buildPayRows({}, MASTERS), []);
  assert.deepEqual(buildPayRows(null, null), []);
});

test('payRowsTotal: сумма, мусор игнорируется', () => {
  assert.equal(payRowsTotal([{ amount: 25000 }, { amount: '18000' }, { amount: '' }, { amount: -5 }]), 43000);
  assert.equal(payRowsTotal([]), 0);
  assert.equal(payRowsTotal(null), 0);
});

// jobs как из buildGantt: с costing.labor (суммы) и stages (статус работ мастера).
const EARN_JOBS = [
  { // m1 закрыл свой этап → готово к выплате; сумма 25 000
    id: 'j1', car_model: 'Toyota Camry', plate_number: 'K456TT', order_number: '110', client_name: 'Смирнов',
    costing: { labor: [{ master_id: 'm1', name: 'Иванов', amount: 25000 }, { master_id: 'm2', name: 'Петров', amount: 9000 }] },
    stages: [{ master_id: 'm1', status: 'done' }, { master_id: 'm2', status: 'planned' }],
  },
  { // m1 ещё в работе; сумма 18 000
    id: 'j2', car_model: 'Kia Rio', plate_number: 'A007KX', order_number: '102',
    costing: { labor: [{ master_id: 'm1', name: 'Иванов', amount: 18000 }] },
    stages: [{ master_id: 'm1', status: 'in_progress' }],
  },
  { // чужая машина (m3) — не должна попасть к m1
    id: 'j3', car_model: 'BMW X5',
    costing: { labor: [{ master_id: 'm3', name: 'Сидоров', amount: 30000 }] },
    stages: [{ master_id: 'm3', status: 'done' }],
  },
];

test('buildMasterEarnings: только свои машины, статус по своим этапам', () => {
  const r = buildMasterEarnings({ id: 'm1', pay_type: 'piece', advance: 40000 }, { jobs: EARN_JOBS });
  assert.equal(r.isFixed, false);
  assert.equal(r.cards.length, 2);                 // j1, j2 — не j3
  assert.ok(!r.cards.some((c) => c.jobId === 'j3'));
  const j1 = r.cards.find((c) => c.jobId === 'j1');
  const j2 = r.cards.find((c) => c.jobId === 'j2');
  assert.equal(j1.amount, 25000); assert.equal(j1.ready, true);   // свой этап done
  assert.equal(j2.amount, 18000); assert.equal(j2.ready, false);  // in_progress
  assert.equal(r.cards[0].jobId, 'j1');            // готовое — первым
  assert.deepEqual(r.totals, { ready: 25000, inProgress: 18000, total: 43000, cars: 2 });
  assert.equal(r.pay.advance, 40000);
});

test('buildMasterEarnings: оклад — pay.salary, машины всё равно видны', () => {
  const r = buildMasterEarnings({ id: 'm2', pay_type: 'fixed', advance: 40000, salary: 60000 }, { jobs: EARN_JOBS });
  assert.equal(r.isFixed, true);
  assert.equal(r.pay.salary, 60000);
  assert.equal(r.cards.length, 1);                 // m2 назначен на j1
  assert.equal(r.cards[0].jobId, 'j1');
});

test('buildMasterEarnings: нет мастера / нет машин → пусто', () => {
  assert.deepEqual(buildMasterEarnings(null, { jobs: EARN_JOBS }).cards, []);
  assert.deepEqual(buildMasterEarnings({ id: 'm1' }, {}).cards, []);
  const empty = buildMasterEarnings({ id: 'zzz', pay_type: 'piece' }, { jobs: EARN_JOBS });
  assert.deepEqual(empty.totals, { ready: 0, inProgress: 0, total: 0, cars: 0 });
});

test('payrollWindow: 15–20 аванс, 1–5 расчёт, иначе нет', () => {
  const day = (d) => new Date(2026, 6, d, 12).getTime();
  assert.equal(payrollWindow(day(3)), 'settlement');
  assert.equal(payrollWindow(day(17)), 'advance');
  assert.equal(payrollWindow(day(9)), 'none');
  assert.equal(payrollWindow(day(25)), 'none');
});

test('buildPayroll: заработано − выдано в этом месяце = к выплате', () => {
  const masters = [
    { id: 'm1', name: 'Иванов', pay_type: 'piece', advance: 40000 },   // готово 25 000 (j1)
    { id: 'm2', name: 'Петров', pay_type: 'fixed', advance: 40000, salary: 60000 },
    { id: 'm3', name: 'Сидоров', pay_type: 'piece', advance: 40000 },  // готово 30 000 (j3)
  ];
  const now = new Date(2026, 6, 17, 12).getTime();          // 17 июля — окно аванса
  const lastMonth = new Date(2026, 5, 20, 12).getTime();    // 20 июня — прошлый месяц
  const payments = [
    { master_id: 'm1', kind: 'advance', amount: 40000, created_at: new Date(2026, 6, 16, 10).getTime() }, // выдан аванс в этом месяце
    { master_id: 'm3', kind: 'advance', amount: 40000, created_at: lastMonth },                            // прошлый месяц — не в счёт
  ];
  const { rows, window, totals } = buildPayroll(masters, EARN_JOBS, payments, now);
  assert.equal(window, 'advance');
  const m1 = rows.find((r) => r.masterId === 'm1');
  const m2 = rows.find((r) => r.masterId === 'm2');
  const m3 = rows.find((r) => r.masterId === 'm3');
  assert.equal(m1.earnedReady, 25000); assert.equal(m1.paidThisMonth, 40000);
  assert.equal(m1.owed, 0); assert.equal(m1.advanceGiven, true);      // аванс(40к) > заработано(25к) → к выплате 0 (гарант.)
  assert.equal(m2.earnedReady, 60000); assert.equal(m2.owed, 60000); assert.equal(m2.isFixed, true); // оклад
  assert.equal(m3.earnedReady, 30000); assert.equal(m3.paidThisMonth, 0); // прошломесячный аванс не учтён
  assert.equal(m3.owed, 30000); assert.equal(m3.advanceGiven, false);
  assert.equal(totals.owed, 90000);                                   // 0 + 60000 + 30000
});

test('salaryExpenseTx: только оклады → расход P&L, сдельные исключены', () => {
  const payments = [
    { id: 'p1', master_id: 'm2', master_name: 'Петров', kind: 'advance', amount: 40000, pay_type: 'fixed', created_at: 111 },
    { id: 'p2', master_id: 'm1', master_name: 'Иванов', kind: 'advance', amount: 40000, pay_type: 'piece', created_at: 222 }, // сдельный — не в P&L
    { id: 'p3', master_id: 'm2', master_name: 'Петров', kind: 'settlement', amount: 20000, pay_type: 'fixed', created_at: 333 },
  ];
  const tx = salaryExpenseTx(payments);
  assert.equal(tx.length, 2);                        // только оклады m2
  assert.ok(tx.every((t) => t.direction === 'expense' && t.category === 'Зарплаты / оклады'));
  assert.deepEqual(tx.map((t) => t.amount), [40000, 20000]);
  assert.equal(tx[0].id, 'salary-p1');
  assert.equal(tx[0].date, 111);                     // дата = created_at выплаты
  assert.deepEqual(salaryExpenseTx([]), []);
  assert.deepEqual(salaryExpenseTx(null), []);
});
