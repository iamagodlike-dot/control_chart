/* eslint-disable react-refresh/only-export-components */
// Standalone demo of «Счета поставщиков» — NO Firebase. Mocks api.supplierInvoices
// with an in-memory store so both the founder cabinet (SupplierInvoices) and the
// partsman «Выставить счёт» modal (SupplierInvoiceModal) render credential-free.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../App.css';
import SupplierInvoices from '../components/SupplierInvoices';
import SupplierInvoiceModal from '../components/SupplierInvoiceModal';
import { api } from '../api';

// ---- in-memory store + fake realtime ----
let INVOICES = [
  {
    id: 'i1', number: 'СП-2026-0001', supplier: 'Exist', amount: 61500, status: 'unpaid',
    file_url: '#demo.pdf', file_name: 'Счёт Exist 0001.pdf', file_size: 240000,
    created_at: Date.now() - 3600e3, created_by_name: 'Пётр (запчастист)',
    items: [
      { part_id: 'a', job_id: 'j1', name: 'Лонжерон передний правый', code: '50710-TVA', qty: 1, cost: 24500, car_model: 'GAG trumchi', plate: 'B122MM24' },
      { part_id: 'b', job_id: 'j1', name: 'Крыло переднее правое', code: '53801-06', qty: 1, cost: 9000, car_model: 'GAG trumchi', plate: 'B122MM24' },
      { part_id: 'c', job_id: 'j2', name: 'Фара левая', code: '81150-33', qty: 2, cost: 14000, car_model: 'TOYOTA CAMRY', plate: 'K456TT124' },
    ],
  },
  {
    id: 'i2', number: 'СП-2026-0002', supplier: 'Emex', amount: 9000, status: 'unpaid',
    file_url: '#demo2.jpg', file_name: 'photo_счёт.jpg', file_size: 180000,
    created_at: Date.now() - 1800e3, created_by_name: 'Пётр (запчастист)', comment: 'срочно',
    items: [{ part_id: 'd', job_id: 'j2', name: 'Решётка радиатора', qty: 1, cost: 9000, car_model: 'TOYOTA CAMRY', plate: 'K456TT124' }],
  },
  {
    id: 'i3', number: 'СП-2026-0003', supplier: 'Разборка', amount: 15000, status: 'paid',
    file_url: '#demo3.pdf', file_name: 'Разборка.pdf', file_size: 90000,
    created_at: Date.now() - 86400e3, paid_at: Date.now() - 80000e3,
    created_by_name: 'Пётр (запчастист)', paid_by_name: 'Иван (учредитель)',
    items: [{ part_id: 'e', job_id: 'j3', name: 'Бампер задний', qty: 1, cost: 15000, car_model: 'KIA RIO', plate: 'M789OO124' }],
  },
];
let listeners = [];
const emit = () => listeners.forEach((cb) => cb(JSON.parse(JSON.stringify(INVOICES))));

api.supplierInvoices.subscribe = (onData) => { listeners.push(onData); onData(JSON.parse(JSON.stringify(INVOICES))); return () => { listeners = listeners.filter((l) => l !== onData); }; };
api.supplierInvoices.markPaid = async (id) => { INVOICES = INVOICES.map((i) => (i.id === id ? { ...i, status: 'paid', paid_at: Date.now(), paid_by_name: 'Иван (учредитель)' } : i)); emit(); };
api.supplierInvoices.setFile = async (id, f) => { INVOICES = INVOICES.map((i) => (i.id === id ? { ...i, ...f } : i)); emit(); };
api.supplierInvoices.create = async (d) => { const inv = { id: 'new' + Date.now(), number: 'СП-2026-9999', status: 'unpaid', created_at: Date.now(), ...d }; INVOICES = [inv, ...INVOICES]; emit(); return inv; };

// Seed jobs with «need» parts for the modal.
const SEED_JOBS = [
  { id: 'j1', car_model: 'GAG trumchi', plate_number: 'B122MM24', parts: [
    { id: 'n1', name: 'Дверь передняя левая', code: '67001-T', qty: 1, cost: 21000, status: 'need' },
    { id: 'n2', name: 'Зеркало левое', code: '87940', qty: 1, cost: 4800 }, // БЕЗ статуса (импорт) — должно попасть
    { id: 'n3', name: 'Молдинг', code: '', qty: 2, cost: 0 },               // БЕЗ статуса
  ] },
  { id: 'j2', car_model: 'TOYOTA CAMRY', plate_number: 'K456TT124', parts: [
    { id: 'n4', name: 'Капот', code: '53301-06', qty: 1, cost: 27000 },    // БЕЗ статуса
    { id: 'n5', name: 'Бампер передний', code: 'PB-01', qty: 1, cost: 15500, status: 'need' },
  ] },
];

function Demo() {
  const [role, setRole] = useState('founder');
  const [modal, setModal] = useState(false);
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <div style={{ display: 'flex', gap: 10, padding: '12px 20px', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
        <strong style={{ color: 'var(--color-text)' }}>Демо · Счета поставщиков</strong>
        <button className="si-modal-cancel" onClick={() => setRole(role === 'founder' ? 'owner' : 'founder')}>роль: {role}</button>
        <button className="si-modal-submit" onClick={() => setModal(true)}>Открыть модалку «Выставить счёт»</button>
      </div>
      <SupplierInvoices role={role} profile={{ name: role === 'founder' ? 'Иван (учредитель)' : 'Босс' }} />
      {modal && <SupplierInvoiceModal jobs={SEED_JOBS} supplierNames={['Exist', 'Emex', 'Разборка', 'Химснаб']} profileName="Пётр" onClose={() => setModal(false)} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
