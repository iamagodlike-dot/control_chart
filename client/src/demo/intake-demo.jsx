// Standalone-демо экрана мастера-приёмщика — БЕЗ Firebase, БЕЗ авторизации, сид в
// памяти. Рисует НАСТОЯЩИЙ <Intake> целиком: подменены только вызовы к базе, а
// подписка, часы экрана, попап и запись даты работают как на бою. Поэтому демо —
// точный предпросмотр, а не отдельная вёрстка.
//
// Что можно потрогать: пригласить машину (уедет из списка в календарь), перенести
// с чекбоксом и причиной, отметить «клиент подтвердил», нажать «Начать
// дефектовку» (следующий шаг проекта — честно скажет, что экрана ещё нет).
// Что «записалось», видно в window.DEMO_WRITES.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Intake from '../components/Intake';
import { api } from '../api';
import { installSender } from '../photoQueue';
import { photoCategory } from '../intake';
import '../App.css';
import '../orderDoc.css';

document.documentElement.dataset.theme = 'dark';

const now = Date.now();

// Момент внутри суток со сдвигом в днях от сегодняшнего — в МЕСТНОМ времени,
// как и весь экран (см. комментарий про Красноярск в intake.js).
function dayAt(offsetDays, hh = 9, mm = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

const seed = (over) => ({
  phase: 'approval',
  approval_status: 'inspection',
  payment_type: 'insurance',
  ...over,
});

let JOBS = [
  // ── Ждут приглашения: зелёная / жёлтая / красная ────────────────────────
  seed({
    id: 'w0', car_model: 'Toyota Camry', plate_number: 'А123АВ 124', client_name: 'Иванов П. С.',
    client_phone: '+7 902 000-11-22', insurer_name: 'Ингосстрах', claim_number: 'У-123/26',
    policy_number: 'ККК 1234567890', vin: 'XW8ZZZ61ZJG000123', order_number: 'ЗН-2026-0044',
    approval_since: dayAt(0, 8, 40),
  }),
  seed({
    id: 'w2', car_model: 'Hyundai Solaris', plate_number: 'К221ВМ 124', client_name: 'Сидоров В. А.',
    client_phone: '+7 913 555-40-01', payment_type: 'cash',
    notes: 'Машина не на ходу, привезут на эвакуаторе.',
    approval_since: dayAt(-2, 11, 0),
  }),
  seed({
    id: 'w6', car_model: 'BMW X5', plate_number: 'О456ОО 124', client_name: 'Максимова Е. Ю.',
    client_phone: '+7 923 118-77-90', insurer_name: 'СОГАЗ', claim_number: 'PVU-77120',
    approval_since: dayAt(-6, 15, 20),
  }),
  seed({
    id: 'w1', car_model: 'Lada Vesta', plate_number: 'У771ХА 124', client_name: 'Гончаров Д.',
    client_phone: '', payment_type: 'legal',
    approval_since: dayAt(-1, 9, 10),
  }),

  // ── Записаны: сегодня, завтра (с подтверждением и без), дальше ──────────
  seed({
    id: 's-today', car_model: 'Skoda Octavia', plate_number: 'Е303КХ 124', client_name: 'Николаев А.',
    client_phone: '+7 902 944-13-13', insurer_name: 'РЕСО-Гарантия', claim_number: 'РГ-9014',
    approval_since: dayAt(-3, 10, 0),
    intake: {
      scheduled_at: dayAt(0, 15, 0), invited_at: dayAt(-3, 10, 30), invited_by: 'priem@akadem.ru',
      confirmed_at: dayAt(-1, 17, 0), confirmed_for: dayAt(0, 15, 0), confirmed_by: 'priem@akadem.ru',
      log: [
        { at: dayAt(-3, 10, 30), by: 'priem@akadem.ru', kind: 'invite', to: dayAt(0, 15, 0) },
        { at: dayAt(-1, 17, 0), by: 'priem@akadem.ru', kind: 'confirm', to: dayAt(0, 15, 0) },
      ],
    },
  }),
  seed({
    id: 's-tomorrow', car_model: 'Kia Rio', plate_number: 'Т555ТТ 124', client_name: 'Орлова С. П.',
    client_phone: '+7 908 201-33-45', payment_type: 'cash',
    approval_since: dayAt(-2, 12, 0),
    intake: {
      scheduled_at: dayAt(1, 10, 0), invited_at: dayAt(-2, 12, 40), invited_by: 'priem@akadem.ru',
      log: [{ at: dayAt(-2, 12, 40), by: 'priem@akadem.ru', kind: 'invite', to: dayAt(1, 10, 0) }],
    },
  }),
  seed({
    id: 's-tomorrow2', car_model: 'VW Tiguan', plate_number: 'Н881РА 124', client_name: 'Белов К.',
    client_phone: '+7 391 233-90-12', insurer_name: 'Альфастрахование',
    approval_since: dayAt(-4, 9, 0),
    intake: {
      scheduled_at: dayAt(1, 14, 30), invited_at: dayAt(-4, 9, 30), invited_by: 'priem@akadem.ru',
      confirmed_at: dayAt(0, 9, 5), confirmed_for: dayAt(1, 14, 30), confirmed_by: 'priem@akadem.ru',
      log: [
        { at: dayAt(-4, 9, 30), by: 'priem@akadem.ru', kind: 'invite', to: dayAt(1, 14, 30) },
        { at: dayAt(0, 9, 5), by: 'priem@akadem.ru', kind: 'confirm', to: dayAt(1, 14, 30) },
      ],
    },
  }),
  seed({
    id: 's-next', car_model: 'Mazda CX-5', plate_number: 'Р404ЕК 124', client_name: 'Зотова М.',
    client_phone: '+7 902 777-01-55', insurer_name: 'Ингосстрах', claim_number: 'У-980/26',
    approval_since: dayAt(-5, 10, 0),
    // Дважды переносили — в попапе видно всю историю с причинами.
    intake: {
      scheduled_at: dayAt(8, 11, 0), invited_at: dayAt(-5, 11, 0), invited_by: 'priem@akadem.ru',
      log: [
        { at: dayAt(-5, 11, 0), by: 'priem@akadem.ru', kind: 'invite', to: dayAt(2, 9, 0) },
        { at: dayAt(-2, 16, 20), by: 'priem@akadem.ru', kind: 'move', from: dayAt(2, 9, 0), to: dayAt(8, 11, 0), reason: 'клиент в командировке до конца недели' },
      ],
    },
  }),
  seed({
    id: 's-week2', car_model: 'Renault Duster', plate_number: 'С090МН 124', client_name: 'Пахомов И.',
    client_phone: '+7 913 004-88-20', payment_type: 'cash',
    approval_since: dayAt(-1, 13, 0),
    intake: { scheduled_at: dayAt(9, 16, 0), invited_at: dayAt(-1, 13, 30), log: [] },
  }),

  // ── Просроченные: вчера и совсем давняя (в сетку уже не попадает) ───────
  seed({
    id: 'o-yesterday', car_model: 'Nissan X-Trail', plate_number: 'В700ОР 124', client_name: 'Ефимов А. Л.',
    client_phone: '+7 923 500-19-04', insurer_name: 'ВСК', claim_number: 'ВСК-4410',
    approval_since: dayAt(-7, 9, 0),
    intake: {
      scheduled_at: dayAt(-1, 9, 0), invited_at: dayAt(-7, 9, 30),
      log: [{ at: dayAt(-7, 9, 30), by: 'priem@akadem.ru', kind: 'invite', to: dayAt(-1, 9, 0) }],
    },
  }),
  seed({
    id: 'o-old', car_model: 'Chery Tiggo 7', plate_number: 'М012АК 124', client_name: 'Русанова О.',
    client_phone: '+7 902 611-22-33', insurer_name: 'Согласие',
    approval_since: dayAt(-16, 9, 0),
    intake: {
      scheduled_at: dayAt(-9, 13, 0), invited_at: dayAt(-16, 10, 0),
      log: [{ at: dayAt(-16, 10, 0), by: 'priem@akadem.ru', kind: 'invite', to: dayAt(-9, 13, 0) }],
    },
  }),

  // ── Далёкий хвост: «приедут позже двух недель» ─────────────────────────
  seed({
    id: 'l-far', car_model: 'Geely Monjaro', plate_number: 'Х222ХХ 124', client_name: 'Дементьев Р.',
    client_phone: '+7 908 900-40-40', insurer_name: 'Ингосстрах', claim_number: 'У-1102/26',
    approval_since: dayAt(-1, 9, 0),
    intake: { scheduled_at: dayAt(22, 10, 0), invited_at: dayAt(-1, 9, 30), log: [] },
  }),

  // ── Не наши: другая колонка и другая фаза — на экран попасть не должны ──
  seed({ id: 'x-calc', car_model: 'Haval Jolion', plate_number: 'Ж999ЖЖ 124', approval_status: 'calc' }),
  { id: 'x-repair', car_model: 'Ford Focus', plate_number: 'Ц111ЦЦ 124', phase: 'repair' },
];

// ── «Песочница» вместо Firestore ──────────────────────────────────────────
// Подписку и записи подменяем прямо в объекте api (как car-card-demo). Записи
// меняют сид в памяти и переизлучают подписку — поэтому приглашённая машина
// действительно уезжает из списка в календарь, как в приложении.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DEMO_WRITES = [];
window.DEMO_WRITES = DEMO_WRITES;

const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(JOBS.map((j) => ({ ...j }))); };

