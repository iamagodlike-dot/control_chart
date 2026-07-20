import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { buildPayroll } from '../salary';
import PayrollView from './PayrollView';

// Owner-only «Зарплата мастерам» screen. Combines the live gantt feed (jobs with
// costing.labor + masters) with the salaryPayments ledger to show, per master,
// заработано / выдано в этом месяце / к выплате, and records advance/settlement
// payments. Payments live in their own collection (owner-only), NOT in the money
// feed — сдельная оплата уже учтена в себестоимости (P&L), так что второй раз в
// «Финансы» её класть нельзя (задвоение).
export default function Payroll() {
  const [gantt, setGantt] = useState(null);       // {jobs, masters}
  const [payments, setPayments] = useState(null);
  const [busy, setBusy] = useState(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const unsub = api.subscribeGantt(
      ({ jobs, masters }) => setGantt({ jobs, masters }),
      () => setGantt({ jobs: [], masters: [] }),
    );
    return () => unsub();
  }, []);

  async function loadPayments() {
    try { setPayments(await api.salaryPayments.listAll()); }
    catch { setPayments([]); }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadPayments(); }, []);

  const { rows, window: payWindow, totals } = useMemo(
    () => buildPayroll(gantt?.masters || [], gantt?.jobs || [], payments || [], now),
    [gantt, payments, now],
  );

  async function onRecord(row, kind, amount) {
    const amt = Math.max(0, Math.round(Number(amount) || 0));
    if (!amt) return;
    const label = kind === 'advance' ? 'аванс' : 'окончательный расчёт';
    if (!window.confirm(`Записать выплату мастеру ${row.name}: ${label} ${amt.toLocaleString('ru-RU')} ₽?`)) return;
    setBusy(row.masterId);
    try {
      await api.salaryPayments.create({
        master_id: row.masterId, master_name: row.name, kind, amount: amt,
        pay_type: row.isFixed ? 'fixed' : 'piece',
      });
      await loadPayments();
    } catch { alert('Не удалось записать выплату. Проверьте соединение и попробуйте ещё раз.'); }
    finally { setBusy(null); }
  }

  async function onRemovePayment(id) {
    if (!window.confirm('Отменить эту выплату? Она исчезнет и здесь, и в «Финансах».')) return;
    setBusy(id);
    try { await api.salaryPayments.remove(id); await loadPayments(); }
    catch { /* правила / сеть */ }
    finally { setBusy(null); }
  }

  return (
    <PayrollView
      loading={gantt === null || payments === null}
      rows={rows}
      payWindow={payWindow}
      totals={totals}
      payments={payments || []}
      now={now}
      busy={busy}
      onRecord={onRecord}
      onRemovePayment={onRemovePayment}
    />
  );
}
