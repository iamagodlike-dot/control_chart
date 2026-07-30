/* eslint-disable react-refresh/only-export-components */
// Standalone-демо экрана «Приёмка авто» — БЕЗ Firebase, БЕЗ авторизации, сид в
// памяти. Рисует ТЕ ЖЕ <IntakeView> и <IntakeCard> через ТУ ЖЕ вью-модель
// buildIntakeList, что и реальный экран, поэтому это точный предпросмотр.
//
// Сид покрывает все состояния плитки: нетронутая свежая, наполовину заполненная,
// готовая к закрытию, уже закрытая, просроченная (красная) и клиентская машина
// (другой шаблон чек-листа).
//
// Карточку в демо открываем в «песочном» режиме: все записи в Firestore и
// загрузка фото подменены заглушками, поэтому кнопки нажимаются, но никуда не
// ходят. Так проверяется вёрстка и логика готовности, а не сеть.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import IntakeView from '../components/IntakeView';
import IntakeCard from '../components/IntakeCard';
import { api } from '../api';
import {
  DAY_MS, DEFAULT_INTAKE_SETTINGS, buildIntakeList, photoCategory,
} from '../intake';
import '../App.css';
import '../orderDoc.css';

document.documentElement.dataset.theme = 'dark';

const now = Date.now();
const daysAgo = (n) => now - n * DAY_MS;