api.jobs.subscribeApproval = (onData) => {
  listeners.add(onData);
  setTimeout(() => onData(JOBS.map((j) => ({ ...j }))), 80);   // как первый снапшот
  return () => listeners.delete(onData);
};

const patchJob = (jobId, fn) => {
  JOBS = JOBS.map((j) => (j.id === jobId ? { ...j, intake: fn(j.intake || {}) } : j));
  emit();
};
const patchJobRaw = (jobId, fn) => {
  JOBS = JOBS.map((j) => (j.id === jobId ? fn(j) : j));
  emit();
};

// Повторяет логику настоящей записи: журнал, отметки «кто/когда» и сброс
// подтверждения при переносе — чтобы в демо ловились те же огрехи, что на бою.
api.jobs.setIntakeDate = async (jobId, { at, reason = '', agreed = false, prevAt = 0 }) => {
  DEMO_WRITES.push({ op: 'setIntakeDate', jobId, at, reason, agreed, prevAt });
  await wait(300);
  patchJob(jobId, (prev) => {
    const had = Number(prev.scheduled_at) || 0;
    const entry = { at: Date.now(), by: 'priem@akadem.ru (демо)', kind: had ? 'move' : 'invite', to: at };
    if (had) entry.from = had;
    if (reason.trim()) entry.reason = reason.trim();
    return {
      ...prev,
      scheduled_at: at,
      invited_at: Number(prev.invited_at) || Date.now(),
      confirmed_at: 0, confirmed_for: 0,
      log: [...(prev.log || []), entry],
    };
  });
};

