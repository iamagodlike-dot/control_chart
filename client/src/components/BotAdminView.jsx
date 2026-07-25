import Icon from './Icon';
import {
  BOT_ROLES, BOT_ROLE_ORDER, SCHEDULES, PUSHES, TIMEZONES,
  personLabel, peopleWithRole, recipientsOf, timeInMoscow, tzLabel,
  botStatusInfo, commandStatusText, commandTone, isValidTgId, tgIdError,
} from '../botSettings';

// Экран «Настройки → Телеграм-бот». Здесь нет обращений к базе — всё приходит в
// props, поэтому этот же компонент показывает демо-страница bot-demo.html.
// Всё сохраняется сразу при изменении (как в «Сотрудниках»), отдельной кнопки
// «Сохранить» нет.

function Switch({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`bot-switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="bot-switch-knob" />
    </button>
  );
}

// Результат задания, отправленного боту («проверить связь», «отправить сейчас»).
function CommandResult({ cmd, now }) {
  if (!cmd) return null;
  return (
    <span className={`bot-cmd-result ${commandTone(cmd, now)}`}>{commandStatusText(cmd, now)}</span>
  );
}

export default function BotAdminView({
  settings, status, people, onPatchPerson, onAddPerson, onRemovePerson,
  onPatchSchedule, onPatchPush, onCommand, commands = {}, form, onForm, error, savedAt, now, seeded = true,
}) {
  // `now` присылает контейнер и обновляет раз в 10 секунд — от него считаются
  // «на связи / молчит N минут» и ожидание ответа на задание.
  const info = botStatusInfo(status, now);
  const counts = BOT_ROLE_ORDER.reduce((acc, r) => ({ ...acc, [r]: peopleWithRole(people, r).length }), {});

  const toggleRole = (p, role) => {
    const roles = p.roles.includes(role) ? p.roles.filter((r) => r !== role) : [...p.roles, role];
    onPatchPerson(p.tg_id, { roles });
  };

  return (
    <div className="bot-admin">

      {/* ─── Жив ли бот ─── */}
      <div className="panel bot-head">
        <div className={`bot-status bot-status--${info.state}`}>
          <span className="bot-status-dot" />
          <span className="bot-status-body">
            <span className="bot-status-text">{info.text}</span>
            {info.detail && <span className="bot-status-detail">{info.detail}</span>}
          </span>
        </div>
        {savedAt > 0 && <span className="bot-saved"><Icon name="check" size={13} /> Сохранено</span>}
      </div>

      {seeded === false && (
        <div className="panel bot-notice">
          <Icon name="warning" size={16} />
          <span>
            <b>Бот ещё не перенёс сюда свои настройки.</b> Пока на сервере работает старая версия, список ниже может быть
            неполным — люди, заведённые в боте раньше, появятся здесь сами, как только бот обновится. Ничего не потеряется:
            их он добавит к тем, кого вы укажете тут.
          </span>
        </div>
      )}

      {/* ─── Люди ─── */}
      <div className="panel">
        <h3>Кто получает сообщения</h3>
        <p className="panel-hint">
          Это отдельный список от «Сотрудников»: чтобы получать сообщения в Telegram, вход в систему не нужен.
          Роли можно совмещать — например, управляющий и учредитель сразу. Нажмите роль, чтобы включить или выключить её.
        </p>

        {people.length === 0 ? (
          <div className="list-empty">Пока никого нет — добавьте первого человека ниже.</div>
        ) : (
          <div className="bot-people">
            {people.map((p) => {
              const off = p.active === false;
              const cmd = commands[`ping:${p.tg_id}`];
              return (
                <div key={p.tg_id} className={`bot-person${off ? ' off' : ''}`}>
                  <div className="bot-person-top">
                    <span className="list-icon list-icon--letter">
                      {(p.name || 'ID').trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="bot-person-id">
                      <input
                        className="bot-name-input"
                        placeholder="Имя"
                        value={p.name}
                        onChange={(e) => onPatchPerson(p.tg_id, { name: e.target.value })}
                      />
                      <span className="bot-tg-id">ID {p.tg_id}</span>
                      {off && <span className="user-off">отключён</span>}
                    </span>
                    <span className="list-actions">
                      <button
                        className="list-action-btn"
                        title="Отправить проверочное сообщение — сразу видно, дошло или нет"
                        disabled={cmd && cmd.status !== 'done' && cmd.status !== 'error'}
                        onClick={() => onCommand(`ping:${p.tg_id}`, 'ping', [p.tg_id])}
                      ><Icon name="send" size={14} /></button>
                      <button
                        className="list-action-btn"
                        title={off ? 'Включить — снова будет получать сообщения' : 'Отключить — перестанет получать сообщения и пользоваться ботом'}
                        onClick={() => onPatchPerson(p.tg_id, { active: off })}
                      ><Icon name="power" size={14} /></button>
                      <button
                        className="list-action-btn danger"
                        title="Убрать из бота совсем"
                        onClick={() => onRemovePerson(p.tg_id)}
                      ><Icon name="trash" size={14} /></button>
                    </span>
                  </div>

                  <div className="bot-person-roles">
                    {BOT_ROLE_ORDER.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`bot-role${p.roles.includes(r) ? ' on' : ''}`}
                        title={BOT_ROLES[r].hint}
                        aria-pressed={p.roles.includes(r)}
                        onClick={() => toggleRole(p, r)}
                      >{BOT_ROLES[r].label}</button>
                    ))}
                    {p.roles.length === 0 && (
                      <span className="bot-warn"><Icon name="warning" size={12} /> роль не выбрана — человек ничего не получает</span>
                    )}
                    <CommandResult cmd={cmd} now={now} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="inline-form column bot-add">
          <div className="bot-add-row">
            <input
              className="bot-add-id"
              placeholder="Telegram ID (только цифры)"
              inputMode="numeric"
              value={form.tg_id}
              onChange={(e) => onForm({ tg_id: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') onAddPerson(); }}
            />
            <input
              placeholder="Имя (чтобы не путаться)"
              value={form.name}
              onChange={(e) => onForm({ name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') onAddPerson(); }}
            />
          </div>
          <div className="bot-person-roles">
            {BOT_ROLE_ORDER.map((r) => (
              <button
                key={r}
                type="button"
                className={`bot-role${form.roles.includes(r) ? ' on' : ''}`}
                title={BOT_ROLES[r].hint}
                aria-pressed={form.roles.includes(r)}
                onClick={() => onForm({
                  roles: form.roles.includes(r) ? form.roles.filter((x) => x !== r) : [...form.roles, r],
                })}
              >{BOT_ROLES[r].label}</button>
            ))}
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button className="primary" onClick={onAddPerson} disabled={!isValidTgId(form.tg_id)}>Добавить в бота</button>
          <p className="panel-hint bot-howto">
            <b>Где взять Telegram ID:</b> человек открывает бота и отправляет команду <code>/whoami</code> — бот пришлёт его номер.
            Если человек ни разу не заходил в бота, сообщения ему не дойдут: сначала пусть нажмёт «Старт».
            {form.tg_id && !isValidTgId(form.tg_id) && <><br /><span className="bot-warn">{tgIdError(form.tg_id)}</span></>}
          </p>
        </div>
      </div>

      {/* ─── Рассылки ─── */}
      <div className="panel">
        <h3>Рассылки по расписанию</h3>
        <p className="panel-hint">Приходят сами, каждый день. Время указывается в выбранном часовом поясе — рядом подсказка, сколько это по Москве.</p>

        <div className="bot-rows">
          {SCHEDULES.map((s) => {
            const cfg = settings.schedules[s.id];
            const to = recipientsOf({ ...settings, people }, s.id);
            const cmd = commands[`send:${s.id}`];
            const msk = timeInMoscow(cfg.time, cfg.tz);
            return (
              <div key={s.id} className={`bot-row${cfg.enabled ? '' : ' off'}`}>
                <Switch
                  checked={cfg.enabled}
                  label={`Рассылка «${s.label}»`}
                  onChange={(v) => onPatchSchedule(s.id, { enabled: v })}
                />
                <div className="bot-row-body">
                  <div className="bot-row-title">
                    {s.label}
                    <span className="bot-row-to">{s.to} · {to.length}</span>
                  </div>
                  <div className="bot-row-hint">{s.hint}</div>

                  {to.length === 0 && cfg.enabled && (
                    <div className="bot-warn"><Icon name="warning" size={12} /> некому отправлять — никто не отмечен ролью «{BOT_ROLES[s.role].label}»</div>
                  )}

                  {s.pickPeople && peopleWithRole(people, s.role).length > 1 && (
                    <div className="bot-pick">
                      <span className="bot-pick-label">Кому:</span>
                      <button
                        type="button"
                        className={`bot-role${!(cfg.to || []).length ? ' on' : ''}`}
                        onClick={() => onPatchSchedule(s.id, { to: [] })}
                      >Всем</button>
                      {peopleWithRole(people, s.role).map((p) => {
                        const picked = (cfg.to || []).includes(p.tg_id);
                        return (
                          <button
                            key={p.tg_id}
                            type="button"
                            className={`bot-role${picked ? ' on' : ''}`}
                            onClick={() => onPatchSchedule(s.id, {
                              to: picked ? (cfg.to || []).filter((x) => x !== p.tg_id) : [...(cfg.to || []), p.tg_id],
                            })}
                          >{personLabel(p)}</button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bot-row-when">
                  <input
                    type="time"
                    className="bot-time"
                    value={cfg.time}
                    onChange={(e) => { if (e.target.value) onPatchSchedule(s.id, { time: e.target.value }); }}
                  />
                  <select value={cfg.tz} onChange={(e) => onPatchSchedule(s.id, { tz: e.target.value })}>
                    {TIMEZONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    {!TIMEZONES.some((t) => t.id === cfg.tz) && <option value={cfg.tz}>{tzLabel(cfg.tz)}</option>}
                  </select>
                  {msk && cfg.tz !== 'Europe/Moscow' && <span className="bot-msk">= {msk} МСК</span>}
                  <button
                    className="bot-send-now"
                    title="Отправить эту рассылку прямо сейчас — проверить, как она выглядит"
                    disabled={cmd && cmd.status !== 'done' && cmd.status !== 'error'}
                    onClick={() => onCommand(`send:${s.id}`, s.id, null)}
                  ><Icon name="send" size={13} /> Отправить сейчас</button>
                  <CommandResult cmd={cmd} now={now} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Мгновенные уведомления ─── */}
      <div className="panel">
        <h3>Мгновенные уведомления</h3>
        <p className="panel-hint">Приходят в момент события. Кому именно — зависит от роли, поменять получателя можно ролями выше.</p>
        <div className="bot-rows">
          {PUSHES.map((p) => (
            <div key={p.id} className={`bot-row bot-row--push${settings.pushes[p.id] ? '' : ' off'}`}>
              <Switch
                checked={settings.pushes[p.id]}
                label={`Уведомление «${p.label}»`}
                onChange={(v) => onPatchPush(p.id, v)}
              />
              <div className="bot-row-body">
                <div className="bot-row-title">{p.label}</div>
                <div className="bot-row-hint">{p.to}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="panel-hint bot-foot">
          Управляющих: {counts.manager} · учредителей: {counts.founder} · запчастистов: {counts.partsman} · сотрудников: {counts.staff}.
          Изменения бот подхватывает сам за несколько секунд — перезапускать его не нужно.
        </p>
      </div>
    </div>
  );
}
