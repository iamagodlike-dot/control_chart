// Настройки телеграм-бота — общая форма данных и вся «думающая» логика экрана
// «Настройки → Телеграм-бот». Здесь нет ни React, ни Firestore, поэтому логику
// можно прогнать тестами (botSettings.test.js).
//
// ВАЖНО: та же форма продублирована в боте — telegram-bot/botConfig.js. Бот
// читает документ settings/bot и подхватывает изменения на лету. Меняя поля
// здесь, синхронизируйте оба файла (как с costing.js и money.js).

// ─── Роли в боте ─────────────────────────────────────────────────────────────
// Это НЕ роли доступа на сайте (owner/master/…): человек может получать
// сообщения в Telegram, вообще не имея входа в систему. Один человек может
// совмещать роли — например, управляющий и учредитель сразу.
export const BOT_ROLES = {
  manager: {
    label: 'Управляющий',
    hint: 'Всё: финансы, сводки, документы по машине, разбор почты',
  },
  founder: {
    label: 'Учредитель',
    hint: 'Состояние ремонтов по утрам и счета поставщиков к оплате',
  },
  partsman: {
    label: 'Запчастист',
    hint: 'Что нужно заказать и когда счёт оплачен; видит закупочные цены',
  },
  staff: {
    label: 'Сотрудник',
    hint: 'Машины, статусы, запчасти и фото — без денег',
  },
};
export const BOT_ROLE_ORDER = ['manager', 'founder', 'partsman', 'staff'];

// ─── Рассылки по расписанию ──────────────────────────────────────────────────
export const SCHEDULES = [
  {
    id: 'summary',
    label: 'Сводка за день',
    to: 'Управляющим',
    role: 'manager',
    hint: 'Сколько машин в работе, что сделано, что горит.',
  },
  {
    id: 'reminder',
    label: 'Вечернее напоминание',
    to: 'Управляющим',
    role: 'manager',
    hint: 'Что выдаём завтра и что не успели сегодня. В спокойный день не приходит.',
  },
  {
    id: 'founderDigest',
    label: 'Состояние ремонтов',
    to: 'Учредителям',
    role: 'founder',
    hint: 'Новые авто за сутки, согласования со страховой, укомплектованность, счета к оплате.',
  },
  {
    id: 'mailDigest',
    label: 'Разбор почты',
    to: 'Управляющим',
    role: 'manager',
    hint: 'Письма страховых, сверенные с базой машин: кто ждёт ответа, что согласовано.',
    pickPeople: true, // у этой рассылки можно выбрать конкретных получателей
  },
];
export const SCHEDULE_IDS = SCHEDULES.map((s) => s.id);

// ─── Мгновенные уведомления ──────────────────────────────────────────────────
export const PUSHES = [
  { id: 'newCar', label: 'Новая машина в работе', to: 'Управляющим и сотрудникам' },
  { id: 'ready', label: 'Машина готова к выдаче', to: 'Управляющим и сотрудникам' },
  { id: 'payment', label: 'Поступила оплата по счёту', to: 'Управляющим' },
  { id: 'supplierInvoice', label: 'Новый счёт поставщика (файлом)', to: 'Учредителям' },
  { id: 'partsNeeded', label: 'Нужно заказать запчасти', to: 'Запчастистам' },
  { id: 'invoicePaid', label: 'Счёт оплачен — позиции в «Заказано»', to: 'Запчастистам' },
];
export const PUSH_IDS = PUSHES.map((p) => p.id);

// ─── Часовые пояса ───────────────────────────────────────────────────────────
// Короткий список российских поясов: полный перечень тут только запутает.
export const TIMEZONES = [
  { id: 'Asia/Krasnoyarsk', label: 'Красноярск' },
  { id: 'Europe/Moscow', label: 'Москва' },
  { id: 'Asia/Novosibirsk', label: 'Новосибирск' },
  { id: 'Asia/Yekaterinburg', label: 'Екатеринбург' },
  { id: 'Asia/Irkutsk', label: 'Иркутск' },
  { id: 'Asia/Vladivostok', label: 'Владивосток' },
];
export const tzLabel = (tz) => TIMEZONES.find((t) => t.id === tz)?.label || tz;

