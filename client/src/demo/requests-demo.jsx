/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the «Заявки на закупку» screen from the MASTER's side
// (isOwner=false) — NO Firebase, NO auth, seed data in memory. Renders the SAME
// <RequestsView> as the real screen, so it's a faithful, credential-free preview.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import RequestsView from '../components/RequestsView';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

const ME = 'master@demo';

const JOBS = [
  { id: 'j1', car_model: 'TOYOTA CAMRY', plate_number: 'K456TT124' },
  { id: 'j2', car_model: 'KIA RIO', plate_number: 'A007KX124' },
];

let idc = 100;
const SEED = [
  { id: 'r1', item_name: 'Грунт акриловый 4:1', qty: 1, unit: 'компл', status: 'new', urgent: true, number: 'ЗК-2026-014', for_job_label: 'TOYOTA CAMRY · K456TT124', comment: 'почти закончился', created_by: ME, created_by_name: 'Иванов А.', created_at: Date.now() },
  { id: 'r2', item_name: 'Абразив P400', qty: 2, unit: 'упак', status: 'approved', number: 'ЗК-2026-011', created_by: ME, created_by_name: 'Иванов А.', created_at: Date.now() - 86400000 },
  { id: 'r3', item_name: 'Полироль 3M', qty: 1, unit: 'шт', status: 'purchased', number: 'ЗК-2026-008', created_by: ME, created_by_name: 'Иванов А.', created_at: Date.now() - 2 * 86400000 },
  { id: 'r4', item_name: 'Салфетки безворсовые', qty: 3, unit: 'упак', status: 'rejected', reject_reason: 'есть на складе', number: 'ЗК-2026-006', created_by: ME, created_by_name: 'Иванов А.', created_at: Date.now() - 3 * 86400000 },
];

function Demo() {
  const [requests, setRequests] = useState(SEED);
  const [form, setForm] = useState({ item_name: 'Скотч малярный 18 мм', qty: '5', unit: 'шт', for_job_id: 'j1', comment: '', urgent: false });
  const [busy] = useState(null);

  function onAdd() {
    const qty = Number(form.qty) || 0;
    if (!form.item_name.trim() || qty <= 0) return;
    const job = JOBS.find((j) => j.id === form.for_job_id);
    setRequests((xs) => [
      { id: `r${++idc}`, item_name: form.item_name.trim(), qty, unit: form.unit, status: 'new', urgent: form.urgent, number: 'ЗК-2026-015', for_job_label: job ? `${job.car_model} · ${job.plate_number}` : '', comment: form.comment.trim(), created_by: ME, created_by_name: 'Иванов А.', created_at: Date.now() },
      ...xs,
    ]);
    setForm({ item_name: '', qty: '', unit: 'шт', for_job_id: '', comment: '', urgent: false });
  }
  function onCancel(id) { setRequests((xs) => xs.filter((r) => r.id !== id)); }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <RequestsView
        isOwner={false}
        loading={false}
        requests={requests}
        jobs={JOBS}
        form={form}
        onFormChange={setForm}
        onAdd={onAdd}
        onApprove={() => {}}
        onReject={() => {}}
        onCancel={onCancel}
        busy={busy}
        error=""
        myEmail={ME}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
