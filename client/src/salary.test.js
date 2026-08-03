import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ADVANCE, DEFAULT_PAY_TYPE, payType, isFixed, payTypeLabel, money,
  masterAdvance, masterSalary, normalizeMasterPay, masterPayForm, masterPaySummary,
  buildMasterEarnings, buildPayroll, payrollWindow, salaryExpenseTx,
} from './salary.js';

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

// ── Наряд мастерам: сумма мастера из его работ ─────────────────────────────
const WORK_JOBS = [
  { // наряд расписан: m1 делает две работы, m2 одну, одна ничья
    id: 'w1', car_model: 'Kia Rio', plate_number: 'A111AA', order_number: '210', client_name: 'Орлов',
    costing: {
      works: [
        { id: 'a', name: 'Снятие бампера', qty: 1, price: 3000, master_id: 'm1', master_name: 'Иванов' },
        { id: 'b', name: 'Окраска', qty: 2, price: 2500, master_id: 'm1', master_name: 'Иванов' },
        { id: 'c', name: 'Полировка', qty: 1, price: 4000, master_id: 'm2', master_name: 'Петров' },
        { id: 'd', name: 'Сборка', qty: 1, price: 7000, master_id: '', master_name: '' },
      ],
      labor: [{ master_id: 'm1', name: 'Иванов', amount: 8000 }, { master_id: 'm2', name: 'Петров', amount: 4000 }],
    },
    stages: [{ master_id: 'm1', status: 'done' }, { master_id: 'm2', status: 'in_progress' }],
  },
];

test('buildMasterEarnings: сумма мастера = его работы наряда + перечень', () => {
  const e = buildMasterEarnings({ id: 'm1', name: 'Иванов' }, { jobs: WORK_JOBS });
  assert.equal(e.cards.length, 1);
  const c = e.cards[0];
  assert.equal(c.amount, 8000);                    // 3000 + 2×2500, чужие работы не в счёт
  assert.equal(c.ready, true);                     // свои этапы закрыты
  assert.deepEqual(c.works, [
    { name: 'Снятие бампера', qty: 1, sum: 3000 },
    { name: 'Окраска', qty: 2, sum: 5000 },
  ]);
  assert.equal(e.totals.ready, 8000);
  // Нераспределённая работа не досталась никому
  const e2 = buildMasterEarnings({ id: 'm2', name: 'Петров' }, { jobs: WORK_JOBS });
  assert.equal(e2.cards[0].amount, 4000);
  assert.equal(e2.cards[0].ready, false);          // этап ещё в работе
  assert.equal(e2.totals.inProgress, 4000);
});

test('buildMasterEarnings: старые машины без наряда считаются по строке оплаты', () => {
  const e = buildMasterEarnings({ id: 'm1', name: 'Иванов' }, { jobs: EARN_JOBS });
  assert.equal(e.cards.find((c) => c.jobId === 'j1').amount, 25000);
  assert.deepEqual(e.cards.find((c) => c.jobId === 'j1').works, []);
});

test('buildPayroll: считает по наряду мастерам', () => {
  const rows = buildPayroll([{ id: 'm1', name: 'Иванов' }, { id: 'm2', name: 'Петров' }], WORK_JOBS, [], Date.UTC(2026, 7, 3)).rows;
  const m1 = rows.find((r) => r.masterId === 'm1');
  assert.equal(m1.earnedReady, 8000);
  assert.equal(m1.owed, 8000);
  assert.equal(rows.find((r) => r.masterId === 'm2').inProgress, 4000);
});
