/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the «История приёмки» screen — NO Firebase, NO auth, seed
// data in memory. Renders the SAME <ReceivingHistoryView> as the real screen
// (ReceivingHistory) via the SAME buildReceivingHistory VM, so this is a faithful,
// credential-free preview.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReceivingHistoryView from '../components/ReceivingHistoryView';
import { buildReceivingHistory } from '../receivingHistory';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

// Заглушка-картинка (без сервера): цветной прямоугольник с подписью в data-URI.
const ph = (label, hue) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='120' height='120' fill='hsl(${hue},24%,32%)'/><text x='60' y='65' font-family='sans-serif' font-size='12' fill='#fff' text-anchor='middle'>${label}</text></svg>`,
)}`;

const H = 3600e3;
const D = 24 * H;
const now = Date.now();

const SEED = [
  {
    id: 'j1', car_model: 'TOYOTA CAMRY', plate: 'K456TT124', order_number: '110', client_name: 'Смирнов В.',
    parts: [
      {
        id: 'p1', name: 'Бампер передний', code: '52119-06', status: 'in',
        receiving_log: [
          { status: 'ordered', at: now - 5 * D - 2 * H, by: 'anna@academyauto.ru' },
          { status: 'arrived', at: now - 1 * D - 3 * H, by: 'anna@academyauto.ru' },
          { status: 'in', at: now - 2 * H, by: 'ivan@academyauto.ru' },
        ],
      },
      {
        id: 'p2', name: 'Фара левая', code: '81150-33', status: 'arrived',
        receiving_log: [{ status: 'arrived', at: now - 1 * H, by: 'ivan@academyauto.ru' }],
      },
    ],
    photos: [
      { id: 'ph1', category: 'receiving', partId: 'p1', url: ph('бампер', 40), path: '/demo/1', uploaded_at: now - 90 * 60e3, uploaded_by: 'ivan@academyauto.ru' },
    ],
  },
  {
    id: 'j2', car_model: 'KIA RIO', plate: 'A007KX124', order_number: '102', client_name: 'Кузнецов Д.',
    parts: [
      {
        id: 'p3', name: 'Капот', code: '', status: 'in',
        receiving_log: [
          { status: 'ordered', at: now - 6 * D, by: 'anna@academyauto.ru' },
          { status: 'in', at: now - 1 * D - 1 * H, by: 'ivan@academyauto.ru' },
        ],
      },
    ],
    photos: [
      { id: 'ph2', category: 'receiving', partId: 'p3', url: ph('капот · 1', 210), path: '/demo/2', uploaded_at: now - 1 * D - 50 * 60e3, uploaded_by: 'ivan@academyauto.ru' },
      { id: 'ph3', category: 'receiving', partId: 'p3', url: ph('капот · 2', 150), path: '/demo/3', uploaded_at: now - 1 * D - 48 * 60e3, uploaded_by: 'ivan@academyauto.ru' },
    ],
  },
  {
    id: 'j3', car_model: 'BMW X5', plate: 'M012MM124', order_number: '96', client_name: 'Орлов И.', archived: true,
    parts: [
      {
        id: 'p5', name: 'Дверь задняя левая', code: '41007-XX', status: 'in',
        receiving_log: [
          { status: 'ordered', at: now - 20 * D, by: 'anna@academyauto.ru' },
          { status: 'arrived', at: now - 16 * D, by: 'ivan@academyauto.ru' },
          { status: 'in', at: now - 15 * D, by: 'ivan@academyauto.ru' },
        ],
      },
    ],
  },
];

function Demo() {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { events, counts } = useMemo(() => buildReceivingHistory(SEED, { filter, query }), [filter, query]);

  return (
    <ReceivingHistoryView
      loading={false}
      events={events}
      counts={counts}
      filter={filter}
      onFilter={setFilter}
      query={query}
      onQuery={setQuery}
      onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 700); }}
      refreshing={refreshing}
    />
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
