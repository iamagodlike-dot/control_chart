'use strict';
const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
// Настройки бота (кто получает сообщения, во сколько приходят рассылки, какие
// уведомления включены) живут в базе и правятся на сайте — см. botConfig.js.
// Значения из .env остаются страховкой на случай, если база недоступна.
const config = require('./botConfig');
const { isReady, reason } = require('./firebase');
const views = require('./views');
const { startNotifier } = require('./notify');
const { buildDigestText } = require('./mailDigest');
const { intakeDigest } = require('./intake');
const { isConfigured: mailConfigured } = require('./mail');
const { startControl, explainSendError } = require('./control');

if (!config.botToken) {
  console.error('❌ Не задан BOT_TOKEN в файле .env');
  process.exit(1);
}

const bot = new Telegraf(config.botToken);

// ─── Кнопки меню ───
const BTN = {
  find: 'Найти авто',
  cars: 'Машины в работе',
  masters: 'Загрузка мастеров',
  upcoming: 'Скоро выдача',
  debts: 'Долги',
  revenue: 'Выручка',
  analytics: 'Аналитика',
  summary: 'Сводка за день',
  invoices: 'Счета к оплате',
  digest: 'Состояние ремонтов',
  approvals: 'Согласования',
  mail: 'Почта',
  intake: 'Дефектовка',
};

function menuFor(isManager, isFounder, isReceptionist) {
  // Учредителю (если он не управляющий) — узкое меню: его сводка и разделы из неё.
  if (isFounder && !isManager) {
    return Markup.keyboard([[BTN.digest], [BTN.approvals, BTN.invoices]]).resize();
  }
  const rows = [[BTN.find], [BTN.cars, BTN.masters], [BTN.upcoming]];
  // У приёмщика «Дефектовка» — главная кнопка дня, поэтому наверх.
  if (isReceptionist && !isManager) rows.unshift([BTN.intake]);
  if (isManager) {
    rows.push([BTN.debts, BTN.revenue]);
    rows.push([BTN.analytics, BTN.summary]);
    rows.push([BTN.digest, BTN.approvals]);
    rows.push([BTN.invoices, BTN.mail]); // счета к оплате + разбор почты за день
    rows.push([BTN.intake]);
  }
  return Markup.keyboard(rows).resize();
}

// Кнопки выбора периода для «Выручки».
const periodKb = Markup.inlineKeyboard([
  [Markup.button.callback('Сегодня', 'rev:today'), Markup.button.callback('Неделя', 'rev:week')],
  [Markup.button.callback('Месяц', 'rev:month'), Markup.button.callback('Год', 'rev:year')],
]);

async function send(ctx, text, isManager) {
  const id = ctx.from?.id;
  return ctx.reply(text, {
    parse_mode: 'HTML',
    ...menuFor(isManager, config.isFounder(id), config.isReceptionist(id)),
  });
}

// Аккуратно выполняем запрос к данным и не роняем бота на ошибке.
async function safe(ctx, fn) {
  const isManager = config.isManager(ctx.from.id);
  try {
    const text = await fn();
    await send(ctx, text, isManager);
  } catch (e) {
    if (!isReady()) {
      await send(ctx, '⚙️ База ещё не подключена — идёт настройка. Загляните чуть позже.', isManager);
    } else {
      console.error('Ошибка запроса:', e);
      await send(ctx, '⚠️ Не удалось получить данные. Попробуйте ещё раз.', isManager);
    }
  }
}

// ─── Доступ ───
bot.use((ctx, next) => {
  ctx.state.uid = String(ctx.from?.id || '');
  ctx.state.allowed = config.isAllowed(ctx.state.uid);
  ctx.state.manager = config.isManager(ctx.state.uid);
  return next();
});

function denyMessage(uid) {
  return (
    'Похоже, у вас пока нет доступа к боту.\n\n' +
    `Ваш Telegram ID: <code>${uid}</code>\n\n` +
    'Передайте этот номер администратору — он добавит вас в список.'
  );
}

// ─── /start и /whoami — доступны всем (чтобы узнать свой ID) ───
bot.start(async (ctx) => {
  const { uid, allowed, manager } = ctx.state;
  if (!allowed) {
    return ctx.reply(denyMessage(uid), { parse_mode: 'HTML' });
  }
  await send(
    ctx,
    [
      '<b>Авто Академия</b>',
      'Показываю машины, статусы, запчасти, фото и финансы прямо в Telegram.',
      '',
      '• Нажмите «Найти авто» или просто введите госномер, имя клиента или № заказа.',
      '• Все команды — в меню ☰ у поля ввода.',
    ].join('\n'),
    manager,
  );
});

bot.command('whoami', (ctx) => {
  ctx.reply(`Ваш Telegram ID: <code>${ctx.state.uid}</code>`, { parse_mode: 'HTML' });
});

// ─── Кнопки (только для своих) ───
function guard(handler) {
  return async (ctx) => {
    if (!ctx.state.allowed) return ctx.reply(denyMessage(ctx.state.uid), { parse_mode: 'HTML' });
    return handler(ctx);
  };
}

