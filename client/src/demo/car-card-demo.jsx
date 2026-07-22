/* eslint-disable react-refresh/only-export-components */
// Standalone visual harness for <CarCard>. The real card only appears deep inside
// the auth-gated app, so this mounts it with in-memory mock data purely to check
// the two-column layout at desktop + phone widths. No writes happen; the api
// reads it fires on mount are read-only and swallowed by their own .catch().
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import '../index.css';
import '../App.css';
import CarCard from '../components/CarCard';
import { api } from '../api';

dayjs.locale('ru');

// Demo-only: feed the card a mock invoice so the payment banner renders (the real
// one comes from Firestore, which this credential-free harness can't reach). The
// card's «Отметить оплату» button flips it live between не оплачено / оплачено.
let DEMO_INVOICES = [{ id: 'inv-1', number: '44', paid: false, totals: { total: 128400 } }];
api.orderDocuments.listByJob = async (_jobId, type) => (type === 'invoice' ? DEMO_INVOICES : []);
api.orderDocuments.setPaid = async (id, paid) => { DEMO_INVOICES = DEMO_INVOICES.map((i) => (i.id === id ? { ...i, paid } : i)); };
api.gantt = async () => ({ stages: [] });
api.insurers.list = async () => [];
// Для окон «Оплата мастерам» / «Себестоимость» (грузят справочники сами; в
// песочнице Firestore недоступен, поэтому подменяем на пустышки).
api.masters.list = async () => MASTERS;
api.jobs.update = async () => {};
api.settings.getCompany = async () => ({});
// Записи карточки (позиции и убытки). Firestore в песочнице недоступен, но пути
// сохранения должны отрабатывать ЦЕЛИКОМ — иначе демо не проверяет ровно то, ради
// чего существует. Что именно записалось, видно в window.DEMO_WRITES.
const DEMO_WRITES = [];
api.jobs.savePart = async (_jobId, part) => { DEMO_WRITES.push({ op: 'savePart', id: part.id, name: part.name, payer: part.payer }); };
api.jobs.saveParts = async (_jobId, list) => { DEMO_WRITES.push({ op: 'saveParts', count: list.length, payer: list[0]?.payer }); };
api.jobs.removePart = async (_jobId, id) => { DEMO_WRITES.push({ op: 'removePart', id }); };
api.jobs.addClaim = async (_jobId, claim) => {
  const claims = [...JOB.claims, { id: `cl_${JOB.claims.length + 1}`, order_number: `ЗН-2026-01${JOB.claims.length}`, claim_number: '', discount: 0, franchise: 0, ...claim }];
  JOB.claims = claims;
  DEMO_WRITES.push({ op: 'addClaim', total: claims.length });
  return { ...JOB, claims };
};
api.jobs.saveClaim = async (_jobId, claim) => {
  JOB.claims = JOB.claims.map((c) => (c.id === claim.id ? { ...c, ...claim } : c));
  DEMO_WRITES.push({ op: 'saveClaim', id: claim.id, claim_number: claim.claim_number, discount: claim.discount });
  return { ...JOB, claims: JOB.claims };
};
api.jobs.removeClaim = async (_jobId, claimId) => {
  JOB.claims = JOB.claims.filter((c) => c.id !== claimId);
  DEMO_WRITES.push({ op: 'removeClaim', id: claimId });
  return { ...JOB, claims: JOB.claims };
};
window.DEMO_WRITES = DEMO_WRITES;

