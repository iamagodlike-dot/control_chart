/* eslint-disable react-refresh/only-export-components */
// Standalone demo of «Наряд мастерам» — NO Firebase, NO auth.
//   cd client && npm run dev  →  http://localhost:5174/master-order-demo.html
// Показывает оба конца цепочки: экран управленца (распределение работ + печать
// наряда) и кабинет мастера, который видит СВОИ работы и сумму.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../api';
import MasterOrderModal from '../components/MasterOrderModal';
import MyEarningsView from '../components/MyEarningsView';
import { buildMasterEarnings } from '../salary';
import { computeCosting } from '../costing';
import '../index.css';
import '../App.css';
import '../orderDoc.css';

document.documentElement.dataset.theme = 'dark';

const MASTERS = [
  { id: 'm1', name: 'Иванов А.', pay_type: 'piece', advance: 40000 },
  { id: 'm2', name: 'Петров С.', pay_type: 'piece', advance: 40000 },
  { id: 'm3', name: 'Сидоров В.', pay_type: 'piece', advance: 40000 },
];

const COMPANY = {
  name: 'Авто Академия', inn: '246300000000', ogrn: '321246800000000',
  address: 'г. Красноярск, ул. Пример, 1', phone: '+7 391 000-00-00', director: 'Иванов И.И.',
  materials_pct: 15, overhead_pct: 0,
};

// Заказ-наряд страховой: цены ЗАНИЖЕННЫЕ — их и правят на реальные.
const ORDER = {
  id: 'd1', type: 'order', recipient: 'insurance', doc_number: 'ЗН-2026-0007', created_at: 300,
  discount: 0,
  services: [
    { id: 's1', src_id: 'j-s1', name: 'Бампер передний — снятие/установка', qty: 1, price: 1800 },
    { id: 's2', src_id: 'j-s2', name: 'Крыло переднее правое — ремонт', qty: 1, price: 4200 },
    { id: 's3', src_id: 'j-s3', name: 'Окраска детали', qty: 2, price: 3500 },
    { id: 's4', src_id: 'j-s4', name: 'Фара правая — замена', qty: 1, price: 900 },
  ],
  parts: [
    { id: 'p1', code: '52119-33952', name: 'Бампер передний', qty: 1, unit: 'шт.', price: 28000 },
    { id: 'p2', code: '81130-06D00', name: 'Фара правая', qty: 1, unit: 'шт.', price: 41000 },
  ],
};

const JOB0 = {
  id: 'demo-job', job_id: 'demo-job',
  car_model: 'Toyota Camry 2019', plate_number: 'К456ТТ124', vin: 'JTNBE46K903012345',
  order_number: 'ЗН-2026-0007', client_name: 'Смирнов А.В.', payment_type: 'insurance',
  insurer_name: 'Ингосстрах',
  services: ORDER.services, parts: ORDER.parts,
  stages: [
    { id: 'st1', master_id: 'm1', status: 'done' },
    { id: 'st2', master_id: 'm2', status: 'in_progress' },
  ],
  costing: null,
};

// Себестоимость «старой» машины: оплата мастерам одной суммой, наряда ещё нет.
const LEGACY_COSTING = {
  source: 'order', source_number: 'ЗН-2026-0007', services_sum: 13900, discount: 0,
  parts: [], labor: [{ id: 'l1', master_id: 'm1', name: 'Иванов А.', amount: 30000 }],
  works: null, materials: null, overhead: null, updated_at: 1,
};

// Подменяем Firestore ДО рендера — демо ничего не читает и не пишет в облако.
let saved = null;
api.masters.list = async () => MASTERS;
api.orderDocuments.listByJob = async (_id, type) => (type === 'order' ? [ORDER] : []);
api.settings.getCompany = async () => COMPANY;
api.jobs.update = async (id, patch) => { saved = patch.costing; return {}; };

function Demo() {
  const [job, setJob] = useState(JOB0);
  const [open, setOpen] = useState(true);
  const [view, setView] = useState('owner');   // owner | master
  const [log, setLog] = useState([]);

  const totals = useMemo(() => (job.costing ? computeCosting(job.costing, COMPANY) : null), [job.costing]);
  const earnings = useMemo(
    () => buildMasterEarnings(MASTERS[0], { jobs: [job] }),
    [job],
  );

  function onSaved(costing) {
    setJob((j) => ({ ...j, costing }));
    setLog((l) => [
      `сохранено: работ ${costing.works.length}, строк оплаты ${costing.labor.length}, ` +
      `труд ${computeCosting(costing, COMPANY).labor_cost} ₽`,
      ...l,
    ].slice(0, 5));
    // saved — то, что ушло бы в Firestore; смотрим в консоли
    console.log('api.jobs.update →', saved);
  }

  return (
    <div style={{ minHeight: '100vh', padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button className={view === 'owner' ? 'primary' : ''} onClick={() => { setView('owner'); setOpen(true); }}>Экран управленца</button>
        <button className={view === 'master' ? 'primary' : ''} onClick={() => { setView('master'); setOpen(false); }}>Кабинет мастера (Иванов)</button>
        {/* Машина, где оплата задана ещё старым окном одной суммой: проверяем
            предупреждение и подтверждение при замене. */}
        <button onClick={() => { setJob({ ...JOB0, costing: LEGACY_COSTING }); setView('owner'); setOpen(true); setLog([]); }}>
          Старая машина (оплата задана)
        </button>
        <button onClick={() => { setJob(JOB0); setLog([]); }}>Сбросить</button>
      </div>

      {totals && (
        <div className="costing-source" style={{ marginBottom: 12 }}>
          <span>Выручка <b>{totals.revenue} ₽</b></span>
          <span>Труд <b>{totals.labor_cost} ₽</b></span>
          <span>Не распределено <b>{totals.works_unassigned} ₽</b></span>
          <span>Прибыль <b>{totals.profit} ₽</b></span>
        </div>
      )}
      {log.map((l, i) => <div key={i} className="cc-hint">{l}</div>)}

      {view === 'master' && (
        <MyEarningsView
          loading={false} hasMaster
          isFixed={earnings.isFixed} pay={earnings.pay} cards={earnings.cards} totals={earnings.totals}
        />
      )}

      {view === 'owner' && !open && <button className="primary" onClick={() => setOpen(true)}>Открыть наряд</button>}
      {view === 'owner' && open && (
        <MasterOrderModal job={job} onSaved={onSaved} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
