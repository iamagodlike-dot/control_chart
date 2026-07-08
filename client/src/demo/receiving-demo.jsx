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

const SEED = [
  {
    id: 'j1', car_model: 'TOYOTA CAMRY', plate: 'K456TT124', order_number: '110', client_name: 'Смирнов В.', cell_ids: ['A1'],
    parts: [
      { id: 'p1', name: 'Бампер передний', code: '52119-06', qty: 1, supplier: 'Exist', status: 'ordered', eta: '05.07' },
      { id: 'p2', name: 'Фара левая', code: '81150-33', qty: 1, supplier: 'Emex', status: 'in' },
    ],
  },
  {
    id: 'j2', car_model: 'KIA RIO', plate: 'A007KX124', order_number: '102', client_name: 'Кузнецов Д.', cell_ids: ['B3'],
    parts: [
      { id: 'p3', name: 'Капот', code: '', qty: 1, supplier: 'Разборка на Калинина', status: 'ordered', eta: '01.07' },
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
  const [filter, setFilter] = useState('ordered');
  const { groups, counts } = useMemo(() => buildReceiving(jobs, filter), [jobs, filter]);

  function onSetStatus(jobId, partId, status) {
    setJobs((js) => js.map((j) => (j.id !== jobId ? j
      : { ...j, parts: j.parts.map((p) => (p.id === partId ? { ...p, status } : p)) })));
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
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