const ph = (c) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='90'%3E%3Crect width='120' height='90' fill='%23${c}'/%3E%3C/svg%3E`;

const POSTS = [
  { id: 'p1', name: 'Разборка' },
  { id: 'p2', name: 'Кузовной цех' },
  { id: 'p3', name: 'Покраска' },
  { id: 'p4', name: 'Сборка' },
];
const MASTERS = [
  { id: 'm1', name: 'Иванов А.' },
  { id: 'm2', name: 'Петров С.' },
];

const now = dayjs('2026-07-06T13:00:00');
const iso = (d) => d.toISOString();

const JOB = {
  id: 'demo-1', job_id: 'demo-1',
  car_model: 'Geely Atlas Pro', plate_number: 'А123ВС 96', vin: 'LB37622Z0NX012345',
  mileage: '84000', color: 'чёрный', client_name: 'Иванов Иван Иванович', client_phone: '+7 912 000-00-00',
  order_number: '1506/1',
  expected_at: iso(now.subtract(1, 'day')), deadline: iso(now.add(45, 'day').hour(18)),
  notes: 'Клиент просил сохранить оригинальный передний бампер. Согласовать цвет перед покраской.',
  payment_type: 'insurance', insurer_name: 'Ингосстрах', claim_number: 'PVU-1234567', policy_type: 'osago',
  // Два убытка: страховая завела по этой машине второе дело поверх идущего ремонта.
  // Плоские поля выше = зеркало убытка №1 (их читает непереписанный код и бот).
  // Форма демо обязана совпадать с боевой — расхождение уже однажды на месяц спрятало
  // неработающую лампочку плательщика на экране «Запчасти».
  claims: [
    { id: 'insurance', claim_number: 'PVU-1234567', insurer_name: 'Ингосстрах', policy_type: 'osago',
      franchise: 15000, order_number: 'ЗН-2026-0007', discount: 0 },
    { id: 'cl_x7', claim_number: 'PVU-9998877', insurer_name: 'Ингосстрах', policy_type: 'kasko',
      franchise: 0, order_number: 'ЗН-2026-0042', discount: 0 },
  ],
  cell_ids: ['A-12', 'B-03'],
  created_at: iso(now.subtract(2, 'day')),
  photos: [
    { id: 'ph1', category: 'before', url: ph('3a4250') },
    { id: 'ph2', category: 'before', url: ph('44506a') },
    { id: 'ph3', category: 'after', url: ph('2f5a44') },
    // Фото приёмки запчастей (снимаются на экране «Приёмка»), привязаны к позициям.
    { id: 'ph4', category: 'receiving', partId: 'pt1', url: ph('5a4230'), path: '/demo/r1' },
    { id: 'ph5', category: 'receiving', partId: 'pt1', url: ph('6a5240'), path: '/demo/r2' },
    { id: 'ph6', category: 'receiving', partId: 'pt2', url: ph('42505a'), path: '/demo/r3' },
  ],
  services: [
    // Убыток №1 — без метки (весь легаси трактуется как первое дело).
    { name: 'Замена бампера переднего', qty: 1, price: 4200 },
    { name: 'Окраска бампера', qty: 1, price: 8500 },
    // Убыток №2 — второе страховое дело (payer = id потока).
    { name: 'Ремонт двери задней левой', qty: 1, price: 7400, payer: 'cl_x7' },
    { name: 'Полировка фары', qty: 2, price: 1500 },
    // Допродажа — клиент оплачивает сам, отдельным документом (payer:'client').
    { name: 'Химчистка салона', qty: 1, price: 6000, payer: 'client' },
  ],
  parts: [
    { id: 'pt1', name: 'Бампер передний', code: '5701A123', qty: 1, kind: 'new' },
    { id: 'pt2', name: 'Крыло переднее правое', code: '5300B77', qty: 1, kind: 'used' },
    { id: 'pt3', name: 'Фара левая', code: 'DEPO-212', qty: 1, kind: 'analog' },
    { id: 'pt5', name: 'Дверь задняя левая', code: '6200D41', qty: 1, kind: 'new', payer: 'cl_x7' },
    { id: 'pt4', name: 'Коврики салона', code: 'MAT-ATLAS', qty: 1, kind: 'new', payer: 'client' },
  ],
  stages: [
    { id: 's1', sequence: 0, post_id: 'p1', master_id: 'm1', status: 'done', start_at: iso(now.subtract(1, 'day').hour(10)), end_at: iso(now.subtract(1, 'day').hour(14)) },
    { id: 's2', sequence: 1, post_id: 'p2', master_id: 'm2', status: 'in_progress', start_at: iso(now.subtract(2, 'hour')), end_at: iso(now.add(3, 'hour')) },
    { id: 's3', sequence: 2, post_id: 'p3', master_id: '', status: 'planned', start_at: iso(now.add(2, 'day').hour(10)), end_at: iso(now.add(2, 'day').hour(16)) },
  ],
  // Полный снимок себестоимости (как в реальном приложении): оплата m1 уже введена —
  // окно «Оплата мастерам» покажет её + m2 из этапов (0), а «Себестоимость» — то же
  // самое, но только для чтения.
  costing: { services_sum: 14200, discount: 0, parts: [], labor: [{ id: 'l1', master_id: 'm1', name: 'Иванов А.', amount: 25000 }] },
};

const noop = () => {};
const asyncNoop = async () => {};

function Demo() {
  const [mode, setMode] = useState('edit');
  return (
    <div>
      <div style={{ position: 'fixed', top: 12, left: 12, zIndex: 100, display: 'flex', gap: 8 }}>
        <button className={mode === 'edit' ? 'primary' : ''} onClick={() => setMode('edit')}>Просмотр (edit)</button>
        <button className={mode === 'create' ? 'primary' : ''} onClick={() => setMode('create')}>Добавление (create)</button>
      </div>
      <CarCard
        key={mode}
        mode={mode}
        job={mode === 'edit' ? JOB : null}
        posts={POSTS}
        masters={MASTERS}
        now={now}
        isOwner
        onClose={noop}
        onCreate={asyncNoop}
        onSaveInfo={asyncNoop}
        onAddStage={async () => ({ id: `new-${Math.round(Math.random() * 1e6)}` })}
        onUpdateStage={asyncNoop}
        onRemoveStage={asyncNoop}
        onOpenDocs={noop}
        onFinalize={noop}
        onRemove={noop}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
