/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the экспедитор «Приёмка» screen — NO Firebase, NO auth,
// seed data in memory. Renders the SAME <ReceivingView> as the real screen
// (PartsReceiving), so this is a faithful, credential-free preview.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReceivingView from '../components/ReceivingView';
import { buildReceiving } from '../receiving';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

// Заглушка-картинка (без сервера): цветной прямоугольник с подписью в data-URI.
const ph = (label, hue) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='120' height='120' fill='hsl(${hue},24%,32%)'/><text x='60' y='65' font-family='sans-serif' font-size='12' fill='#fff' text-anchor='middle'>${label}</text></svg>`,
)}`;

const SEED = [
  {
    id: 'j1', car_model: 'TOYOTA CAMRY', plate: 'K456TT124', order_number: '110', client_name: 'Смирнов В.', cell_ids: ['A1'],
    parts: [
      { id: 'p1', name: 'Бампер передний', code: '52119-06', qty: 1, supplier: 'Exist', status: 'ordered', eta: '05.07' },
      { id: 'p2', name: 'Фара левая', code: '81150-33', qty: 1, supplier: 'Emex', status: 'in' },
    ],
    photos: [
      { id: 'ph1', category: 'receiving', partId: 'p2', url: ph('фара · 1', 40), path: '/demo/1', uploaded_at: 1 },
      { id: 'ph2', category: 'receiving', partId: 'p2', url: ph('фара · 2', 210), path: '/demo/2', uploaded_at: 2 },
    ],
  },
  {
    id: 'j2', car_model: 'KIA RIO', plate: 'A007KX124', order_number: '102', client_name: 'Кузнецов Д.', cell_ids: ['B3'],
    parts: [
      { id: 'p3', name: 'Капот', code: '', qty: 1, supplier: 'Разборка на Калинина', status: 'arrived', eta: '01.07', comment: 'Небольшая вмятина на кромке — согласовано с клиентом' },
      { id: 'p4', name: 'Крыло переднее правое', code: '53801-06', qty: 1, supplier: 'Exist', status: 'ordered', eta: '06.07' },
    ],
  },
  {
    id: 'j3', car_model: 'BMW X5', plate: 'M012MM124', order_number: '118', client_name: 'Орлов И.',
    parts: [
      { id: 'p5', name: 'Дверь задняя левая', code: '41007-XX', qty: 1, status: 'in' },
    ],
  },
];

function Demo() {
  const [jobs, setJobs] = useState(SEED);
  const [filter, setFilter] = useState('arrived');
  const { groups, counts } = useMemo(() => buildReceiving(jobs, filter), [jobs, filter]);

  function onSetStatus(jobId, partId, status) {
    setJobs((js) => js.map((j) => (j.id !== jobId ? j
      : { ...j, parts: j.parts.map((p) => (p.id === partId ? { ...p, status } : p)) })));
  }

  // В демо нет сервера: «загрузка» — это локальный превью-URL выбранного файла.
  function onAddPhoto(jobId, partId, files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setJobs((js) => js.map((j) => (j.id !== jobId ? j : {
      ...j,
      photos: [
        ...(j.photos || []),
        ...list.map((f, i) => ({
          id: `d${Date.now()}_${i}`, category: 'receiving', partId,
          url: URL.createObjectURL(f), path: '/demo', uploaded_at: Date.now() + i,
        })),
      ],
    })));
  }
  function onDeletePhoto(jobId, photo) {
    setJobs((js) => js.map((j) => (j.id !== jobId ? j
      : { ...j, photos: (j.photos || []).filter((p) => p.id !== photo.id) })));
  }
  function onSaveComment(jobId, partId, text) {
    setJobs((js) => js.map((j) => (j.id !== jobId ? j
      : { ...j, parts: j.parts.map((p) => (p.id === partId ? { ...p, comment: (text || '').trim() } : p)) })));
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <ReceivingView
        loading={false}
        groups={groups}
        counts={counts}
        filter={filter}
        onFilter={setFilter}
        onSetStatus={onSetStatus}
        busy={null}
        onAddPhoto={onAddPhoto}
        onDeletePhoto={onDeletePhoto}
        uploadPart={null}
        uploadProgress={0}
        photoErr={null}
        onSaveComment={onSaveComment}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