const HELP_TEXT = [
  '<b>Что я умею</b>',
  '',
  '<b>Найти авто</b> — список машин кнопками или поиск: введите госномер, имя клиента или № заказа.',
  'В карточке машины: запчасти со статусами, фото «до/после», документы (управляющим).',
  '',
  '<b>Машины в работе</b> — кто на каком посту.',
  '<b>Загрузка мастеров</b> — у кого что в работе.',
  '<b>Скоро выдача</b> — что сдаём в ближайшие дни.',
  '',
  '<b>Состояние ремонтов</b> — новые авто за сутки, согласования со страховой, укомплектованность по запчастям и счета к оплате одним экраном. Приходит автоматически каждое утро; кнопки под ней разворачивают разделы.',
  '<b>Согласования</b> — что где стоит по страховой.',
  '<b>Счета к оплате</b> — неоплаченные счета поставщиков файлом с кнопкой «Оплачено».',
  '<b>Дефектовка</b> — кто приезжает сегодня, кому позвонить (дефектовка завтра), кто не приехал и кто ещё ждёт приглашения. Приходит мастеру-приёмщику утром.',
  '',
  '<i>Управляющим также:</i> Долги, Выручка, Аналитика, Сводка за день.',
  '',
  'Команды — в меню ☰ у поля ввода.',
].join('\n');

// ─── Действия меню (общие для кнопок-меню и одноимённых слэш-команд) ───
async function actFind(ctx) {
  try {
    const data = await views.carsBrowse(0);
    if (!data.total) return send(ctx, 'Введите госномер, имя клиента или № заказа:', ctx.state.manager);
    await ctx.reply(browseText(data), { parse_mode: 'HTML', ...browseKeyboard(data) });
  } catch (e) {
    if (!isReady()) return send(ctx, '⚙️ База ещё не подключена — идёт настройка.', ctx.state.manager);
    console.error('Список машин:', e);
    await send(ctx, '⚠️ Не удалось получить список. Введите госномер вручную:', ctx.state.manager);
  }
}
const actCars = (ctx) => safe(ctx, () => views.carsInWork());
const actMasters = (ctx) => safe(ctx, () => views.mastersLoad());
const actHelp = (ctx) => send(ctx, HELP_TEXT, ctx.state.manager);
async function actUpcoming(ctx) {
  try {
    await sendList(ctx, await views.upcoming());
  } catch (e) {
    if (!isReady()) return send(ctx, '⚙️ База ещё не подключена — идёт настройка.', ctx.state.manager);
    console.error('Скоро выдача:', e);
    await send(ctx, '⚠️ Не удалось получить данные. Попробуйте ещё раз.', ctx.state.manager);
  }
}
async function actSummary(ctx) {
  if (!ctx.state.manager) return send(ctx, 'Сводка доступна только управляющим.', false);
  return safe(ctx, () => views.dailySummary());
}
async function actDebts(ctx) {
  if (!ctx.state.manager) return send(ctx, 'Раздел доступен только управляющим.', false);
  try {
    await sendList(ctx, await views.debts());
  } catch (e) {
    if (!isReady()) return send(ctx, '⚙️ База ещё не подключена — идёт настройка.', ctx.state.manager);
    console.error('Долги:', e);
    await send(ctx, '⚠️ Не удалось получить данные. Попробуйте ещё раз.', ctx.state.manager);
  }
}
async function actRevenue(ctx) {
  if (!ctx.state.manager) return send(ctx, 'Раздел доступен только управляющим.', false);
  return ctx.reply('Выручка — выберите период:', { parse_mode: 'HTML', ...periodKb });
}
async function actAnalytics(ctx) {
  if (!ctx.state.manager) return send(ctx, 'Раздел доступен только управляющим.', false);
  return safe(ctx, () => views.analytics());
}
// Счета поставщиков к оплате — учредителю и управляющему. Шлём каждый счёт файлом
// с подписью и кнопкой «Оплачено» (см. invoices.sendInvoice). Общее тело для кнопки
// меню, команды /invoices и кнопки «Счета к оплате» под сводкой учредителя.
async function pushUnpaidInvoices(ctx) {
  if (!isReady()) return send(ctx, '⚙️ База ещё не подключена — загляните чуть позже.', ctx.state.manager);
  let list;
  try {
    list = await listUnpaidSupplierInvoices();
  } catch (e) {
    console.error('Счета к оплате:', e);
    return send(ctx, '⚠️ Не удалось получить счета.', ctx.state.manager);
  }
  if (!list.length) return send(ctx, '✅ Неоплаченных счетов нет.', ctx.state.manager);
  await send(ctx, `<b>Счета к оплате: ${list.length}</b>\nНиже — каждый счёт с файлом и кнопкой «Оплачено».`, ctx.state.manager);
  for (const inv of list) {
    // eslint-disable-next-line no-await-in-loop
    await sendInvoice(bot, ctx.chat.id, inv);
  }
  return undefined;
}

async function actInvoices(ctx) {
  if (!canPay(ctx.from.id)) return send(ctx, 'Раздел доступен учредителю и управляющему.', ctx.state.manager);
  return pushUnpaidInvoices(ctx);
}

// Сводка учредителя «Состояние ремонтов» по требованию (та же, что приходит утром).
async function actDigest(ctx) {
  if (!canSeeDigest(ctx.from.id)) return send(ctx, 'Раздел доступен учредителю и управляющему.', ctx.state.manager);
  try {
    const data = await views.founderDigest();
    await ctx.reply(data.text, { parse_mode: 'HTML', ...digestKeyboard(data) });
  } catch (e) {
    if (!isReady()) return send(ctx, '⚙️ База ещё не подключена — идёт настройка.', ctx.state.manager);
    console.error('Сводка учредителя:', e);
    await send(ctx, '⚠️ Не удалось собрать сводку. Попробуйте ещё раз.', ctx.state.manager);
  }
  return undefined;
}

// Разворот кнопки «Согласования» — доска согласований списком.
async function actApprovals(ctx) {
  if (!canSeeDigest(ctx.from.id)) return send(ctx, 'Раздел доступен учредителю и управляющему.', ctx.state.manager);
  try {
    await sendList(ctx, await views.approvals());
  } catch (e) {
    if (!isReady()) return send(ctx, '⚙️ База ещё не подключена — идёт настройка.', ctx.state.manager);
    console.error('Согласования:', e);
    await send(ctx, '⚠️ Не удалось получить данные. Попробуйте ещё раз.', ctx.state.manager);
  }
  return undefined;
}