// Значения по умолчанию — то, как бот работает сегодня. Нужны, пока бот ещё не
// создал документ в базе: экран показывает реальную картину, а не пустоту.
export const DEFAULT_TZ = 'Asia/Krasnoyarsk';
export const defaultBotSettings = () => ({
  people: [],
  schedules: {
    summary: { enabled: true, time: '10:00', tz: DEFAULT_TZ },
    reminder: { enabled: true, time: '18:00', tz: DEFAULT_TZ },
    founderDigest: { enabled: true, time: '10:00', tz: DEFAULT_TZ },
    mailDigest: { enabled: true, time: '18:00', tz: DEFAULT_TZ, to: [] },
  },
  pushes: Object.fromEntries(PUSH_IDS.map((id) => [id, true])),
});

// ─── Разбор и проверка ───────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

export function parseTime(value) {
  const m = /^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/.exec(String(value ?? ''));
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

// Telegram ID — это всегда число (у людей — минимум 5–6 цифр). Так отсекаем
// попытку вписать «@ник»: по нику бот написать первым не может.
export const isValidTgId = (value) => /^\d{4,}$/.test(String(value ?? '').trim());

export function tgIdError(value) {
  const v = String(value ?? '').trim();
  if (!v) return 'Введите Telegram ID — это номер, а не имя пользователя.';
  if (v.startsWith('@')) return 'Нужен числовой ID, а не @ник: по нику бот написать первым не может. Попросите человека отправить боту /whoami — он пришлёт номер.';
  if (!/^\d+$/.test(v)) return 'Telegram ID состоит только из цифр.';
  if (v.length < 4) return 'Слишком короткий номер — проверьте ID.';
  return '';
}

function cleanPerson(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tgId = String(raw.tg_id ?? '').trim();
  if (!isValidTgId(tgId)) return null;
  const roles = Array.isArray(raw.roles) ? raw.roles.filter((r) => BOT_ROLE_ORDER.includes(r)) : [];
  return {
    tg_id: tgId,
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    roles: [...new Set(roles)],
    active: raw.active !== false,
  };
}

// Приводим прочитанное из базы к рабочему виду. Отсутствующие поля берём из
// умолчаний, испорченные — тоже. Пустой список людей — это осознанный выбор
// владельца, а не «данных нет», поэтому его уважаем.
export function normalizeBotSettings(raw) {
  const d = defaultBotSettings();
  const src = raw && typeof raw === 'object' ? raw : {};

  const people = Array.isArray(src.people) ? src.people.map(cleanPerson).filter(Boolean) : d.people;

  const schedules = {};
  for (const id of SCHEDULE_IDS) {
    const def = d.schedules[id];
    const s = (src.schedules && typeof src.schedules === 'object' && src.schedules[id]) || {};
    const t = parseTime(s.time) || parseTime(def.time);
    schedules[id] = {
      enabled: s.enabled !== false,
      time: `${pad(t.hour)}:${pad(t.minute)}`,
      tz: typeof s.tz === 'string' && s.tz ? s.tz : def.tz,
    };
    if (id === 'mailDigest') {
      schedules[id].to = Array.isArray(s.to) ? s.to.map((v) => String(v).trim()).filter(isValidTgId) : def.to;
    }
  }

  const pushes = {};
  for (const id of PUSH_IDS) {
    const v = src.pushes && typeof src.pushes === 'object' ? src.pushes[id] : undefined;
    pushes[id] = v === undefined ? true : v !== false;
  }

  return { people, schedules, pushes };
}

// ─── Люди ────────────────────────────────────────────────────────────────────
export const activePeople = (people) => (people || []).filter((p) => p.active !== false);
export const peopleWithRole = (people, role) => activePeople(people).filter((p) => p.roles.includes(role));
export const personLabel = (p) => (p && p.name ? p.name : `ID ${p?.tg_id || '—'}`);

// Сколько человек получает каждую роль — для подписей вида «Управляющие · 2».
export function roleCounts(people) {
  const counts = {};
  for (const role of BOT_ROLE_ORDER) counts[role] = peopleWithRole(people, role).length;
  return counts;
}

// Кто реально получит эту рассылку. Обычно — все с нужной ролью; у разбора почты
// можно выбрать конкретных людей (пусто = снова все управляющие).
export function recipientsOf(settings, scheduleId) {
  const meta = SCHEDULES.find((s) => s.id === scheduleId);
  if (!meta) return [];
  const byRole = peopleWithRole(settings.people, meta.role);
  const picked = settings.schedules[scheduleId]?.to;
  if (meta.pickPeople && Array.isArray(picked) && picked.length) {
    return byRole.filter((p) => picked.includes(p.tg_id));
  }
  return byRole;
}

// ─── Время ───────────────────────────────────────────────────────────────────
// Смещение пояса относительно UTC в минутах — считаем через системные данные,
// чтобы не держать таблицу поясов и не ошибиться.
export function tzOffsetMinutes(tz, atMs = Date.now()) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = Object.fromEntries(dtf.formatToParts(new Date(atMs)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUtc - Math.floor(atMs / 1000) * 1000) / 60000);
  } catch {
    return null;
  }
}

