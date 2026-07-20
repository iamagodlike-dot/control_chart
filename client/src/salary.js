// Pure helpers for master/employee compensation (ЗП). No React, no Firestore —
// same style as roles.js / phase.js, so the pay model can be unit-tested in
// isolation (salary.test.js, node --test).
//
// Каждый человек в справочнике «Мастера» (= список всех, кому платят зарплату:
// сдельные мастера + любой на окладе) имеет ТИП ОПЛАТЫ:
//   'piece' — сдельная: заработок = суммы за машины (по закрытым этапам мастера);
//   'fixed' — оклад: заработок = фиксированная месячная ставка, от машин не зависит.
// У обоих есть АВАНС — гарантированный (недостачу не переносим), выдаётся
// 15–20 числа; окончательный расчёт 1–5 числа след. месяца = заработано − аванс.
//
// Здесь — только «профильная» часть (тип/аванс/оклад). Расчёт заработка и
// остатка к выплате появится отдельными функциями на следующих шагах.

export const PAY_TYPES = {
  piece: { id: 'piece', label: 'Сдельная' },
  fixed: { id: 'fixed', label: 'Оклад' },
};

// Порядок в выпадающем списке.
export const PAY_TYPE_ORDER = ['piece', 'fixed'];

export const DEFAULT_PAY_TYPE = 'piece';
export const DEFAULT_ADVANCE = 40000; // аванс по умолчанию, ₽

export const isKnownPayType = (t) => Object.prototype.hasOwnProperty.call(PAY_TYPES, t);

// Тип оплаты записи, с откатом на сдельную для старых мастеров без поля.
export const payType = (m) => (isKnownPayType(m?.pay_type) ? m.pay_type : DEFAULT_PAY_TYPE);
export const isFixed = (m) => payType(m) === 'fixed';

export const payTypeLabel = (t) => PAY_TYPES[t]?.label || PAY_TYPES[DEFAULT_PAY_TYPE].label;