// Разбор почты «итог дня» по требованию — только управляющим (та же сводка, что
// приходит вечером по расписанию).
async function actMail(ctx) {
  if (!ctx.state.manager) return send(ctx, 'Раздел доступен только управляющим.', false);
  if (!mailConfigured()) return send(ctx, 'Почта пока не настроена (нет MAIL_USER/MAIL_PASSWORD в .env бота).', ctx.state.manager);
  await ctx.reply('Собираю разбор почты… это займёт несколько секунд.');
  try {
    const text = await buildDigestText();
    await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e) {
    console.error('Почта (разбор):', e);
    await send(ctx, '⚠️ Не удалось собрать разбор почты. Попробуйте позже.', ctx.state.manager);
  }
  return undefined;
}

// Сводка «Дефектовка» по требованию — мастеру-приёмщику и управляющему. Ровно то
// же сообщение, что приходит утром по расписанию: кто приезжает сегодня, кому
// звонить, кто не приехал, кто ждёт приглашения.
async function actIntake(ctx) {
  if (!canSeeIntake(ctx.from.id)) return send(ctx, 'Раздел доступен мастеру-приёмщику и управляющему.', ctx.state.manager);
  return safe(ctx, async () => (
    await intakeDigest({ tz: config.intakeDigest.tz })
    || 'По дефектовке дел нет: все машины приглашены, никто не потерялся.'
  ));
}

// Кнопки нижнего меню + одноимённые слэш-команды (для меню ☰ у поля ввода).
// В hears указываем и СТАРЫЕ подписи с эмодзи — чтобы у тех, у кого нижнее меню
// ещё не обновилось, кнопки продолжали работать (после ответа меню обновится).
bot.hears([BTN.find, '🔎 Найти авто'], guard(actFind));            bot.command('find', guard(actFind));
bot.hears([BTN.cars, '🚗 Машины в работе'], guard(actCars));       bot.command('cars', guard(actCars));
bot.hears([BTN.masters, '👨‍🔧 Загрузка мастеров'], guard(actMasters)); bot.command('masters', guard(actMasters));
bot.hears([BTN.upcoming, '📅 Скоро выдача'], guard(actUpcoming));   bot.command('upcoming', guard(actUpcoming));
bot.hears([BTN.summary, '📊 Сводка за день'], guard(actSummary));   bot.command('summary', guard(actSummary));
bot.hears([BTN.debts, '💰 Долги'], guard(actDebts));               bot.command('debts', guard(actDebts));
bot.hears([BTN.revenue, '📈 Выручка'], guard(actRevenue));         bot.command('revenue', guard(actRevenue));
bot.hears([BTN.analytics, '🧭 Аналитика'], guard(actAnalytics));   bot.command('analytics', guard(actAnalytics));
bot.hears([BTN.invoices, '💳 Счета к оплате'], guard(actInvoices)); bot.command('invoices', guard(actInvoices));
bot.hears(BTN.digest, guard(actDigest));                           bot.command('digest', guard(actDigest));
bot.hears(BTN.approvals, guard(actApprovals));                     bot.command('approvals', guard(actApprovals));
bot.hears([BTN.mail, '📬 Почта'], guard(actMail));                 bot.command('mail', guard(actMail));
bot.hears(BTN.intake, guard(actIntake));                           bot.command('intake', guard(actIntake));
bot.command('help', guard(actHelp));

// ─── Развороты под сводкой учредителя ───
bot.action('fd:invoices', async (ctx) => {
  if (!canSeeDigest(ctx.from.id)) return ctx.answerCbQuery('Только учредителю или управляющему');
  await ctx.answerCbQuery();
  return pushUnpaidInvoices(ctx);
});

bot.action('fd:approvals', async (ctx) => {
  if (!canSeeDigest(ctx.from.id)) return ctx.answerCbQuery('Только учредителю или управляющему');
  await ctx.answerCbQuery();
  return actApprovals(ctx);
});

bot.action(/^rev:(today|week|month|year)$/, async (ctx) => {
  if (!config.isManager(ctx.from.id)) return ctx.answerCbQuery('Только управляющим');
  const period = ctx.match[1];
  try {
    const text = await views.revenue(period);
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...periodKb });
    await ctx.answerCbQuery();
  } catch (e) {
    const desc = (e && (e.description || e.message)) || '';
    if (/message is not modified/i.test(desc)) return ctx.answerCbQuery('Уже показано');
    if (!isReady()) return ctx.answerCbQuery('База ещё не подключена');
    console.error('Ошибка выручки:', e);
    return ctx.answerCbQuery('Ошибка, попробуйте ещё раз');
  }
});

// ─── Документы по машине (только управляющим) ───
// Присылаем ИМЕННО сохранённые в сервисе документы (заказ-наряд, счёт, акты),
// напечатанные в PDF теми же компонентами и стилями, что на сайте.
const docpdf = require('./docpdf');
const { getDocById, listUnpaidSupplierInvoices, getSupplierInvoiceById, markSupplierInvoicePaid } = require('./data');
const { sendInvoice } = require('./invoices');
const { money } = require('./format');

// ─── Оплата счёта поставщика (учредителю и управляющему) ───
// Тап «Оплачено» под счётом → подтверждение → отметка. markSupplierInvoicePaid
// идемпотентна и переводит позиции счёта в «Заказано» (см. data.js).
const canPay = (id) => config.isFounder(id) || config.isManager(id);
// Сводка учредителя и её развороты — учредителю и управляющему (тот и так видит
// всё то же самое по отдельным кнопкам).
const canSeeDigest = (id) => config.isFounder(id) || config.isManager(id);
// Сводка «Дефектовка» — мастеру-приёмщику (это его рабочий список) и управляющему.
const canSeeIntake = (id) => config.isReceptionist(id) || config.isManager(id);

