import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { normalizeBotSettings, defaultBotSettings, tgIdError } from '../botSettings';
import BotAdminView from './BotAdminView';

// Контейнер экрана «Телеграм-бот»: держит связь с базой, а как это выглядит —
// в BotAdminView. Настройки лежат в settings/bot, бот их слушает и подхватывает
// правки на лету. Сохраняем сразу при изменении: отдельной кнопки нет.

const EMPTY_FORM = { tg_id: '', name: '', roles: ['staff'] };

export default function BotAdmin() {
  const [settings, setSettings] = useState(defaultBotSettings);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(0);
  const [commands, setCommands] = useState({});
  const [now, setNow] = useState(() => Date.now());
  // Бот при первом запуске переносит в базу список людей из своего файла настроек
  // на сервере и ставит метку. Пока метки нет — он ещё не обновился, и список
  // здесь может быть неполным: об этом честно предупреждаем.
  const [seeded, setSeeded] = useState(true);

  // Пока человек печатает (или его правка ещё летит в базу), не перетираем
  // экран тем, что вернулось из базы — иначе курсор прыгал бы в поле имени.
  const editingUntil = useRef(0);
  const saveTimer = useRef(null);
  const pendingSave = useRef(null);
  const watchers = useRef([]);

  useEffect(() => {
    const offSettings = api.bot.subscribe(
      (raw) => {
        setLoading(false);
        setSeeded(!!(raw && raw.seeded_from_env_at));
        if (Date.now() < editingUntil.current) return;
        setSettings(normalizeBotSettings(raw));
      },
      (e) => { setLoading(false); setError(`Не удалось прочитать настройки бота: ${e.message}`); },
    );
    // Вместе с новой отметкой обновляем и часы, иначе «сколько прошло» считалось
    // бы от предыдущего тика (до 10 секунд расхождения).
    const offStatus = api.bot.subscribeStatus((s) => { setStatus(s); setNow(Date.now()); }, () => {});
    return () => { offSettings(); offStatus(); };
  }, []);

  // Часы для «на связи / молчит N минут» и для отсчёта ответа на задание.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    watchers.current.forEach((off) => { try { off(); } catch { /* уже отписались */ } });
  }, []);

  // Записываем в базу. Тумблеры — сразу, набор текста — с паузой, чтобы не
  // писать в базу на каждую букву.
  function persist(next, delay = 0) {
    setSettings(next);
    editingUntil.current = Date.now() + delay + 1500;
    pendingSave.current = next;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload = pendingSave.current;
      if (!payload) return;
      try {
        await api.bot.save({ people: payload.people, schedules: payload.schedules, pushes: payload.pushes });
        setSavedAt(Date.now());
        setError('');
        setTimeout(() => setSavedAt(0), 2500);
      } catch (e) {
        setError(`Не удалось сохранить: ${e.message}`);
      }
    }, delay);
  }

  const patchPerson = (tgId, patch) => {
    const isText = Object.prototype.hasOwnProperty.call(patch, 'name');
    persist({
      ...settings,
      people: settings.people.map((p) => (p.tg_id === tgId ? { ...p, ...patch } : p)),
    }, isText ? 700 : 0);
  };

  function addPerson() {
    const tgId = form.tg_id.trim();
    const problem = tgIdError(tgId);
    if (problem) { setError(problem); return; }
    if (settings.people.some((p) => p.tg_id === tgId)) {
      setError('Этот Telegram ID уже есть в списке.');
      return;
    }
    if (!form.roles.length) { setError('Выберите хотя бы одну роль — иначе человек ничего не получит.'); return; }
    setError('');
    persist({
      ...settings,
      people: [...settings.people, { tg_id: tgId, name: form.name.trim(), roles: form.roles, active: true }],
    });
    setForm(EMPTY_FORM);
  }

  function removePerson(tgId) {
    const p = settings.people.find((x) => x.tg_id === tgId);
    if (!confirm(`Убрать ${p?.name || `ID ${tgId}`} из бота? Он перестанет получать сообщения и пользоваться ботом.`)) return;
    persist({
      ...settings,
      people: settings.people.filter((x) => x.tg_id !== tgId),
      // Заодно вычищаем его из персонального списка рассылки, чтобы не остался «призрак».
      schedules: {
        ...settings.schedules,
        mailDigest: { ...settings.schedules.mailDigest, to: (settings.schedules.mailDigest.to || []).filter((x) => x !== tgId) },
      },
    });
  }

  const patchSchedule = (id, patch) => persist({
    ...settings,
    schedules: { ...settings.schedules, [id]: { ...settings.schedules[id], ...patch } },
  });

  const patchPush = (id, value) => persist({
    ...settings,
    pushes: { ...settings.pushes, [id]: value },
  });

  // Задание боту: «проверить связь» или «отправить рассылку сейчас». Сайт кладёт
  // задание в базу, бот выполняет и дописывает результат туда же.
  async function runCommand(key, type, to) {
    setCommands((c) => ({ ...c, [key]: { status: 'pending', created_at: Date.now() } }));
    setNow(Date.now());
    try {
      const id = await api.bot.command(type, to);
      const off = api.bot.watchCommand(id, (cmd) => {
        if (!cmd) return;
        setCommands((c) => ({ ...c, [key]: cmd }));
        if (cmd.status === 'done' || cmd.status === 'error') {
          try { off(); } catch { /* уже отписались */ }
          setTimeout(() => setCommands((c) => {
            const next = { ...c };
            delete next[key];
            return next;
          }), 25000);
        }
      }, () => {});
      watchers.current.push(off);
    } catch (e) {
      setCommands((c) => ({ ...c, [key]: { status: 'error', result: e.message } }));
    }
  }

  if (loading) {
    return (
      <div className="panel">
        <h3>Телеграм-бот</h3>
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      </div>
    );
  }

  return (
    <BotAdminView
      settings={settings}
      people={settings.people}
      status={status}
      seeded={seeded}
      now={now}
      form={form}
      error={error}
      savedAt={savedAt}
      commands={commands}
      onForm={(patch) => { setForm((f) => ({ ...f, ...patch })); if (error) setError(''); }}
      onAddPerson={addPerson}
      onPatchPerson={patchPerson}
      onRemovePerson={removePerson}
      onPatchSchedule={patchSchedule}
      onPatchPush={patchPush}
      onCommand={runCommand}
    />
  );
}