api.jobs.confirmIntakeVisit = async (jobId, { at } = {}) => {
  DEMO_WRITES.push({ op: 'confirmIntakeVisit', jobId, at });
  await wait(250);
  patchJob(jobId, (prev) => ({
    ...prev,
    confirmed_at: Date.now(),
    confirmed_for: Number(prev.scheduled_at) || 0,
    log: [...(prev.log || []), { at: Date.now(), by: 'priem@akadem.ru (демо)', kind: 'confirm', to: Number(prev.scheduled_at) || 0 }],
  }));
};

// ── Дефектовка ────────────────────────────────────────────────────────────
// Правки полей приходят по одному ключу за раз (так же, как настоящая запись по
// путям `intake.<поле>`), поэтому просто мержим их в приёмку машины.
api.jobs.saveInspection = async (jobId, patch) => {
  DEMO_WRITES.push({ op: 'saveInspection', jobId, patch });
  await wait(200);
  patchJob(jobId, (prev) => ({ ...prev, ...patch }));
};
api.jobs.startInspection = async (jobId) => {
  DEMO_WRITES.push({ op: 'startInspection', jobId });
  patchJob(jobId, (prev) => ({ ...prev, started_at: Date.now() }));
};
api.jobs.finishInspection = async (jobId, finished = true) => {
  DEMO_WRITES.push({ op: 'finishInspection', jobId, finished });
  await wait(250);
  patchJob(jobId, (prev) => ({ ...prev, finished_at: finished ? Date.now() : 0 }));
};
api.jobs.ensureIntakeActNumber = async (jobId) => {
  await wait(300);
  const number = 'ПР-2026-0009';
  const at = Date.now();
  patchJob(jobId, (prev) => ({ ...prev, act_number: number, act_date: at }));
  return { number, at };
};
api.jobs.update = async (jobId, patch) => {
  DEMO_WRITES.push({ op: 'update', jobId, patch });
  await wait(250);
  patchJobRaw(jobId, (j) => ({ ...j, ...patch }));
};
api.jobs.addPhoto = async (jobId, photo) => {
  patchJobRaw(jobId, (j) => ({ ...j, photos: [...(j.photos || []), photo] }));
};
api.jobs.removePhoto = async (jobId, photoOrId) => {
  const id = typeof photoOrId === 'object' ? photoOrId.id : photoOrId;
  patchJobRaw(jobId, (j) => ({ ...j, photos: (j.photos || []).filter((p) => p.id !== id) }));
};
api.settings.getCompany = async () => ({
  name: 'Авто Академия', inn: '246000000000', address: 'г. Красноярск, Северное шоссе, 17Д стр 19',
  phone: '+7 983 202-18-18', director: 'Герасимов А. В.',
});

// Отправку снимков в демо изображаем задержкой в 1,5 секунды — за это время видно,
// как снимок сначала висит «ждёт отправки», а потом становится обычным. Сама
// очередь настоящая, в IndexedDB браузера: перезагрузите страницу с неотправленным
// снимком — он останется на месте.
installSender(async (item) => {
  await wait(1500);
  await api.jobs.addPhoto(item.jobId, {
    id: item.id,
    category: photoCategory(item.slot),
    url: URL.createObjectURL(item.blob),
    path: `demo/${item.id}.jpg`,
    size: item.size,
    uploaded_at: item.created_at,
  });
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Intake profile={{ name: 'Петров С. (демо)' }} />
  </StrictMode>,
);