bot.action(/^pay:(.+)$/, async (ctx) => {
  if (!canPay(ctx.from.id)) return ctx.answerCbQuery('Только учредителю или управляющему');
  const id = ctx.match[1];
  try {
    await ctx.answerCbQuery();
    const inv = await getSupplierInvoiceById(id);
    if (!inv) return ctx.reply('Счёт не найден.');
    if (inv.status === 'paid' || inv.paid_at) return ctx.reply('Этот счёт уже оплачен.');
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Да, оплачено', `paycfm:${id}`), Markup.button.callback('Отмена', 'paycancel')],
    ]);
    await ctx.reply(
      `Отметить счёт ${inv.number || ''}${inv.supplier ? ' (' + inv.supplier + ')' : ''} на <b>${money(inv.amount)}</b> как оплаченный?\nПозиции уйдут в «Заказано».`,
      { parse_mode: 'HTML', ...kb },
    );
  } catch (e) {
    console.error('Подтверждение оплаты:', e);
    await ctx.reply(isReady() ? '⚠️ Не удалось открыть счёт.' : '⚙️ База ещё не подключена.');
  }
});

bot.action('paycancel', async (ctx) => {
  try { await ctx.answerCbQuery('Отменено'); await ctx.editMessageText('Отменено.'); }
  catch { /* сообщение уже изменено — не страшно */ }
});

bot.action(/^paycfm:(.+)$/, async (ctx) => {
  if (!canPay(ctx.from.id)) return ctx.answerCbQuery('Только учредителю или управляющему');
  const id = ctx.match[1];
  const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'учредитель';
  try {
    await ctx.answerCbQuery('Отмечаю…');
    const { alreadyPaid, invoice } = await markSupplierInvoicePaid(id, name);
    const msg = alreadyPaid
      ? `Счёт ${invoice.number || ''} уже был оплачен.`
      : `✅ Счёт ${invoice.number || ''}${invoice.supplier ? ' (' + invoice.supplier + ')' : ''} оплачен. Позиции ушли в «Заказано».`;
    try { await ctx.editMessageText(msg); } catch { await ctx.reply(msg); }
  } catch (e) {
    console.error('Отметка оплаты:', e);
    await ctx.reply('⚠️ Не удалось отметить оплату. Попробуйте ещё раз.');
  }
});

// Кнопки под карточкой машины. Запчасти и фото — всем сотрудникам; документы —
// только управляющим (как и было).
function cardButtons(jobId, isManager) {
  const rows = [[
    Markup.button.callback('Запчасти', `parts:${jobId}`),
    Markup.button.callback('Фото', `photos:${jobId}`),
  ]];
  const last = [];
  if (isManager) last.push(Markup.button.callback('Документы', `docs:${jobId}`));
  last.push(Markup.button.callback('Обновить', `refresh:${jobId}`));
  rows.push(last);
  return Markup.inlineKeyboard(rows);
}

// Прислать карточку машины: есть фото — шлём фото с карточкой в подписи, нет —
// обычным текстом. Подпись к фото у Telegram ограничена 1024 символами; если
// карточка длиннее — шлём фото отдельно, а карточку текстом (кнопки — на ней).
async function sendCard(ctx, text, jobId, isManager, photoUrl) {
  const kb = cardButtons(jobId, isManager);
  if (photoUrl && text.length <= 1024) {
    try {
      return await ctx.replyWithPhoto(photoUrl, { caption: text, parse_mode: 'HTML', ...kb });
    } catch (e) {
      console.error('Фото в карточке не отправилось, шлю текстом:', e.message);
    }
  } else if (photoUrl) {
    await ctx.replyWithPhoto(photoUrl).catch(() => {});
  }
  return ctx.reply(text, { parse_mode: 'HTML', ...kb });
}

// ─── Выбор машины кнопками (список + листание) ───
function browseText(data) {
  if (!data.total) return 'Сейчас в работе нет машин.';
  return `<b>Выберите машину</b> — в работе ${data.total}\nСтраница ${data.page + 1} из ${data.pages}. Нажмите на машину или просто введите госномер:`;
}

function browseKeyboard(data) {
  const rows = data.cars.map((c) => [Markup.button.callback(c.label, `car:${c.id}`)]);
  const nav = [];
  if (data.page > 0) nav.push(Markup.button.callback('‹ Назад', `browse:${data.page - 1}`));
  if (data.page < data.pages - 1) nav.push(Markup.button.callback('Дальше ›', `browse:${data.page + 1}`));
  if (nav.length) rows.push(nav);
  return Markup.inlineKeyboard(rows);
}

// Клавиатура из нескольких найденных машин (несколько совпадений поиска).
function carsKeyboard(matches) {
  return Markup.inlineKeyboard(matches.map((m) => [Markup.button.callback(m.label, `car:${m.id}`)]));
}

// Кнопки-номера (по 3 в ряд) под короткими списками — нажал номер, открылась карточка.
function plateButtons(cars) {
  const rows = [];
  for (let i = 0; i < cars.length; i += 3) {
    rows.push(cars.slice(i, i + 3).map((c) => Markup.button.callback(c.plate, `car:${c.id}`)));
  }
  return Markup.inlineKeyboard(rows);
}

