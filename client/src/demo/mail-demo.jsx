/* eslint-disable react-refresh/only-export-components */
// Превью окна «Фото и письмо» БЕЗ входа и Firebase: настоящий компонент MailModal
// поверх выдуманной машины. Нужен, чтобы проверить глазами то, что иначе видно
// только в проде: подставился ли текст письма, читаются ли подписи под фото,
// собирается ли архив.
//   npm run dev → http://localhost:5174/mail-demo.html
//
// «Скачать архив» здесь работает по-настоящему: zip соберётся и скачается.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../api';
import MailModal from '../components/MailModal';
import '../index.css';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

// Запись в журнал машины — в песочнице Firestore недоступен.
api.jobs.logExport = async (jobId, entry) => ({ id: 'demo', at: Date.now(), by: 'demo@academyauto.ru', ...entry });

// Цветной прямоугольник вместо снимка.
const ph = (c) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='90'%3E%3Crect width='120' height='90' fill='%23${c}'/%3E%3C/svg%3E`;
const shot = (slot, color) => ({
  id: `ph-${slot}`, category: `intake:${slot}`, url: ph(color),
  path: `/uploads/jobs/demo/${slot}.jpg`, size: 320_000,
});

const JOB = {
  id: 'demoJob',
  car_model: 'Geely Atlas Pro', year: '2022', color: 'чёрный',
  plate_number: 'А123ВС 96', vin: 'LB37622Z0NX012345',
  order_number: 'ЗН-2026-0007',
  payment_type: 'insurance', insurer_name: 'Ингосстрах', policy_type: 'osago', claim_number: 'PVU-1234567',
  intake: {
    mileage: '84 210', fuel: 'quarter',
    notes: 'Машина на ходу, второй ключ клиент привезёт позже',
    damages: [
      { zone: 'bumper_front', kind: 'replace', scope: 'case' },
      { zone: 'hood', kind: 'dent', scope: 'case', note: 'вмятина у левой фары, ~15 см' },
      { zone: 'headlight_left', kind: 'crack', scope: 'case' },
      { zone: 'fender_front_left', kind: 'paint', scope: 'case' },
      { zone: 'door_rear_left', kind: 'scratch', scope: 'old', note: 'было до аварии' },
    ],
  },
  photos: [
    shot('front_left', '3a4250'), shot('side_left', '44506a'), shot('side_right', '4a5a6a'),
    shot('rear_right', '3f4a58'), shot('vin', '5a4230'), shot('odometer', '6a5240'),
      shot('damage', '7a3a3a'),
    { ...shot('damage', '8a4444'), id: 'ph-damage-2', path: '/uploads/jobs/demo/damage2.jpg' },
    shot('interior', '42505a'),
    { id: 'ph-before', category: 'before', url: ph('2f5a44'), path: '/uploads/jobs/demo/b1.jpg', size: 300_000 },
    { id: 'ph-after', category: 'after', url: ph('2f4a5a'), path: '/uploads/jobs/demo/a1.jpg', size: 300_000 },
    // Фото приёмки запчасти — в письмо попадать НЕ должно (проверяем, что его нет).
    { id: 'ph-recv', category: 'receiving', partId: 'pt1', url: ph('555555'), path: '/uploads/jobs/demo/r1.jpg' },
  ],
};

const COMPANY = {
  name: 'ООО «Авто Академия»', phone: '+7 391 219-40-40',
  address: 'Красноярск, ул. Пограничников, 42', director: 'Иванов И. И.',
};

function Demo() {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ padding: 20, minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <h2 style={{ fontFamily: 'var(--font-display)' }}>Окно «Фото и письмо» — демо</h2>
      <p style={{ maxWidth: 620, color: 'var(--color-text-muted)', fontSize: 13 }}>
        Настоящее окно на выдуманной машине. «Скачать архив» работает по-настоящему —
        соберётся и скачается zip с выдуманными снимками.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
        <button className="primary" onClick={() => setOpen(true)}>Открыть окно</button>
      </div>
      {open && (
        <MailModal
          job={JOB}
          company={COMPANY}
          onLogged={(entry) => console.log('в журнал машины:', entry)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