// Заглушка снимка: серый квадрат data-URI, чтобы демо не ходило в сеть.
const stub = (label) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#243040"/><text x="60" y="64" font-size="11" fill="#8e9bab" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`,
)}`;

const photo = (slot, i = 0) => ({
  id: `${slot}-${i}`, category: photoCategory(slot), url: stub(slot), path: `demo/${slot}`,
});

const REQUIRED_SLOTS = DEFAULT_INTAKE_SETTINGS.photo_slots.filter((s) => s.required).map((s) => s.id);
const allPhotos = () => REQUIRED_SLOTS.map((id) => photo(id));
const insuranceChecked = DEFAULT_INTAKE_SETTINGS.templates[0].items.filter((i) => i.required).map((i) => i.id);

const SEED = [
  { // только что заехала, приёмку не открывали
    id: 'j1', car_model: 'Toyota Camry', plate_number: 'А123АВ 124', client_name: 'Иванов П.',
    client_phone: '+7 902 000-11-22', vin: 'XW8ZZZ61ZJG000123', year: '2019', color: 'Чёрный',
    payment_type: 'insurance', insurer_name: 'Ингосстрах', claim_number: 'У-123/26', policy_type: 'kasko',
    order_number: 'ЗН-2026-0044',
    phase: 'approval', approval_status: 'inspection', created_at: daysAgo(0),
  },
  { // начали и бросили — часть фото и половина чек-листа
    id: 'j2', car_model: 'Hyundai Solaris', plate_number: 'К221ВМ 124', client_name: 'Сидоров В.',
    payment_type: 'cash', phase: 'approval', approval_status: 'inspection', created_at: daysAgo(1),
    photos: [photo('front_left'), photo('side_left'), photo('vin')],
    intake: {
      status: 'open', mileage: '89120', fuel: 'quarter', keys: '1',
      docs: ['sts'], equipment: ['jack', 'spare', 'mats'],
      damages: [
        { id: 'd1', zone: 'bumper_front', kind: 'crack', note: 'слева, крепления сломаны' },
        { id: 'd2', zone: 'fender_front_left', kind: 'dent' },
      ],
      checked: ['vin_check', 'mileage', 'fuel', 'keys'],
    },
  },
  { // всё заполнено — ждёт нажатия «Завершить»
    id: 'j3', car_model: 'Skoda Octavia', plate_number: 'Е303КХ 124', client_name: 'Николаев А.',
    payment_type: 'insurance', insurer_name: 'РЕСО-Гарантия', phase: 'approval', approval_status: 'inspection',
    created_at: daysAgo(0), photos: allPhotos(),
    intake: {
      status: 'open', mileage: '154300', fuel: 'half', keys: '2',
      docs: ['sts', 'policy', 'referral'], equipment: ['jack', 'spare', 'wheel_wrench', 'first_aid', 'extinguisher'],
      damages: [{ id: 'd3', zone: 'door_rear_right', kind: 'paint' }],
      checked: insuranceChecked,
      notes: 'Клиент просит позвонить после 18:00.',
    },
  },
  { // стоит неделю, приёмки нет — красная
    id: 'j4', car_model: 'BMW X5', plate_number: 'О456ОО 124', client_name: 'Максимова Е.',
    payment_type: 'insurance', insurer_name: 'СОГАЗ', phase: 'approval', approval_status: 'inspection',
    created_at: daysAgo(7),
  },
  { // приёмка закрыта, но в калькуляцию ещё не перевели
    id: 'j5', car_model: 'Kia Rio', plate_number: 'Т555ТТ 124', client_name: 'Орлова С.',
    payment_type: 'legal', phase: 'approval', approval_status: 'inspection', created_at: daysAgo(2),
    photos: allPhotos(),
    intake: {
      status: 'done', mileage: '61200', fuel: 'full', keys: '2',
      docs: ['sts', 'pts'], equipment: ['jack', 'spare'], damages: [],
      checked: DEFAULT_INTAKE_SETTINGS.templates[1].items.map((i) => i.id),
      act_number: 'ПР-2026-0003', act_date: daysAgo(2), done_at: daysAgo(2),
    },
  },
  { id: 'j6', car_model: 'VW Tiguan', plate_number: 'Н881РА 124', phase: 'approval', approval_status: 'calc' },
  { id: 'j7', car_model: 'Mazda CX-5', plate_number: 'Р404ЕК 124', phase: 'repair' },
];

// «Песочница»: подменяем всё, что ходит в сеть, — демо должно нажиматься целиком.
// api подменяем прямо в объекте (как car-card-demo); загрузку фото — через проп
// uploadFn, потому что пространство имён ES-модуля переприсвоить нельзя.
// Что именно «записалось», видно в window.DEMO_WRITES.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DEMO_WRITES = [];
window.DEMO_WRITES = DEMO_WRITES;
api.jobs.saveIntake = async (jobId, patch) => { DEMO_WRITES.push({ op: 'saveIntake', jobId, patch }); await wait(250); };
api.jobs.addPhoto = async (jobId, p) => { DEMO_WRITES.push({ op: 'addPhoto', jobId, slot: p.category }); await wait(150); };
api.jobs.removePhoto = async (jobId, id) => { DEMO_WRITES.push({ op: 'removePhoto', jobId, id }); await wait(150); };
// Возвращает пару { number, at } — тот же контракт, что у настоящего api:
// печатный лист берёт дату оттуда же, откуда номер.
api.jobs.ensureIntakeActNumber = async () => { await wait(250); return { number: 'ПР-2026-0009', at: now }; };
api.jobs.update = async (jobId, patch) => { DEMO_WRITES.push({ op: 'update', jobId, patch }); await wait(250); };

const demoUpload = async (jobId, file, onProgress) => {
  for (let p = 20; p <= 100; p += 20) { onProgress?.(p); await wait(80); }
  return { url: stub('новое'), path: 'demo/new', size: 1000, w: 120, h: 120 };
};

const COMPANY = {
  name: 'Авто Академия', inn: '246000000000', address: 'г. Красноярск, ул. Пример, 1',
  phone: '+7 391 000-00-00', director: 'Герасимов А. В.',
};

function Demo() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('urgent');
  const [openId, setOpenId] = useState(null);

  const vm = useMemo(
    () => buildIntakeList(SEED, DEFAULT_INTAKE_SETTINGS, { query, sort, nowMs: now }),
    [query, sort],
  );

  const openJob = openId ? SEED.find((j) => j.id === openId) : null;

  return (
    <>
      <IntakeView
        loading={false}
        rows={vm.rows}
        counts={vm.counts}
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        onOpen={setOpenId}
      />
      {openJob && (
        <IntakeCard
          key={openId}
          job={openJob}
          settings={DEFAULT_INTAKE_SETTINGS}
          company={COMPANY}
          userName="Петров С. (демо)"
          uploadFn={demoUpload}
          onClose={() => setOpenId(null)}
          onOpenDocs={() => window.alert('Демо: в приложении откроются документы машины (ЗН / акт / счёт).')}
          onAdvanced={() => window.alert('Демо: машина ушла бы в колонку «Калькуляция».')}
        />
      )}
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