// Кнопки под сводкой учредителя: сверху развороты по разделам (со счётчиками),
// снизу — номера машин, упомянутых в сводке, чтобы провалиться в карточку.
function digestKeyboard(data) {
  const rows = [];
  const top = [];
  if (data.invoices) top.push(Markup.button.callback(`Счета к оплате · ${data.invoices}`, 'fd:invoices'));
  if (data.approvals) top.push(Markup.button.callback(`Согласования · ${data.approvals}`, 'fd:approvals'));
  if (top.length) rows.push(top);
  for (let i = 0; i < (data.cars || []).length; i += 3) {
    rows.push(data.cars.slice(i, i + 3).map((c) => Markup.button.callback(c.plate, `car:${c.id}`)));
  }
  // В спокойный день кнопок может не быть вовсе — тогда шлём вообще без клавиатуры.
  return rows.length ? Markup.inlineKeyboard(rows) : {};
}

// Отправить список вида {text, cars}: с кнопками-номерами, если машины есть.
async function sendList(ctx, res) {
  if (res && res.cars && res.cars.length) {
    return ctx.reply(res.text, { parse_mode: 'HTML', ...plateButtons(res.cars) });
  }
  return send(ctx, res.text, ctx.state.manager);
}

// Список сохранённых документов машины.
bot.action(/^docs:(.+)$/, async (ctx) => {
  if (!config.isManager(ctx.from.id)) return ctx.answerCbQuery('Только управляющим');
  const jobId = ctx.match[1];
  try {
    await ctx.answerCbQuery();
    const { text, docs } = await views.jobDocuments(jobId);
    if (!docs.length) return ctx.reply('По этой машине сохранённых документов пока нет.');
    const kb = Markup.inlineKeyboard(docs.map((d) => [Markup.button.callback(d.label, `getdoc:${d.id}`)]));
    await ctx.reply(`${text}\nВыберите — пришлю PDF:`, { parse_mode: 'HTML', ...kb });
  } catch (e) {
    console.error('Список документов:', e);
    await ctx.reply(isReady() ? '⚠️ Не удалось получить документы.' : '⚙️ База ещё не подключена.');
  }
});

// Прислать конкретный документ как PDF (точно как на сайте).
bot.action(/^getdoc:(.+)$/, async (ctx) => {
  if (!config.isManager(ctx.from.id)) return ctx.answerCbQuery('Только управляющим');
  const docId = ctx.match[1];
  try {
    await ctx.answerCbQuery('Готовлю документ…');
    const snapshot = await getDocById(docId);
    if (!snapshot) return ctx.reply('Документ не найден.');
    const { buffer, filename } = await docpdf.renderPdf(snapshot);
    await ctx.replyWithDocument({ source: buffer, filename });
  } catch (e) {
    console.error('Документ:', e);
    await ctx.reply(isReady() ? '⚠️ Не удалось сформировать документ.' : '⚙️ База ещё не подключена.');
  }
});

