/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the master «Мои машины» screen — NO Firebase, NO auth, seed
// data in memory. Renders the SAME <MyWorkView> as the real screen (MyWork), so
// this is a faithful, credential-free preview. Toggle switches to the
// «логин не привязан к мастеру» state.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MyWorkView from '../components/MyWorkView';
import { buildMasterWork } from '../masterWork';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

const NOW = new Date('2026-07-08T12:00:00').getTime();

const POSTS = [
  { id: 'post-dis', name: 'Разборка' },
  { id: 'post-paint', name: 'Окраска' },
  { id: 'post-fit', name: 'Сборка' },
];

const STAGES = [
  // машина с просрочкой (срок этапа — вчера)
  { id: 's3', job_id: 'j2', master_id: 'm1', post_id: 'post-dis', start_at: '2026-07-07T09:00:00', end_at: '2026-07-07T11:00:00', status: 'planned', car_model: 'KIA RIO', plate_number: 'A007KX124', order_number: '102', client_name: 'Кузнецов Д.', deadline: '2026-07-08' },
  // машина в работе + следующий этап запланирован
  { id: 's1', job_id: 'j1', master_id: 'm1', post_id: 'post-dis', start_at: '2026-07-08T08:00:00', end_at: '2026-07-08T14:00:00', status: 'in_progress', car_model: 'TOYOTA CAMRY', plate_number: 'K456TT124', order_number: '110', client_name: 'Смирнов В.', deadline: '2026-07-10' },
  { id: 's2', job_id: 'j1', master_id: 'm1', post_id: 'post-paint', start_at: '2026-07-08T14:00:00', end_at: '2026-07-08T18:00:00', status: 'planned', car_model: 'TOYOTA CAMRY', plate_number: 'K456TT124', order_number: '110', client_name: 'Смирнов В.', deadline: '2026-07-10' },
  // машина полностью готова
  { id: 's5', job_id: 'j4', master_id: 'm1', post_id: 'post-fit', start_at: '2026-07-06T09:00:00', end_at: '2026-07-06T18:00:00', status: 'done', car_model: 'LADA VESTA', plate_number: 'O777OO124', order_number: '95', client_name: 'Петров А.' },
  // чужой мастер — не должен показаться
  { id: 's9', job_id: 'j9', master_id: 'm2', post_id: 'post-dis', start_at: '2026-07-08T09:00:00', end_at: '2026-07-08T12:00:00', status: 'planned', car_model: 'BMW X5' },
];

function Demo() {
  const [linked, setLinked] = useState(true);
  const { cards, counts } = useMemo(
    () => buildMasterWork('m1', { stages: STAGES, posts: POSTS }, NOW),
    [],
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <div style={{ padding: '10px 26px 0' }}>
        <button
          onClick={() => setLinked((v) => !v)}
          style={{ fontSize: 12, padding: '5px 11px', borderRadius: 8, cursor: 'pointer' }}
        >
          demo: {linked ? 'показать «логин не привязан»' : 'показать список машин'}
        </button>
      </div>
      <MyWorkView loading={false} hasMaster={linked} cards={cards} counts={counts} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
