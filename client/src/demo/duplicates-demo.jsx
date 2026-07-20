/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the «Дубликаты машин» tool — NO Firebase. Mocks api.jobs in
// memory so the finder + merge (позиции дубля → допродажи, дубль в архив) can be
// exercised without credentials. Seed has one duplicate pair (страховая + допродажи
// under the same plate, one typed in Cyrillic and one in Latin) and one unique car.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../App.css';
import DuplicateCars from '../components/DuplicateCars';
import { api } from '../api';

let JOBS = [
  {
    id: 'ins-1', car_model: 'Geely Atlas Pro', plate_number: 'А123ВС 96', vin: 'LB37622Z0NX012345',
    client_name: 'Иванов И. И.', order_number: '1506/1', payment_type: 'insurance', insurer_name: 'Ингосстрах',
    created_at: Date.parse('2026-07-01'), archived: false,
    services: [{ name: 'Замена бампера', qty: 1, price: 4200 }, { name: 'Окраска бампера', qty: 1, price: 8500 }],
    parts: [{ id: 'p1', name: 'Бампер передний', code: '5701A123', qty: 1, kind: 'new' }],
  },
  {
    id: 'dop-1', car_model: 'Geely Atlas Pro', plate_number: 'A123BC96', vin: 'LB37622Z0NX012345',
    client_name: 'Иванов И. И.', order_number: '1506/2', payment_type: 'cash',
    created_at: Date.parse('2026-07-03'), archived: false,
    services: [{ name: 'Химчистка салона', qty: 1, price: 6000 }],
    parts: [{ id: 'p9', name: 'Коврики салона', code: 'MAT-ATLAS', qty: 1, kind: 'new' }],
  },
  {
    id: 'solo', car_model: 'LADA Vesta', plate_number: 'О777ОО177', client_name: 'Петров П.',
    order_number: '1490', payment_type: 'cash', created_at: Date.parse('2026-06-20'), archived: false,
    services: [{ name: 'Полировка', qty: 1, price: 3000 }], parts: [],
  },
];

// ---- in-memory api.jobs stubs ----
api.jobs.listAllBrief = async () => JSON.parse(JSON.stringify(JOBS));
api.jobs.get = async (id) => JSON.parse(JSON.stringify(JOBS.find((j) => j.id === id) || null));
api.jobs.update = async (id, patch) => { JOBS = JOBS.map((j) => (j.id === id ? { ...j, ...patch } : j)); };
api.jobs.savePart = async (id, part) => {
  JOBS = JOBS.map((j) => (j.id === id ? { ...j, parts: [...(j.parts || []), part] } : j));
};
api.jobs.archive = async (id) => { JOBS = JOBS.map((j) => (j.id === id ? { ...j, archived: true } : j)); };

function Demo() {
  return (
    <div className="settings-content" style={{ maxWidth: 900, margin: '0 auto' }}>
      <DuplicateCars />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
