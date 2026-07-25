/* eslint-disable react-refresh/only-export-components */
// Превью экрана «Настройки → Телеграм-бот» БЕЗ входа и без Firebase: настоящий
// компонент BotAdmin работает поверх выдуманной базы в памяти. Заодно тут живёт
// фальшивый «бот»: он отмечается как живой и отвечает на задания — видно, как
// выглядит и удачная отправка, и ошибка.
//   npm run dev → http://localhost:5174/bot-demo.html
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../api';
import PostsMasters from '../components/PostsMasters';
import '../App.css';

document.documentElement.dataset.theme = 'dark';
// Открываем сразу нужный раздел настоящего экрана настроек (с боковым меню).
localStorage.setItem('aa-settings-section', 'bot');

// Остальные разделы настроек демо не показывает — отдаём им пустые списки.
for (const name of ['posts', 'masters', 'insurers', 'suppliers']) {
  api[name].list = async () => [];
  api[name].ensureSeeded = async () => {};
}

let settings = {
  // Метка «бот уже перенёс сюда свой список» — без неё экран честно предупредит,
  // что на сервере ещё старая версия (кнопка «бот не обновлён» ниже).
  seeded_from_env_at: Date.now() - 86_400_000,
  people: [
    { tg_id: '103056371', name: 'Роман (владелец)', roles: ['manager', 'founder'], active: true },
    { tg_id: '503441392', name: 'Инвестор', roles: ['founder'], active: true },
    { tg_id: '835906867', name: 'Евгений', roles: ['partsman'], active: true },
    { tg_id: '777000111', name: 'Уволенный мастер', roles: ['staff'], active: false },
  ],
  schedules: {
    summary: { enabled: true, time: '10:00', tz: 'Asia/Krasnoyarsk' },
    reminder: { enabled: true, time: '18:00', tz: 'Asia/Krasnoyarsk' },
    founderDigest: { enabled: true, time: '10:00', tz: 'Asia/Krasnoyarsk' },
    mailDigest: { enabled: true, time: '18:00', tz: 'Asia/Krasnoyarsk', to: [] },
  },
  pushes: {
    newCar: true, ready: true, payment: true,
    supplierInvoice: true, partsNeeded: true, invoicePaid: false,
  },
};

const settingsSubs = new Set();
const statusSubs = new Set();
const emitSettings = () => settingsSubs.forEach((fn) => fn({ ...settings }));

// «Бот» отметился только что — экран должен показать зелёный «на связи».
let status = { online_at: Date.now(), started_at: Date.now() - 3600_000, username: 'autoacademyparser_bot', heartbeat_ms: 300_000 };

const commands = new Map();
const cmdSubs = new Map();
let cmdId = 0;

api.bot.subscribe = (onData) => {
  settingsSubs.add(onData);
  onData({ ...settings });
  return () => settingsSubs.delete(onData);
};
api.bot.save = async (data) => {
  settings = { ...settings, ...data };
  setTimeout(emitSettings, 50); // как в базе — ответ приходит эхом
};
api.bot.subscribeStatus = (onData) => {
  statusSubs.add(onData);
  onData(status);
  return () => statusSubs.delete(onData);
};
api.bot.command = async (type, to) => {
  const id = `c${++cmdId}`;
  const cmd = { id, type, to, status: 'pending', created_at: Date.now() };
  commands.set(id, cmd);
  // Фальшивый бот думает секунду и отвечает. На «Уволенного» — ошибка, чтобы
  // было видно, как выглядит недоставленное сообщение.
  setTimeout(() => {
    const broken = Array.isArray(to) && to.includes('777000111');
    const done = broken
      ? { ...cmd, status: 'done', result: 'Не доставлено: 777000111 — не найден чат: человек ещё ни разу не открывал бота' }
      : { ...cmd, status: 'done', result: `Доставлено: ${to ? to.length : 2}` };
    commands.set(id, done);
    (cmdSubs.get(id) || []).forEach((fn) => fn(done));
  }, 1200);
  return id;
};
api.bot.watchCommand = (id, onData) => {
  const list = cmdSubs.get(id) || [];
  list.push(onData);
  cmdSubs.set(id, list);
  onData(commands.get(id));
  return () => cmdSubs.set(id, (cmdSubs.get(id) || []).filter((f) => f !== onData));
};

// Кнопки-переключатели состояния бота — чтобы посмотреть все три вида полосы.
function StateSwitcher() {
  const set = (next) => { status = next; statusSubs.forEach((fn) => fn(status)); };
  return (
    <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="panel-hint" style={{ margin: 0 }}>Демо: состояние бота —</span>
      <button onClick={() => set({ online_at: Date.now(), username: 'autoacademyparser_bot', heartbeat_ms: 300_000 })}>на связи</button>
      <button onClick={() => set({ online_at: Date.now() - 3 * 3600_000, username: 'autoacademyparser_bot', heartbeat_ms: 300_000 })}>молчит 3 часа</button>
      <button onClick={() => set(null)}>ни разу не отмечался</button>
      <button onClick={() => { settings = { ...settings, seeded_from_env_at: undefined }; emitSettings(); }}>бот не обновлён</button>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="app">
      <main className="app-main">
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 24px 0' }}><StateSwitcher /></div>
        <PostsMasters />
      </main>
    </div>
  </StrictMode>,
);
