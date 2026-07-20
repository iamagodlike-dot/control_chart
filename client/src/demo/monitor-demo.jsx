/* eslint-disable react-refresh/only-export-components */
// Standalone-демо экрана «Монитор» — БЕЗ Firebase, БЕЗ авторизации, сид в памяти.
// Рисует ТОТ ЖЕ <MonitorView> через ТУ ЖЕ вью-модель buildMonitor, что и реальный
// экран (Monitor), так что это точный предпросмотр без прод-данных. Сид покрывает
// все ветки classify: согласование (давнее 🔴 и свежее), доплата, очередь, ждёт
// запчасти, в ремонте, готово, отказ + машины клиента для фильтра по оплате.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MonitorView from '../components/MonitorView';
import { buildMonitor } from '../monitor';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

const H = 3600e3;
const D = 24 * H;
const now = Date.now();
const iso = (t) => new Date(t).toISOString();

// Этап маршрута с датами относительно «сейчас».
const stage = (status, startDaysAgo, endDaysAgo, title) => ({
  job_id: '', sequence: 0, title: title || null, status,
  start_at: iso(now - startDaysAgo * D),
  end_at: iso(now - endDaysAgo * D),
});

const SEED = [
  { // согласование, висит давно → 🔴
    id: 'j1', car_model: 'BMW X5', plate_number: 'О456ОО 124', order_number: 'ЗН-2026-0031',
    client_name: 'Иванов П.', payment_type: 'insurance',
    phase: 'approval', approval_status: 'inspection', created_at: now - 27 * D,
  },
  { // согласование, отправлено недавно → 🟢
    id: 'j2', car_model: 'Skoda Octavia', plate_number: 'Е303КХ 124', order_number: 'ЗН-2026-0044',
    client_name: 'Николаев А.', payment_type: 'insurance',
    phase: 'approval', approval_status: 'sent', created_at: now - 4 * D,
  },
  { // доплата — отдельная причина
    id: 'j3', car_model: 'VW Tiguan', plate_number: 'Н881РА 124', order_number: 'ЗН-2026-0038',
    client_name: 'Максимова Е.', payment_type: 'insurance',
    phase: 'approval', approval_status: 'surcharge', created_at: now - 16 * D,
  },
  { // очередь: согласовано неделю назад, этапов нет → 🟠
    id: 'j4', car_model: 'Hyundai Solaris', plate_number: 'К221ВМ 124', order_number: 'ЗН-2026-0035',
    client_name: 'Сидоров В.', payment_type: 'cash',
    phase: 'repair', repair_since: now - 7 * D, created_at: now - 12 * D, stages: [], parts: [],
  },
  { // ждёт запчасти: деталь заказана 6 дней назад → 🟠, дедлайн под угрозой
    id: 'j5', car_model: 'Toyota Rav4', plate_number: 'В789УТ 124', order_number: 'ЗН-2026-0029',
    client_name: 'Петров Н.', payment_type: 'insurance',
    phase: 'repair', repair_since: now - 9 * D, created_at: now - 10 * D,
    deadline: iso(now + 4 * D),
    stages: [stage('planned', -1, -3, 'Кузовной ремонт')],
    parts: [
      { id: 'p1', name: 'Крыло переднее', status: 'ordered', receiving_log: [{ status: 'ordered', at: now - 6 * D, by: 'zap@academyauto.ru' }] },
      { id: 'p2', name: 'Фара правая', status: 'need' },
    ],
  },
  { // в ремонте прямо сейчас → простоя нет, 🟢
    id: 'j6', car_model: 'Toyota Camry', plate_number: 'А123АВ 124', order_number: 'ЗН-2026-0027',
    client_name: 'Козлов Д.', payment_type: 'insurance',
    phase: 'repair', repair_since: now - 15 * D, created_at: now - 17 * D,
    deadline: iso(now + 1 * D),
    stages: [stage('done', 6, 3, 'Жестянка'), { ...stage('in_progress', 1, -1, 'Окраска') }],
    parts: [{ id: 'p3', name: 'Бампер', status: 'in', receiving_log: [{ status: 'ordered', at: now - 12 * D }, { status: 'in', at: now - 8 * D }] }],
  },
  { // готово: все этапы закрыты 9 дней назад — нейтрально, не простой
    id: 'j7', car_model: 'Kia Rio', plate_number: 'Т555ТТ 124', order_number: 'ЗН-2026-0018',
    client_name: 'Орлова С.', payment_type: 'cash',
    created_at: now - 15 * D,
    stages: [stage('done', 14, 9, 'Ремонт бампера')],
  },
  { // отказ страховой — тупик, серый, внизу
    id: 'j8', car_model: 'Lada Vesta', plate_number: 'М001МН 124', order_number: 'ЗН-2026-0040',
    client_name: 'Фомин И.', payment_type: 'insurance',
    phase: 'approval', approval_status: 'rejected', created_at: now - 30 * D,
  },
  { // старая машина без phase/repair_since (до появления фаз) — считается ремонтом
    id: 'j9', car_model: 'Mazda CX-5', plate_number: 'Р404ЕК 124', order_number: '77',
    client_name: 'Громов К.', payment_type: 'cash',
    created_at: now - 3 * D, stages: [], parts: [],
    deadline: iso(now - 1 * D), // дедлайн уже прошёл — покажет ⚠️... (без этапов deadlineState молчит)
  },
];

function Demo() {
  const [stageF, setStageF] = useState('all');
  const [payer, setPayer] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('idle');

  const vm = useMemo(
    () => buildMonitor(SEED, { stage: stageF, payer, query, sort }),
    [stageF, payer, query, sort],
  );

  return (
    <MonitorView
      loading={false}
      rows={vm.rows}
      counts={vm.counts}
      summary={vm.summary}
      stage={stageF}
      onStage={setStageF}
      payer={payer}
      onPayer={setPayer}
      query={query}
      onQuery={setQuery}
      sort={sort}
      onSort={setSort}
      onOpen={(id) => window.alert(`Демо: в приложении тут откроется карточка машины (${id})`)}
    />
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
