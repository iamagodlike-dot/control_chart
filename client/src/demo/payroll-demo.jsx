/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the owner's «Зарплата мастерам» screen — NO Firebase.
// Renders the SAME <PayrollView> as the real screen (Payroll), fed by the REAL
// builder buildPayroll. Кнопки «Выдать аванс» / «Выплатить остаток» пишут в
// локальный список выплат, чтобы механику можно было пощёлкать вживую.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import PayrollView from '../components/PayrollView';
import { buildPayroll } from '../salary';
import '../App.css';

dayjs.locale('ru');
document.documentElement.dataset.theme = 'dark';

const NOW = new Date(2026, 6, 17, 12).getTime(); // 17 июля — окно выдачи аванса

const MASTERS = [
  { id: 'm1', name: 'Иванов А.', pay_type: 'piece', advance: 40000 },
  { id: 'm2', name: 'Петров С.', pay_type: 'fixed', advance: 40000, salary: 60000 },
  { id: 'm3', name: 'Сидоров К.', pay_type: 'piece', advance: 40000 },
];
const JOBS = [
  { id: 'j1', car_model: 'Toyota Camry',
    costing: { labor: [{ master_id: 'm1', amount: 25000 }, { master_id: 'm3', amount: 35000 }] },
    stages: [{ master_id: 'm1', status: 'done' }, { master_id: 'm3', status: 'done' }] },
  { id: 'j2', car_model: 'Kia Rio',
    costing: { labor: [{ master_id: 'm1', amount: 18000 }] },
    stages: [{ master_id: 'm1', status: 'in_progress' }] }, // m1: 25 000 готово, 18 000 в работе
];

let seq = 1;

function Demo() {
  const [payments, setPayments] = useState([]);
  const { rows, window: payWindow, totals } = useMemo(
    () => buildPayroll(MASTERS, JOBS, payments, NOW),
    [payments],
  );
  function onRecord(row, kind, amount) {
    const amt = Math.max(0, Math.round(Number(amount) || 0));
    if (!amt) return;
    setPayments((ps) => [
      { id: `p${seq++}`, master_id: row.masterId, master_name: row.name, kind, amount: amt, created_at: NOW },
      ...ps,
    ]);
  }
  function onRemovePayment(id) { setPayments((ps) => ps.filter((p) => p.id !== id)); }

  return (
    <PayrollView
      loading={false}
      rows={rows}
      payWindow={payWindow}
      totals={totals}
      payments={payments}
      now={NOW}
      busy={null}
      onRecord={onRecord}
      onRemovePayment={onRemovePayment}
    />
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
