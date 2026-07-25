'use strict';
const { db, isReady } = require('./firebase');

// ─── Связь бота с сайтом ─────────────────────────────────────────────────────
// Две вещи, которых не хватало админке на сайте:
//   1) «Бот жив?» — бот раз в несколько минут отмечается в settings/botStatus,
//      и экран настроек показывает «на связи» или «молчит с такого-то времени».
//   2) Кнопки «Проверить связь» и «Отправить сейчас» — сайт кладёт задание в
//      коллекцию botCommands, бот его выполняет и пишет туда же результат.
// Сайт НЕ ходит в Telegram напрямую: токен остаётся только на сервере.

const HEARTBEAT_MS = 5 * 60 * 1000; // раз в 5 минут — 288 записей в сутки
const COMMAND_TTL_MS = 60 * 60 * 1000; // выполненные задания живут час, потом убираем

const statusRef = () => db.collection('settings').doc('botStatus');
const commandsCol = () => db.collection('botCommands');

// Понятное объяснение вместо технической ошибки Telegram.
function explainSendError(e) {
  const text = (e && (e.description || e.message)) || '';
  if (/chat not found/i.test(text)) {
    return 'не найден чат — человек ещё ни разу не открывал бота. Попросите его нажать «Старт» в боте и попробуйте снова';
  }
  if (/blocked by the user|bot was blocked/i.test(text)) return 'человек заблокировал бота у себя в Telegram';
  if (/user is deactivated/i.test(text)) return 'аккаунт Telegram удалён';
  if (/chat_id is empty|invalid user_id/i.test(text)) return 'неверный Telegram ID';
  return text || 'неизвестная ошибка';
}

function startControl(bot, runners) {
  if (!isReady()) {
    console.log('🔌 Связь с сайтом выключена (нет подключения к базе).');
    return;
  }

  const startedAt = Date.now();
  let username = '';

  async function beat() {
    try {
      await statusRef().set(
        {
          online_at: Date.now(),
          started_at: startedAt,
          username,
          heartbeat_ms: HEARTBEAT_MS,
        },
        { merge: true },
      );
    } catch (e) {
      console.error('Отметка «бот жив»:', e.message);
    }
    // Заодно подчищаем старые задания, чтобы коллекция не росла бесконечно.
    try {
      const old = await commandsCol().where('created_at', '<', Date.now() - COMMAND_TTL_MS).limit(50).get();
      await Promise.all(old.docs.map((d) => d.ref.delete()));
    } catch {
      /* не критично — попробуем в следующий раз */
    }
  }

  // Проверка связи: пишем человеку короткое сообщение и честно отчитываемся,
  // дошло ли. Это главный способ убедиться, что Telegram ID введён верно.
  async function ping(ids) {
    const targets = ids && ids.length ? ids : [];
    if (!targets.length) return 'некому отправлять — не выбран получатель';
    const ok = [];
    const failed = [];
    for (const id of targets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await bot.telegram.sendMessage(
          id,
          '<b>Проверка связи</b>\nСообщение отправлено из «Настройки → Телеграм-бот» на сайте. Если вы это читаете — всё работает.',
          { parse_mode: 'HTML' },
        );
        ok.push(id);
      } catch (e) {
        failed.push(`${id} — ${explainSendError(e)}`);
      }
    }
    if (!failed.length) return `Доставлено: ${ok.length}`;
    if (!ok.length) return `Не доставлено: ${failed.join('; ')}`;
    return `Доставлено: ${ok.length}. Не дошло: ${failed.join('; ')}`;
  }

  async function run(cmd) {
    const to = Array.isArray(cmd.to) ? cmd.to.map(String).filter(Boolean) : null;
    if (cmd.type === 'ping') return ping(to);
    const fn = runners[cmd.type];
    if (!fn) return `неизвестное задание «${cmd.type}»`;
    return fn(to);
  }

  const busy = new Set(); // от повторного запуска одного и того же задания

  commandsCol().onSnapshot(
    async (snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') continue;
        const cmd = { id: ch.doc.id, ...ch.doc.data() };
        if (cmd.status !== 'pending' || busy.has(cmd.id)) continue;
        busy.add(cmd.id);
        try {
          await ch.doc.ref.set({ status: 'running', started_at: Date.now() }, { merge: true });
          const result = await run(cmd);
          await ch.doc.ref.set({ status: 'done', result: String(result || 'готово'), done_at: Date.now() }, { merge: true });
        } catch (e) {
          console.error(`Задание с сайта (${cmd.type}):`, e.message);
          try {
            await ch.doc.ref.set({ status: 'error', result: explainSendError(e), done_at: Date.now() }, { merge: true });
          } catch { /* не смогли записать ответ — сайт покажет «нет ответа» */ }
        } finally {
          busy.delete(cmd.id);
        }
      }
    },
    (e) => console.error('Задания с сайта:', e.message),
  );

  beat();
  const timer = setInterval(beat, HEARTBEAT_MS);
  if (timer.unref) timer.unref();

  // Имя бота узнаём после подключения к Telegram — показываем его на сайте.
  const setUsername = (name) => {
    username = name || '';
    beat();
  };

  console.log('🔌 Связь с сайтом включена (статус бота + кнопки «Проверить связь» / «Отправить сейчас»).');
  return { setUsername };
}

module.exports = { startControl, explainSendError };