// ─── Запчасти по машине (всем; поставщики и цены — только управляющим) ───
bot.action(/^parts:(.+)$/, async (ctx) => {
  if (!config.isAllowed(ctx.from.id)) return ctx.answerCbQuery('Нет доступа');
  const jobId = ctx.match[1];
  try {
    await ctx.answerCbQuery();
    const text = await views.partsView(jobId, {
      isManager: config.isManager(ctx.from.id),
      canSeeSupply: config.canSeeSupply(ctx.from.id), // управляющий или запчастист
    });
    try {
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (e) {
      // Подстраховка: если клиент/сервер не понял «сворачиваемую цитату» — без неё.
      if (/parse entities|blockquote|unsupported/i.test(e.description || e.message || '')) {
        await ctx.reply(text.replace(/<\/?blockquote[^>]*>/g, ''), { parse_mode: 'HTML' });
      } else { throw e; }
    }
  } catch (e) {
    console.error('Запчасти:', e);
    await ctx.reply(isReady() ? '⚠️ Не удалось получить запчасти.' : '⚙️ База ещё не подключена.');
  }
});

// Отправить альбом фото. В Telegram один альбом — от 2 до 10 снимков, поэтому
// одиночные шлём обычным фото, а длинные списки бьём на группы по 10.
async function sendAlbum(ctx, urls, caption) {
  if (!urls || !urls.length) return;
  for (let i = 0; i < urls.length; i += 10) {
    const chunk = urls.slice(i, i + 10);
    const cap = i === 0 ? caption : undefined;
    if (chunk.length === 1) {
      await ctx.replyWithPhoto(chunk[0], cap ? { caption: cap } : undefined);
    } else {
      await ctx.replyWithMediaGroup(chunk.map((url, idx) => ({
        type: 'photo', media: url, ...(idx === 0 && cap ? { caption: cap } : {}),
      })));
    }
  }
}

// ─── Фото машины: до/после (всем) ───
bot.action(/^photos:(.+)$/, async (ctx) => {
  if (!config.isAllowed(ctx.from.id)) return ctx.answerCbQuery('Нет доступа');
  const jobId = ctx.match[1];
  try {
    await ctx.answerCbQuery('Загружаю фото…');
    const ph = await views.jobPhotos(jobId);
    if (!ph || ph.total === 0) return ctx.reply('Фото по этой машине пока нет.');
    await sendAlbum(ctx, ph.before, `${ph.car} — до ремонта`);
    await sendAlbum(ctx, ph.after, `${ph.car} — после ремонта`);
  } catch (e) {
    console.error('Фото:', e);
    await ctx.reply(isReady() ? '⚠️ Не удалось получить фото.' : '⚙️ База ещё не подключена.');
  }
});

// Открыть карточку машины по нажатию на кнопку из списка/поиска.
bot.action(/^car:(.+)$/, async (ctx) => {
  if (!config.isAllowed(ctx.from.id)) return ctx.answerCbQuery('Нет доступа');
  const jobId = ctx.match[1];
  const isManager = config.isManager(ctx.from.id);
  try {
    await ctx.answerCbQuery();
    const card = await views.openCar(jobId, { isManager });
    if (!card) return ctx.reply('Машина не найдена (возможно, уже выдана).');
    await sendCard(ctx, card.text, jobId, isManager, card.photo);
  } catch (e) {
    console.error('Открытие машины:', e);
    await ctx.reply(isReady() ? '⚠️ Не удалось открыть карточку.' : '⚙️ База ещё не подключена.');
  }
});

// Обновить карточку машины на месте (кнопка 🔄). Само фото не меняем — только
// текст/подпись (статусы, полосы прогресса, финансы). Если карточка была без фото —
// правим текст, если с фото — подпись.
bot.action(/^refresh:(.+)$/, async (ctx) => {
  if (!config.isAllowed(ctx.from.id)) return ctx.answerCbQuery('Нет доступа');
  const jobId = ctx.match[1];
  const isManager = config.isManager(ctx.from.id);
  try {
    const card = await views.openCar(jobId, { isManager });
    if (!card) return ctx.answerCbQuery('Машина не найдена');
    const kb = cardButtons(jobId, isManager);
    const hasPhoto = !!(ctx.callbackQuery.message && ctx.callbackQuery.message.photo);
    if (hasPhoto && card.text.length <= 1024) {
      await ctx.editMessageCaption(card.text, { parse_mode: 'HTML', ...kb });
    } else if (hasPhoto) {
      await ctx.reply(card.text, { parse_mode: 'HTML', ...kb }); // подпись не влезает — новым сообщением
    } else {
      await ctx.editMessageText(card.text, { parse_mode: 'HTML', ...kb });
    }
    await ctx.answerCbQuery('Обновлено');
  } catch (e) {
    const desc = (e && (e.description || e.message)) || '';
    if (/message is not modified/i.test(desc)) return ctx.answerCbQuery('Без изменений');
    console.error('Обновление карточки:', e);
    await ctx.answerCbQuery('Не удалось обновить');
  }
});

// Листание списка машин (кнопки ⬅️/➡️) — обновляем то же сообщение.
bot.action(/^browse:(\d+)$/, async (ctx) => {
  if (!config.isAllowed(ctx.from.id)) return ctx.answerCbQuery('Нет доступа');
  try {
    await ctx.answerCbQuery();
    const data = await views.carsBrowse(Number(ctx.match[1]));
    await ctx.editMessageText(browseText(data), { parse_mode: 'HTML', ...browseKeyboard(data) });
  } catch (e) {
    const desc = (e && (e.description || e.message)) || '';
    if (/message is not modified/i.test(desc)) return; // та же страница — не страшно
    console.error('Листание списка:', e);
  }
});

// ─── Любой другой текст — это поиск ───
bot.on('text', guard(async (ctx) => {
  const isManager = ctx.state.manager;
  try {
    const res = await views.search(ctx.message.text, { isManager });
    if (res.jobId) {
      // Одна машина найдена — карточка с фото и кнопками (документы — управляющим).
      await sendCard(ctx, res.text, res.jobId, isManager, res.photo);
    } else if (res.matches && res.matches.length) {
      // Несколько машин — показываем кнопками, выбирается нажатием.
      await ctx.reply(res.text, { parse_mode: 'HTML', ...carsKeyboard(res.matches) });
    } else {
      await send(ctx, res.text, isManager);
    }
  } catch (e) {
    if (!isReady()) return send(ctx, '⚙️ База ещё не подключена — идёт настройка.', isManager);
    console.error('Поиск:', e);
    await send(ctx, '⚠️ Не удалось получить данные. Попробуйте ещё раз.', isManager);
  }
}));

// ─── Рассылки ────────────────────────────────────────────────────────────────
// Каждая рассылка — это функция run*(to), которую вызывает и расписание, и кнопка
// «Отправить сейчас» на сайте. Возвращает короткий человеческий отчёт («Доставлено:
// 2»), который сайт показывает рядом с кнопкой. Аргумент `to` — необязательный
// список получателей вместо обычных (нужен для проверки «пришлите только мне»).

// Разослать один и тот же текст списку людей, не падая на первом же отказе.
async function deliver(ids, text, extra) {
  const ok = [];
  const failed = [];
  for (const id of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await bot.telegram.sendMessage(id, text, { parse_mode: 'HTML', ...(extra || {}) });
      ok.push(id);
    } catch (e) {
      console.error(`Отправка ${id}:`, e.message);
      failed.push(`${id} — ${explainSendError(e)}`);
    }
  }
  if (!failed.length) return `Доставлено: ${ok.length}`;
  if (!ok.length) return `Не доставлено: ${failed.join('; ')}`;
  return `Доставлено: ${ok.length}. Не дошло: ${failed.join('; ')}`;
}

// Утренняя сводка — управляющим.
async function runSummary(to) {
  if (!isReady()) return 'база не подключена';
  const ids = to && to.length ? to : config.managers;
  if (!ids.length) return 'некому отправлять — нет управляющих';
  return deliver(ids, await views.dailySummary());
}

// Вечернее напоминание управляющим: что выдать завтра и что «горит» сегодня.
async function runReminder(to) {
  if (!isReady()) return 'база не подключена';
  const ids = to && to.length ? to : config.managers;
  if (!ids.length) return 'некому отправлять — нет управляющих';
  const text = await views.eveningReminder();
  if (!text) return 'напоминать сегодня не о чем — сообщение не отправлено';
  return deliver(ids, text);
}

