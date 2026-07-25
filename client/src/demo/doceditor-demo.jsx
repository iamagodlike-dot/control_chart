/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the document editor (генерация/редактирование документов) —
// NO Firebase auth, seed data in memory. Renders the SAME <DocumentsModal> the
// real app opens, so this is a faithful, credential-free preview of the Вариант B
// redesign (широкая форма + позиции-карточки + прячущийся лист). The api reads are
// stubbed to empty so the editor mounts to a fresh snapshot without hitting Firestore.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../api';
import DocumentsModal from '../components/DocumentsModal';
import '../App.css';

// Stub the Firestore-backed calls the editor makes so the demo never needs auth.
api.orderDocuments.listByJob = async () => [];
api.orderDocuments.get = async () => storedDoc;
api.orderDocuments.create = async (doc) => { storedDoc = { ...doc, id: 'demo-doc', doc_number: doc.doc_number || 'ЗН-0001' }; return storedDoc; };
api.orderDocuments.update = async (id, data) => { storedDoc = { ...(storedDoc || {}), ...data }; return storedDoc; };
let storedDoc = null;
// «Обновить карточку машины» пишем в ПАМЯТЬ и показываем результат рядом с редактором —
// иначе на демо не видно, что именно кнопка сделала с карточкой (переименовала позицию
// или завела вторую). Семантика та же, что у настоящих api.jobs.update/savePart:
// мерж позиции по id, upsert.
const card = { apply: () => {} }; // заполняется эффектом демо-компонента
api.jobs.update = async (id, patch) => { card.apply((j) => ({ ...j, ...patch })); return {}; };
api.jobs.savePart = async (id, part) => {
  card.apply((j) => {
    const parts = (j.parts || []).slice();
    const i = parts.findIndex((p) => p.id === part.id);
    if (i >= 0) parts[i] = { ...parts[i], ...part };
    else parts.push(part);
    return { ...j, parts };
  });
  return {};
};

const JOB = {
  id: 'demo-job',
  car_model: 'Toyota Camry',
  plate_number: 'К456ТТ124',
  vin: 'JTNBE40K103123456',
  year: '2019',
  mileage: '84000',
  client_name: 'Смирнов Виктор Петрович',
  client_phone: '+7 902 123-45-67',
  order_number: '110',
  discount: 8000,
  // Страховая машина с франшизой — для проверки: счёт страховой уходит БЕЗ франшизы
  payment_type: 'insurance',
  insurer_name: 'СОГАЗ',
  claim_number: 'PVU-1234567',
  franchise: 15000,
  services: [
    { id: 's1', name: 'Окраска двери передней правой', qty: 1, price: 12500 },
    { id: 's2', name: 'Ремонт и окраска крыла заднего левого', qty: 1, price: 18900 },
    { id: 's3', name: 'Полировка кузова (полный круг)', qty: 1, price: 9000 },
    { id: 's4', name: 'Развал-схождение', qty: 1, price: 2500 },
  ],
  parts: [
    { id: 'p1', code: '53801-06020', name: 'Крыло переднее правое', qty: 1, unit: 'шт.', price: 18000 },
    { id: 'p2', code: '52119-06977', name: 'Бампер передний в сборе', qty: 1, unit: 'шт.', price: 24500 },
    { id: 'p3', code: '', name: 'Краска база 202 Чёрный', qty: 2, unit: 'кг', price: 3200 },
    { id: 'p4', code: '', name: 'Материалы (грунт, лак, абразив)', qty: 1, unit: 'компл.', price: 6500 },
  ],
};

const COMPANY = {
  name: 'ИП Академия Авто',
  inn: '246512345678',
  ogrn: '319246800012345',
  kpp: '',
  address: 'г. Красноярск, Северное шоссе, 17Д стр 19',
  phone: '+7 391 200-10-20',
  director: 'Гончаров И. С.',
  bank: {
    bank_name: 'Красноярское отделение №8646 ПАО Сбербанк',
    bik: '040407627',
    account: '40802810131000012345',
    corr_account: '30101810800000000627',
  },
};

function Demo() {
  // Карточка машины живёт в стейте демо: так видно, ЧТО кнопка «Обновить карточку
  // машины» сделала с позициями (переименовала или добавила вторую).
  const [job, setJob] = useState(JOB);
  useEffect(() => { card.apply = (fn) => setJob((j) => fn(j)); }, []);
  return (
    <>
      <div style={{ position: 'fixed', right: 8, bottom: 8, zIndex: 9999, maxWidth: 360, maxHeight: '42vh', overflow: 'auto', padding: '10px 12px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line2)', font: "11px/1.5 'JetBrains Mono',monospace", color: 'var(--text2)' }}>
        <b style={{ color: 'var(--brand)' }}>Карточка машины (демо)</b>
        <div data-testid="card-parts">
          {(job.parts || []).map((p) => <div key={p.id}>{p.id} · {p.code || '—'} · {p.name} · {p.qty} × {p.price}</div>)}
        </div>
        <div data-testid="card-services" style={{ marginTop: 6 }}>
          {(job.services || []).map((s) => <div key={s.id}>{s.id} · {s.name} · {s.qty} × {s.price}</div>)}
        </div>
      </div>
      <DocumentsModal
        job={job}
        company={COMPANY}
        onClose={() => { /* demo: no-op */ }}
        onJobUpdated={() => { /* demo: no-op */ }}
      />
    </>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