// «10:00 по Красноярску» → «06:00» по Москве. Подсказка рядом с полем времени:
// половина путаницы в рассылках была именно из-за поясов.
export function timeInMoscow(time, tz, atMs = Date.now()) {
  const t = parseTime(time);
  const from = tzOffsetMinutes(tz, atMs);
  const msk = tzOffsetMinutes('Europe/Moscow', atMs);
  if (!t || from == null || msk == null) return '';
  const total = ((t.hour * 60 + t.minute - from + msk) % 1440 + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

// ─── Состояние бота ──────────────────────────────────────────────────────────
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function agoText(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
}

// Бот отмечается в базе раз в несколько минут. Если отметки давно нет — он не
// работает (упал, сервер выключен или ещё не обновлён до новой версии).
export function botStatusInfo(status, nowMs = Date.now()) {
  if (!status || !status.online_at) {
    return {
      state: 'unknown',
      text: 'Бот пока не отмечался',
      detail: 'Скорее всего, на сервере ещё старая версия бота. Настройки ниже можно задать уже сейчас — он подхватит их, когда обновится.',
    };
  }
  const age = nowMs - status.online_at;
  const beat = Number(status.heartbeat_ms) || 5 * 60 * 1000;
  if (age <= beat * 2.5) {
    return {
      state: 'online',
      text: 'Бот на связи',
      detail: status.username ? `@${status.username}` : '',
    };
  }
  return {
    state: 'offline',
    text: 'Бот не отвечает',
    detail: `Последний раз выходил на связь ${agoText(age)}. Проверьте, работает ли он на сервере.`,
  };
}

// Понятный статус задания, которое сайт отправил боту («проверить связь»,
// «отправить сейчас»). Бот отвечает, дописывая результат в тот же документ.
export function commandStatusText(cmd, nowMs = Date.now()) {
  if (!cmd) return '';
  if (cmd.status === 'done') return cmd.result || 'Готово';
  if (cmd.status === 'error') return `Не получилось: ${cmd.result || 'неизвестная ошибка'}`;
  const waiting = nowMs - (cmd.created_at || nowMs);
  if (waiting > 30000) return 'Бот не ответил — похоже, он сейчас не работает.';
  return 'Отправляю…';
}

// Каким цветом показать ответ. Смотрим именно на ТЕКСТ: задание «выполнено»
// и когда сообщение никому не дошло — бот честно отчитался, но зелёным это
// красить нельзя.
export function commandTone(cmd, nowMs = Date.now()) {
  if (!cmd) return 'wait';
  if (cmd.status === 'error') return 'bad';
  if (cmd.status === 'done') {
    const r = String(cmd.result || '');
    if (/^не доставлено/i.test(r)) return 'bad';
    if (/не дошло/i.test(r)) return 'warn';
    if (/^доставлено/i.test(r)) return 'ok';
    return 'warn'; // «некому отправлять», «напоминать не о чем», «почта не настроена»
  }
  return nowMs - (cmd.created_at || nowMs) > 30000 ? 'bad' : 'wait';
}
