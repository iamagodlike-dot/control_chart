/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the master's «Мой заработок» screen — NO Firebase, NO auth.
// Renders the SAME <MyEarningsView> as the real screen (MyEarnings), fed by the
// REAL builder buildMasterEarnings, so this is a faithful preview. Toggle switches
// сдельная / оклад / «логин не привязан».
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MyEarningsView from '../components/MyEarningsView';
import { buildMasterEarnings } from '../salary';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

const MASTERS = {
  piece: { id: 'm1', name: 'Иванов', pay_type: 'piece', advance: 40000 },
  fixed: { id: 'm1', name: 'Иванов', pay_type: 'fixed', advance: 40000, salary: 60000 },
};

// jobs как из buildGantt: costing.labor (суммы) + stages (статус работ мастера).
const JOBS = [
  { id: 'j1', car_model: 'Toyota Camry', plate_number: 'K456TT', order_number: '110', client_name: 'Смирнов В.',
    costing: { labor: [{ master_id: 'm1', name: 'Иванов', amount: 25000 }] }, stages: [{ master_id: 'm1', status: 'done' }] },
  { id: 'j3', car_model: 'Audi A4', plate_number: 'M321CX', order_number: '118', client_name: 'Петров А.',
    costing: { labor: [{ master_id: 'm1', name: 'Иванов', amount: 35000 }] }, stages: [{ master_id: 'm1', status: 'done' }] },
  { id: 'j2', car_model: 'Kia Rio', plate_number: 'A007KX', order_number: '102', client_name: 'Кузнецов Д.',
    costing: { labor: [{ master_id: 'm1', name: 'Иванов', amount: 18000 }] }, stages: [{ master_id: 'm1', status: 'in_progress' }] },
  { id: 'j4', car_model: 'BMW X5', plate_number: 'O777OO', order_number: '120',
    costing: { labor: [] }, stages: [{ master_id: 'm1', status: 'planned' }] }, // сумму ещё не указали
  { id: 'j9', car_model: 'Lada Vesta', // чужая машина — не должна попасть
    costing: { labor: [{ master_id: 'm2', amount: 9000 }] }, stages: [{ master_id: 'm2', status: 'done' }] },
];

function Demo() {
  const [state, setState] = useState('piece'); // piece | fixed | unlinked
  const { isFixed, pay, cards, totals } = useMemo(
    () => buildMasterEarnings(state === 'unlinked' ? null : MASTERS[state], { jobs: JOBS }),
    [state],
  );
  return (
    <div>
      <div style={{ position: 'fixed', top: 12, left: 12, zIndex: 100, display: 'flex', gap: 8 }}>
        <button className={state === 'piece' ? 'primary' : ''} onClick={() => setState('piece')}>Сдельная</button>
        <button className={state === 'fixed' ? 'primary' : ''} onClick={() => setState('fixed')}>Оклад</button>
        <button className={state === 'unlinked' ? 'primary' : ''} onClick={() => setState('unlinked')}>Не привязан</button>
      </div>
      <MyEarningsView
        loading={false}
        hasMaster={state !== 'unlinked'}
        isFixed={isFixed}
        pay={pay}
        cards={cards}
        totals={totals}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