function toNum(v, d = 0) {
  if (v === '' || v == null) return d; // пусто/нет значения → дефолт (Number('') === 0!)
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// Приводит «сырое» значение из формы (строка, пусто, мусор, минус) к
// неотрицательному целому числу рублей.
export function money(v, d = 0) {
  return Math.max(0, Math.round(toNum(v, d)));
}

// Аванс записи в рублях (по умолчанию 40 000 — стандартная политика).
export const masterAdvance = (m) => money(m?.advance, DEFAULT_ADVANCE);
// Оклад записи в рублях (имеет смысл только для 'fixed'; иначе 0).
export const masterSalary = (m) => (isFixed(m) ? money(m?.salary, 0) : 0);

// Нормализует поля оплаты из формы к тому, что кладём в Firestore. Держим ОБА
// значения (advance/salary) независимо от типа, чтобы переключение туда-обратно
// не теряло уже введённое; salary при этом имеет смысл только для 'fixed'.
export function normalizeMasterPay(form = {}) {
  return {
    pay_type: isKnownPayType(form.pay_type) ? form.pay_type : DEFAULT_PAY_TYPE,
    advance: money(form.advance, DEFAULT_ADVANCE),
    salary: money(form.salary, 0),
  };
}

// Значения для формы из записи мастера. Старым записям без полей оплаты
// подставляем дефолты (сдельная, аванс 40 000), чтобы форма была готова к сохранению.
export function masterPayForm(m = {}) {
  return {
    pay_type: payType(m),
    advance: m?.advance != null ? String(m.advance) : String(DEFAULT_ADVANCE),
    salary: m?.salary != null ? String(m.salary) : '',
  };
}

const fmt = (n) => money(n).toLocaleString('ru-RU');

// Короткая подпись под именем мастера в списке: «сдельная · аванс 40 000» или
// «оклад 60 000 · аванс 40 000».
export function masterPaySummary(m) {
  const adv = `аванс ${fmt(masterAdvance(m))}`;
  if (isFixed(m)) return `оклад ${fmt(masterSalary(m))} · ${adv}`;
  return `сдельная · ${adv}`;
}

// Строки редактора «Оплата мастерам за эту машину» (окно с карточки авто).
// Единый источник суммы «за машину» — job.costing.labor (его же читают финансы и
// себестоимость). Показываем ОБЪЕДИНЕНИЕ: уже введённые строки оплаты + всех
// мастеров, назначенных на машину через этапы (чтобы владелец видел, кому платить,
// и просто вписал суммы). Каждая строка: { id, master_id, name, amount }.
export function buildPayRows(job = {}, masters = []) {
  const mById = new Map((masters || []).map((m) => [m.id, m]));
  const rows = [];
  const seen = new Set();
  (job?.costing?.labor || []).forEach((l, i) => {
    const mid = l.master_id || '';
    rows.push({ id: l.id || `lab-${i}`, master_id: mid, name: l.name || mById.get(mid)?.name || '', amount: money(l.amount, 0) });
    if (mid) seen.add(mid);
  });
  (job?.stages || []).forEach((s) => {
    const mid = s?.master_id;
    if (!mid || seen.has(mid)) return;
    seen.add(mid);
    rows.push({ id: `st-${mid}`, master_id: mid, name: mById.get(mid)?.name || '', amount: 0 });
  });
  return rows;
}

// Сумма к выплате мастерам за машину по строкам редактора.
export const payRowsTotal = (rows = []) => (rows || []).reduce((s, r) => s + money(r?.amount, 0), 0);

// Кабинет мастера «Мой заработок». Считаем из того же живого gantt-фида, что и
// «Мои машины»: jobs (с costing.labor — суммы за машину) + их этапы (статус работ
// мастера). В UI показываем ТОЛЬКО деньги этого мастера — маржа/себестоимость не
// раскрывается. Сумма «за машину» «созревает» (ready), когда мастер закрыл СВОИ
// этапы по машине (все done) — как договорились.
//   master — запись из справочника (pay_type/advance/salary; id);
//   jobs   — активные машины из buildGantt (каждая с .costing и .stages).
export function buildMasterEarnings(master, { jobs = [] } = {}) {
  const masterId = master?.id;
  const cards = [];
  if (masterId) {
    for (const job of (jobs || [])) {
      const hisStages = (job.stages || []).filter((s) => s?.master_id === masterId);
      const laborRow = (job.costing?.labor || []).find((l) => l?.master_id === masterId);
      if (!hisStages.length && !laborRow) continue; // машина не этого мастера
      const amount = money(laborRow?.amount, 0);
      const ready = hisStages.length > 0 && hisStages.every((s) => s.status === 'done');
      cards.push({
        jobId: job.id || job.job_id,
        car: job.car_model || 'Без модели',
        plate: job.plate_number || '',
        orderNum: job.order_number || '',
        client: job.client_name || '',
        amount,
        hasAmount: amount > 0,
        ready,
      });
    }
  }
  // Сначала готовые к выплате (хорошие новости), затем в работе; внутри — по сумме.
  cards.sort((a, b) => (Number(b.ready) - Number(a.ready)) || (b.amount - a.amount));
  const readySum = cards.filter((c) => c.ready).reduce((s, c) => s + c.amount, 0);
  const inProgressSum = cards.filter((c) => !c.ready).reduce((s, c) => s + c.amount, 0);
  return {
    isFixed: isFixed(master),
    pay: { payType: payType(master), advance: masterAdvance(master), salary: masterSalary(master) },
    cards,
    totals: { ready: readySum, inProgress: inProgressSum, total: readySum + inProgressSum, cars: cards.length },
  };
}

// Окно выплат по дню месяца (ритм зарплаты): 15–20 — аванс, 1–5 — окончательный
// расчёт за прошлый месяц, иначе — вне окна.
export function payrollWindow(nowMs = Date.now()) {
  const d = new Date(nowMs).getDate();
  if (d >= 15 && d <= 20) return 'advance';
  if (d >= 1 && d <= 5) return 'settlement';
  return 'none';
}

const sameMonth = (ts, nowMs) => {
  const a = new Date(ts || 0);
  const b = new Date(nowMs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
};

// Сводка «Зарплата мастерам» для управляющего. По каждому: заработано (готовые
// машины — сдельная / оклад — фикс), выдано в этом месяце, сколько к выплате.
// Аванс гарантированный, недостача не переносится → к выплате = max(0, заработано
// − выдано в этом месяце). masters — справочник (из фида); jobs — активные машины;
// payments — salaryPayments ({master_id, kind, amount, created_at}).
export function buildPayroll(masters = [], jobs = [], payments = [], nowMs = Date.now()) {
  const rows = [];
  for (const master of (masters || [])) {
    if (!master?.id) continue;
    const e = buildMasterEarnings(master, { jobs });
    const earnedReady = e.isFixed ? e.pay.salary : e.totals.ready;
    const inProgress = e.isFixed ? 0 : e.totals.inProgress;
    const mine = (payments || []).filter((p) => p && p.master_id === master.id && sameMonth(p.created_at, nowMs));
    const paidThisMonth = mine.reduce((s, p) => s + money(p.amount, 0), 0);
    const advanceGiven = mine.some((p) => p.kind === 'advance');
    if (earnedReady <= 0 && inProgress <= 0 && paidThisMonth <= 0) continue; // нечего показывать
    rows.push({
      masterId: master.id,
      name: master.name || '—',
      isFixed: e.isFixed,
      advance: e.pay.advance,
      salary: e.pay.salary,
      earnedReady,
      inProgress,
      paidThisMonth,
      advanceGiven,
      owed: Math.max(0, earnedReady - paidThisMonth),
      carsReady: e.cards.filter((c) => c.ready).length,
    });
  }
  rows.sort((a, b) => (b.owed - a.owed) || (b.earnedReady - a.earnedReady));
  return {
    rows,
    window: payrollWindow(nowMs),
    totals: {
      owed: rows.reduce((s, r) => s + r.owed, 0),
      paidThisMonth: rows.reduce((s, r) => s + r.paidThisMonth, 0),
      masters: rows.length,
    },
  };
}

// Выплаты ОКЛАДНИКАМ приводим к расходным «транзакциям» для прибыли (P&L) —
// так же, как Finance.jsx подмешивает траты сотрудников. Дата — по created_at,
// чтобы попадали в нужный период. СДЕЛЬНЫЕ выплаты сюда НЕ входят: их оплата уже
// сидит в себестоимости ремонта (costing.labor), иначе прибыль бы задвоилась.
// Фильтр по payment.pay_type — тип оплаты, замороженный в момент выплаты.
export function salaryExpenseTx(payments = []) {
  return (payments || [])
    .filter((p) => p && p.pay_type === 'fixed')
    .map((p) => ({
      id: `salary-${p.id}`,
      direction: 'expense',
      category: 'Зарплаты / оклады',
      amount: money(p.amount, 0),
      date: p.created_at,
      note: `${p.master_name || 'сотрудник'} — ${p.kind === 'advance' ? 'аванс' : 'расчёт'}`,
      created_at: p.created_at,
    }));
}
