'use strict';
const env = require('./config');
const { db, isReady } = require('./firebase');

// ─── Живые настройки бота ────────────────────────────────────────────────────
// Раньше «кто получает сообщения» и «во сколько приходят рассылки» лежали только
// в файле .env на сервере: поменять — значит зайти по SSH и перезапустить бота.
// Теперь эти же настройки живут в базе (документ settings/bot) и правятся на
// сайте в «Настройки → Телеграм-бот». Бот слушает документ и подхватывает
// изменения на лету — перезапуск не нужен.
//
// Совместимость: модуль отдаёт РОВНО ТЕ ЖЕ поля, что и config.js (managers,
// isManager, summary.cron и т.д.), поэтому остальной код менять почти не пришлось —
// достаточно требовать botConfig вместо config. Значения из .env остаются
// «страховкой»: пока документа в базе нет (или база не подключена), бот работает
// ровно как раньше.
//
// ВАЖНО: форма документа продублирована на сайте в client/src/botSettings.js —
// при изменении полей синхронизировать оба файла (как с costing.js и money.js).

const ROLES = ['manager', 'founder', 'partsman', 'receptionist', 'staff'];
const PUSH_IDS = ['newCar', 'ready', 'payment', 'supplierInvoice', 'partsNeeded', 'invoicePaid'];
const SCHEDULE_IDS = ['summary', 'reminder', 'founderDigest', 'mailDigest', 'intakeDigest'];

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (h, m) => `${pad(h)}:${pad(m)}`;