// Ежедневная сводка учредителям «Состояние ремонтов»: новые авто, согласования,
// укомплектованность по запчастям, счета к оплате — одним сообщением с кнопками.
// Шлём всегда (даже в спокойный день) — это сводка состояния, а не оповещение.
async function runFounderDigest(to) {
  if (!isReady()) return 'база не подключена';
  const ids = to && to.length ? to : config.founders;
  if (!ids.length) return 'некому отправлять — нет учредителей';
  const data = await views.founderDigest();
  return deliver(ids, data.text, digestKeyboard(data));
}

// Ежедневный разбор почты «итог дня»: письма, сверенные с базой машин, и состояние
// переписки. По умолчанию — тем, кто выбран в настройках рассылки; если там пусто —
// всем управляющим. Если почта не настроена (нет MAIL_*), ничего не шлём.
async function runMailDigest(to) {
  if (!isReady()) return 'база не подключена';
  if (!mailConfigured()) return 'почта не настроена (нет MAIL_USER/MAIL_PASSWORD в .env бота)';
  const ids = to && to.length ? to : (config.mailDigestTo.length ? config.mailDigestTo : config.managers);
  if (!ids.length) return 'некому отправлять';
  return deliver(ids, await buildDigestText(), { disable_web_page_preview: true });
}

// Утренняя сводка «Дефектовка» — мастерам-приёмщикам. Как и вечернее напоминание,
// в пустой день не уходит: приёмщик должен открывать это сообщение, потому что там
// всегда есть дело, а не потому что «бот опять что-то прислал».
async function runIntakeDigest(to) {
  if (!isReady()) return 'база не подключена';
  const ids = to && to.length ? to : config.receptionists;
  if (!ids.length) return 'некому отправлять — нет мастеров-приёмщиков';
  const text = await intakeDigest({ tz: config.intakeDigest.tz });
  if (!text) return 'по дефектовке дел нет — сообщение не отправлено';
  return deliver(ids, text);
}

const RUNNERS = {
  summary: runSummary,
  reminder: runReminder,
  founderDigest: runFounderDigest,
  mailDigest: runMailDigest,
  intakeDigest: runIntakeDigest,
};

// ─── Расписание, которое можно менять на лету ────────────────────────────────
// Время и часовой пояс приходят из настроек на сайте. Когда владелец их меняет,
// старую задачу останавливаем и ставим новую — перезапускать бота не нужно.
// Выключенная рассылка задачу не теряет: проверка стоит внутри, поэтому обратное
// включение срабатывает сразу.
const tasks = new Map();

function applySchedule(key) {
  const s = config[key];
  const prev = tasks.get(key);
  if (prev && prev.cron === s.cron && prev.tz === s.tz) return false;
  if (prev) {
    try { prev.task.stop(); } catch { /* уже остановлена */ }
    try { prev.task.destroy?.(); } catch { /* нечего убирать */ }
  }
  const task = cron.schedule(s.cron, async () => {
    if (!config[key].enabled) return; // рассылка выключена на сайте
    try {
      const res = await RUNNERS[key]();
      console.log(`⏰ Рассылка «${key}»: ${res}`);
    } catch (e) {
      console.error(`Рассылка «${key}»:`, e.message);
    }
  }, { timezone: s.tz });
  tasks.set(key, { task, cron: s.cron, tz: s.tz });
  return !!prev; // true = расписание переставили (а не поставили впервые)
}

function applyAllSchedules() {
  const changed = config.SCHEDULE_IDS.filter((k) => applySchedule(k));
  if (changed.length) console.log(`⏰ Расписание обновлено с сайта: ${changed.join(', ')}`);
}

// ─── Запуск ───
// В этой версии Telegraf промис bot.launch() резолвится только при ОСТАНОВКЕ,
// поэтому расписание и логи ставим до запуска, а сам launch не «ждём».
// Ошибки в обработчиках не должны ронять бота.
bot.catch((err, ctx) => {
  console.error(`Ошибка обработчика (${ctx?.updateType || '?'}):`, err.message);
});

// Меню команд (кнопка ☰ у поля ввода). Всем — базовый набор; управляющим в их
// личных чатах — расширенный (с финансами). Ошибки не критичны — просто у кого-то
// не появится меню (например, если управляющий ещё не открывал бот).
// Кому персональное меню уже ставили — помним, чтобы снять его при смене роли.
let personalScopes = new Set();