// Часовой пояс годится, только если его понимает система: кривая строка уронила
// бы node-cron при постановке задачи, а вместе с ним и все рассылки.
function validTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// «9:5» → {hour:9, minute:5}; мусор → null (возьмём значение по умолчанию).
function parseTime(value) {
  const m = /^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/.exec(String(value || ''));
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

// Значения по умолчанию — из .env, т.е. ровно то, как бот работает сегодня.
// Ими же документ засевается при самом первом запуске (см. start()).
function envDefaults() {
  const people = new Map();
  const add = (id, role) => {
    const key = String(id || '').trim();
    if (!key) return;
    if (!people.has(key)) people.set(key, { tg_id: key, name: '', roles: [], active: true });
    const p = people.get(key);
    if (!p.roles.includes(role)) p.roles.push(role);
  };
  // Один и тот же человек может быть в нескольких списках (например, управляющий
  // и учредитель сразу) — поэтому роли складываем, а не перетираем.
  env.managers.forEach((id) => add(id, 'manager'));
  env.founders.forEach((id) => add(id, 'founder'));
  env.partsmen.forEach((id) => add(id, 'partsman'));
  env.receptionists.forEach((id) => add(id, 'receptionist'));
  env.staff.forEach((id) => add(id, 'staff'));

  const sched = (src, extra) => ({ enabled: true, time: hhmm(src.hour, src.minute), tz: src.tz, ...extra });
  return {
    people: [...people.values()],
    schedules: {
      summary: sched(env.summary),
      reminder: sched(env.reminder),
      founderDigest: sched(env.founderDigest),
      mailDigest: sched(env.mailDigest, { to: env.mailDigestTo.slice() }),
      intakeDigest: sched(env.intakeDigest),
    },
    pushes: Object.fromEntries(PUSH_IDS.map((k) => [k, true])),
  };
}

function cleanPerson(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tgId = String(raw.tg_id || '').trim();
  if (!/^\d{4,}$/.test(tgId)) return null; // Telegram ID — только цифры
  const roles = Array.isArray(raw.roles) ? raw.roles.filter((r) => ROLES.includes(r)) : [];
  return {
    tg_id: tgId,
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    roles: [...new Set(roles)],
    active: raw.active !== false,
  };
}

// Приводим то, что прочитали из базы, к рабочему виду: чего нет или что испорчено —
// берём из .env. Пустой массив людей — это осознанный выбор владельца, а не «нет
// данных», поэтому уважаем его (проверяем именно Array.isArray, а не длину).
function normalize(raw, base) {
  const d = base || envDefaults();
  const src = raw && typeof raw === 'object' ? raw : {};

  const people = Array.isArray(src.people)
    ? src.people.map(cleanPerson).filter(Boolean)
    : d.people;

  const schedules = {};
  for (const id of SCHEDULE_IDS) {
    const def = d.schedules[id];
    const s = (src.schedules && typeof src.schedules === 'object' && src.schedules[id]) || {};
    const t = parseTime(s.time) || parseTime(def.time) || { hour: 10, minute: 0 };
    const tz = validTz(s.tz) ? s.tz : def.tz;
    schedules[id] = {
      enabled: s.enabled !== false,
      time: hhmm(t.hour, t.minute),
      hour: t.hour,
      minute: t.minute,
      tz,
      cron: `${t.minute} ${t.hour} * * *`,
    };
    if (id === 'mailDigest') {
      schedules[id].to = Array.isArray(s.to)
        ? s.to.map((v) => String(v).trim()).filter((v) => /^\d{4,}$/.test(v))
        : def.to || [];
    }
  }

  const pushes = {};
  for (const id of PUSH_IDS) {
    const v = src.pushes && typeof src.pushes === 'object' ? src.pushes[id] : undefined;
    pushes[id] = v === undefined ? d.pushes[id] : v !== false;
  }

  return { people, schedules, pushes };
}

// ─── Текущее состояние ───────────────────────────────────────────────────────
// Через normalize, а не «сырой» envDefaults: расписанию нужны разобранные hour/
// minute/cron, иначе до первого чтения из базы (или когда база недоступна вовсе)
// в cron ушло бы undefined и рассылки не встали бы.
let current = normalize(null);
const changeHandlers = [];

const activePeople = () => current.people.filter((p) => p.active !== false);
const idsWithRole = (role) => activePeople().filter((p) => p.roles.includes(role)).map((p) => p.tg_id);
const hasRole = (id, role) => {
  const key = String(id);
  return activePeople().some((p) => p.tg_id === key && p.roles.includes(role));
};

function ref() {
  return db.collection('settings').doc('bot');
}

// Запускаем слежение за настройками. Если документа ещё нет — создаём его из
// .env, чтобы на сайте сразу было что показать и править (а не пустой экран).
async function start() {
  if (!isReady()) {
    console.log('⚙️  Настройки бота: база не подключена — работаю по .env.');
    return;
  }
  try {
    const snap = await ref().get();
    if (!snap.exists) {
      const seed = envDefaults();
      await ref().set({
        ...seed,
        seeded_from_env_at: Date.now(),
        updated_at: Date.now(),
        updated_by: 'бот (первый запуск)',
      });
      console.log('⚙️  Настройки бота созданы в базе из .env — дальше их можно менять на сайте.');
    } else if (!snap.data().seeded_from_env_at) {
      // Документ уже есть, но метки нет — значит, его создал САЙТ раньше, чем
      // обновился бот, и про людей из .env он не знал. Дописываем их один раз,
      // иначе пустой список на сайте молча отключил бы всем уведомления.
      const data = snap.data() || {};
      const existing = Array.isArray(data.people) ? data.people : [];
      const known = new Set(existing.map((p) => String((p && p.tg_id) || '')));
      const people = [...existing, ...envDefaults().people.filter((p) => !known.has(p.tg_id))];
      await ref().set({ people, seeded_from_env_at: Date.now() }, { merge: true });
      current = normalize({ ...data, people });
      console.log(`⚙️  Настройки бота нашлись в базе без списка из .env — добавил ${people.length - existing.length} чел.`);
    } else {
      current = normalize(snap.data());
    }
  } catch (e) {
    console.error('Настройки бота (первое чтение):', e.message, '— работаю по .env.');
    return;
  }

  ref().onSnapshot(
    (snap) => {
      if (!snap.exists) return; // документ удалили — держим последнее известное
      const prev = current;
      current = normalize(snap.data());
      for (const fn of changeHandlers) {
        try {
          fn(current, prev);
        } catch (e) {
          console.error('Настройки бота (обработчик изменения):', e.message);
        }
      }
    },
    (e) => console.error('Настройки бота (слежение):', e.message),
  );
}

const onChange = (fn) => changeHandlers.push(fn);

module.exports = {
  // Из .env — то, что на сайте не настраивается (секреты и пути).
  botToken: env.botToken,
  projectId: env.projectId,
  serviceAccountPath: env.serviceAccountPath,
  photosBaseUrl: env.photosBaseUrl,

  start,
  onChange,
  // Тумблер мгновенного уведомления: выключенное просто не отправляется.
  push: (id) => current.pushes[id] !== false,
  settings: () => current,
  ROLES,
  PUSH_IDS,
  SCHEDULE_IDS,
  normalize,
  envDefaults,

  isAllowed: (id) => activePeople().some((p) => p.tg_id === String(id)),
  isManager: (id) => hasRole(id, 'manager'),
  isFounder: (id) => hasRole(id, 'founder'),
  isPartsman: (id) => hasRole(id, 'partsman'),
  isReceptionist: (id) => hasRole(id, 'receptionist'),
  // Кому в разделе «Запчасти» показывать поставщика и цену закупки: управляющему
  // и запчастисту. Продажную цену и прибыль это НЕ открывает.
  canSeeSupply: (id) => hasRole(id, 'manager') || hasRole(id, 'partsman'),
  hasWhitelist: () => activePeople().length > 0,
};

// Списки и расписания — через геттеры, чтобы уже написанный код вида
// `config.managers` всегда видел свежее значение, а не снимок на момент запуска.
for (const [prop, get] of [
  ['people', () => current.people],
  ['managers', () => idsWithRole('manager')],
  ['founders', () => idsWithRole('founder')],
  ['partsmen', () => idsWithRole('partsman')],
  ['receptionists', () => idsWithRole('receptionist')],
  ['staff', () => idsWithRole('staff')],
  ['mailDigestTo', () => current.schedules.mailDigest.to || []],
  ['summary', () => current.schedules.summary],
  ['reminder', () => current.schedules.reminder],
  ['founderDigest', () => current.schedules.founderDigest],
  ['mailDigest', () => current.schedules.mailDigest],
  ['intakeDigest', () => current.schedules.intakeDigest],
]) {
  Object.defineProperty(module.exports, prop, { get, enumerable: true });
}