async function setupCommands() {
  const base = [
    { command: 'find', description: 'Найти авто — список и поиск' },
    { command: 'cars', description: 'Машины в работе' },
    { command: 'masters', description: 'Загрузка мастеров' },
    { command: 'upcoming', description: 'Скоро выдача' },
    { command: 'help', description: 'Что умеет бот' },
  ];
  const managerCmds = [
    { command: 'find', description: 'Найти авто — список и поиск' },
    { command: 'cars', description: 'Машины в работе' },
    { command: 'masters', description: 'Загрузка мастеров' },
    { command: 'upcoming', description: 'Скоро выдача' },
    { command: 'debts', description: 'Долги по машинам' },
    { command: 'revenue', description: 'Выручка за период' },
    { command: 'analytics', description: 'Аналитика' },
    { command: 'summary', description: 'Сводка за день' },
    { command: 'digest', description: 'Состояние ремонтов' },
    { command: 'approvals', description: 'Согласования со страховой' },
    { command: 'invoices', description: 'Счета к оплате' },
    { command: 'mail', description: 'Разбор почты за день' },
    { command: 'help', description: 'Что умеет бот' },
  ];
  try {
    await bot.telegram.setMyCommands(base);
  } catch (e) { console.error('Меню команд (общее):', e.message); }
  const personal = new Set();
  for (const id of config.managers) {
    personal.add(String(id));
    try {
      await bot.telegram.setMyCommands(managerCmds, { scope: { type: 'chat', chat_id: Number(id) } });
    } catch (e) { console.error(`Меню команд (управляющий ${id}):`, e.message); }
  }
  // Учредителю — узкое меню: его сводка и разделы из неё. (Тех, кто ещё и
  // управляющий, не трогаем — у них уже расширенное меню.)
  const founderCmds = [
    { command: 'digest', description: 'Состояние ремонтов' },
    { command: 'approvals', description: 'Согласования со страховой' },
    { command: 'invoices', description: 'Счета к оплате' },
    { command: 'help', description: 'Что умеет бот' },
  ];
  for (const id of config.founders) {
    if (config.isManager(id)) continue;
    personal.add(String(id));
    try {
      await bot.telegram.setMyCommands(founderCmds, { scope: { type: 'chat', chat_id: Number(id) } });
    } catch (e) { console.error(`Меню команд (учредитель ${id}):`, e.message); }
  }
  // Мастеру-приёмщику — его список дефектовок первым пунктом. (Управляющих и
  // учредителей не трогаем: у них своё меню, где «Дефектовка» уже есть.)
  const receptionistCmds = [
    { command: 'intake', description: 'Дефектовка — кого пригласить и кто приедет' },
    { command: 'find', description: 'Найти авто — список и поиск' },
    { command: 'cars', description: 'Машины в работе' },
    { command: 'upcoming', description: 'Скоро выдача' },
    { command: 'help', description: 'Что умеет бот' },
  ];
  for (const id of config.receptionists) {
    if (config.isManager(id) || config.isFounder(id)) continue;
    personal.add(String(id));
    try {
      await bot.telegram.setMyCommands(receptionistCmds, { scope: { type: 'chat', chat_id: Number(id) } });
    } catch (e) { console.error(`Меню команд (приёмщик ${id}):`, e.message); }
  }
  // Кого-то понизили в правах на сайте — убираем его персональное меню, иначе в
  // Telegram у него так и остались бы команды с финансами.
  for (const id of personalScopes) {
    if (personal.has(id)) continue;
    try {
      await bot.telegram.deleteMyCommands({ scope: { type: 'chat', chat_id: Number(id) } });
    } catch (e) { console.error(`Снятие меню команд (${id}):`, e.message); }
  }
  personalScopes = personal;
}

// Подключение к Telegram с повторами: сразу после загрузки сервера сеть может
// быть ещё не готова — не сдаёмся после первой осечки, а пробуем снова.
async function connectAndLaunch() {
  for (let attempt = 1; ; attempt++) {
    try {
      const me = await bot.telegram.getMe();
      console.log(`✅ Telegram на связи: @${me.username}`);
      if (control) control.setUsername(me.username);
      await setupCommands();
      break;
    } catch (e) {
      const wait = Math.min(60, attempt * 5);
      console.error(`Telegram недоступен (попытка ${attempt}): ${e.message}. Повтор через ${wait}с…`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  // launch() у Telegraf резолвится только при остановке; на ошибке — перезапуск.
  bot.launch().catch((e) => {
    console.error('Опрос прервался:', e.message, '— перезапуск через 10с');
    setTimeout(connectAndLaunch, 10000);
  });
}

const hm = (s) => `${s.hour}:${String(s.minute).padStart(2, '0')}`;
const off = (s) => (s.enabled ? '' : ' — ВЫКЛЮЧЕНА на сайте');

function logSetup() {
  console.log(isReady() ? '✅ База подключена.' : `⚠️  База не подключена: ${reason()}`);
  console.log(`⏰ Утренняя сводка: ${hm(config.summary)}${off(config.summary)} · напоминание: ${hm(config.reminder)}${off(config.reminder)} (${config.summary.tz}), получатели: ${config.managers.length || 'пока никого'}`);
  console.log(`💳 Счета поставщиков: учредителей ${config.founders.length || 'пока нет'} (мгновенный пуш + кнопка «Счета к оплате»)`);
  console.log(`📋 Сводка учредителя «Состояние ремонтов»: ${hm(config.founderDigest)}${off(config.founderDigest)} (${config.founderDigest.tz}), получателей: ${config.founders.length || 'пока нет'}`);
  console.log(`📬 Разбор почты: ${hm(config.mailDigest)}${off(config.mailDigest)} (${config.mailDigest.tz}), получателей ${(config.mailDigestTo.length ? config.mailDigestTo : config.managers).length || 'пока никого'}${mailConfigured() ? '' : ' — ПОЧТА НЕ НАСТРОЕНА (MAIL_USER/MAIL_PASSWORD)'}`);
  console.log(`🗓  Дефектовка (приёмщику): ${hm(config.intakeDigest)}${off(config.intakeDigest)} (${config.intakeDigest.tz}), приёмщиков ${config.receptionists.length || 'пока нет'}`);
}

let control = null;

// Сначала поднимаем настройки из базы (кто, во сколько, какие уведомления), потом
// уже ставим расписание — иначе первые задачи встали бы по старым значениям .env.
// Если база недоступна, botConfig просто остаётся на значениях .env и бот работает
// как раньше.
async function main() {
  console.log('🤖 Бот запускается…');
  await config.start();
  applyAllSchedules();
  startNotifier(bot);
  control = startControl(bot, RUNNERS) || null;
  logSetup();

  // Настройки поменяли на сайте — переставляем расписание и обновляем меню команд
  // (у кого-то могла смениться роль).
  config.onChange(() => {
    applyAllSchedules();
    setupCommands().catch((e) => console.error('Меню команд после правки настроек:', e.message));
    logSetup();
  });

  connectAndLaunch();
}

main();

function stop(sig) {
  try { bot.stop(sig); } catch { /* ещё не запущен — не страшно */ }
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
