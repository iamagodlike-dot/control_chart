import Icon from './Icon';
import { PAYMENT_SHORT } from '../insurance';
import { fmtDay, fmtDayTime, fmtRelativeDay, fmtTime, pluralDays } from '../intake';

// Презентационная половина экрана мастера-приёмщика: чистые пропсы, без Firestore.
// Реальный экран (Intake) кормит её живой подпиской, демо-страница — сидом,
// поэтому обе рисуют побуквенно одно и то же. Вся логика — в intake.js.
//
// Экран читается сверху вниз ровно в том порядке, в котором приёмщик работает:
//   1. напоминания      — что горит прямо сейчас;
//   2. пригласить        — кому звонить, пока не начал звонить телефон;
//   3. календарь         — две недели: кто когда приедет;
//   4. приедут позже     — дальний хвост, чтобы не забыть о нём вовсе.

// Телефон клиента — ссылка tel:, чтобы с телефона звонок начинался одним касанием.
// Пробелы и скобки из номера убираем: набиратель их не понимает.
const telHref = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;

function Phone({ phone, className = 'ink-tel' }) {
  if (!phone) return <span className="ink-muted">телефон не указан</span>;
  return (
    <a className={className} href={telHref(phone)} onClick={(e) => e.stopPropagation()}>
      <Icon name="phone" size={13} />{phone}
    </a>
  );
}

// Кто платит: страховая (с названием) или клиент. Одна строка вместо двух полей.
// Номер убытка сюда НЕ выводим: в списке он ничего не решает, а строку ломает —
// приёмщик видит его в попапе, когда действительно набирает номер.
function Payer({ row }) {
  const insured = row.payment_type === 'insurance';
  return (
    <span className={`ink-payer${insured ? ' is-insured' : ''}`}>
      <Icon name={insured ? 'shield' : 'wallet'} size={13} />
      {insured ? (row.insurer_name || 'Страховая') : (PAYMENT_SHORT[row.payment_type] || 'Клиент')}
    </span>
  );
}

function Plate({ row }) {
  return (
    <span className="ink-car">
      {row.plate_number && <span className="ink-plate">{row.plate_number}</span>}
      <span className="ink-model">{row.car_model}</span>
    </span>
  );
}

// ─── Напоминания ─────────────────────────────────────────────────────────────

function Reminder({ item, nowMs, onOpen, onConfirm, onStart }) {
  const { row, kind } = item;
  const overdue = kind === 'overdue';
  return (
    <li className={`ink-rem-item is-${kind}`}>
      <span className="ink-rem-mark"><Icon name={overdue ? 'warning' : 'phone'} size={15} /></span>
      <div className="ink-rem-body">
        <div className="ink-rem-title">
          {overdue
            ? <>Не приехала на дефектовку — <b>{fmtDayTime(row.scheduled_at)}</b> ({fmtRelativeDay(row.scheduled_at, nowMs)})</>
            : <>Завтра дефектовка в <b>{fmtTime(row.scheduled_at)}</b> — позвонить и подтвердить</>}
        </div>
        <div className="ink-rem-meta">
          <Plate row={row} />
          {row.client_name && <span>{row.client_name}</span>}
          <Phone phone={row.client_phone} />
        </div>
      </div>
      {/* Главное действие — то, которое чаще всего нужно: по неприехавшей машине
          сначала звонят и переносят, по завтрашней — отмечают подтверждение. */}
      <div className="ink-rem-acts">
        {overdue ? (
          <>
            <button type="button" className="ink-btn is-quiet" onClick={() => onStart(row.id)}>Начать дефектовку</button>
            <button type="button" className="ink-btn is-primary" onClick={() => onOpen(row.id)}>Перенести</button>
          </>
        ) : (
          <>
            <button type="button" className="ink-btn is-quiet" onClick={() => onOpen(row.id)}>Перенести</button>
            <button type="button" className="ink-btn is-primary" onClick={() => onConfirm(row.id)}>
              <Icon name="check" size={14} strokeWidth={2.4} />Подтвердил
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// ─── Зона 1: пригласить ──────────────────────────────────────────────────────

function InviteCard({ row, onOpen }) {
  return (
    <article className={`ink-inv is-${row.severity}`}>
      <div className="ink-inv-days" title="Столько машина ждёт приглашения">
        <b>{row.daysWaiting}</b>
        <span>{row.daysWaiting === 0 ? 'заехала\nсегодня' : `${pluralDays(row.daysWaiting)} без\nприглашения`}</span>
      </div>
      <div className="ink-inv-main">
        <Plate row={row} />
        <div className="ink-inv-rows">
          <Payer row={row} />
          <span className="ink-inv-client">
            {row.client_name && <span><Icon name="user" size={13} />{row.client_name}</span>}
            <Phone phone={row.client_phone} />
          </span>
        </div>
      </div>
      <button type="button" className="ink-btn is-primary is-big" onClick={() => onOpen(row.id)}>
        <Icon name="phone" size={15} />Пригласить
      </button>
    </article>
  );
}

// ─── Зона 2: календарь двух недель ───────────────────────────────────────────

// Машина в клетке дня: время и госномер строкой, марка с моделью — второй.
// В одну строку они не влезают (клетка ≈ 1/7 ширины), а узнают машину чаще именно
// по марке: «Тигуан на 14:30» помнят, номер — нет.
function DayCar({ row, onOpen }) {
  const cls = [
    'ink-daycar',
    row.phase === 'overdue' ? 'is-overdue' : '',
    row.confirmed ? 'is-confirmed' : '',
  ].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={() => onOpen(row.id)}
      title={`${fmtTime(row.scheduled_at)} · ${row.car_model}${row.client_name ? ` · ${row.client_name}` : ''}${row.confirmed ? ' · клиент подтвердил' : ''}`}
    >
      <span className="ink-daycar-top">
        <span className="ink-daycar-time">{fmtTime(row.scheduled_at)}</span>
        {row.plate_number && <span className="ink-daycar-plate">{row.plate_number}</span>}
        {row.confirmed && <Icon name="check" size={11} strokeWidth={3} />}
      </span>
      <span className="ink-daycar-model">{row.car_model}</span>
    </button>
  );
}

function Day({ day, onOpen }) {
  const cls = [
    'ink-day',
    day.isToday ? 'is-today' : '',
    day.isPast ? 'is-past' : '',
    day.isWeekend ? 'is-weekend' : '',
    day.cars.length ? 'has-cars' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className="ink-day-head">
        <span className="ink-day-num">{day.dayNum}</span>
        {day.showMonth && <span className="ink-day-month">{day.month}</span>}
        <span className="ink-day-wd">{day.weekday}</span>
        {day.cars.length > 1 && <span className="ink-day-count">{day.cars.length}</span>}
      </div>
      <div className="ink-day-cars">
        {day.cars.map((row) => <DayCar key={row.id} row={row} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

// ─── Экран ───────────────────────────────────────────────────────────────────

export default function IntakeView({
  loading = false,
  board = null,
  query = '',
  onQuery = () => {},
  nowMs = 0,
  onOpen = () => {},
  onConfirm = () => {},
  onStart = () => {},
}) {
  const b = board || { invite: [], weeks: [], later: [], reminders: [], counts: {} };
  const { counts } = b;
  const firstDay = b.weeks[0]?.days[0];
  const lastDay = b.weeks[b.weeks.length - 1]?.days[6];

  if (loading) {
    return (
      <div className="ink">
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      </div>
    );
  }

  return (
    <div className="ink">
      <header className="ink-head">
        <div className="ink-title">
          <h2>Дефектовка</h2>
          <p>Пригласить машину, записать на дату, довести до осмотра</p>
        </div>
        <div className="ink-nums">
          <span className="ink-num">
            <b>{counts.invite ?? 0}</b>
            <span>ждут приглашения</span>
          </span>
          <span className="ink-num is-good">
            <b>{counts.today ?? 0}</b>
            <span>приедут сегодня</span>
          </span>
          <span className={`ink-num${counts.overdue ? ' is-bad' : ''}`}>
            <b>{counts.overdue ?? 0}</b>
            <span>не приехали</span>
          </span>
        </div>
        <label className="ink-search">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Госномер, клиент, страховая"
            aria-label="Поиск машины"
          />
          {query && (
            <button type="button" onClick={() => onQuery('')} aria-label="Очистить поиск">
              <Icon name="x" size={14} />
            </button>
          )}
        </label>
      </header>

      {b.reminders.length > 0 && (
        <section className="ink-rem">
          <div className="ink-rem-head">
            <Icon name="bell" size={15} />Напоминания
            {/* Красный счётчик — только когда есть неприехавшие. Звонки накануне
                это рабочая рутина, а не авария, и красным их метить нечестно. */}
            <span className={`ink-rem-n${b.reminders.some((x) => x.kind === 'overdue') ? '' : ' is-soft'}`}>
              {b.reminders.length}
            </span>
          </div>
          <ul className="ink-rem-list">
            {b.reminders.map((item) => (
              <Reminder
                key={item.id}
                item={item}
                nowMs={nowMs}
                onOpen={onOpen}
                onConfirm={onConfirm}
                onStart={onStart}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="ink-sec">
        <div className="ink-sec-head">
          <h3>Пригласить на дефектовку</h3>
          <span className="ink-sec-n">{b.invite.length}</span>
          {counts.stale > 0 && <span className="ink-sec-warn">{counts.stale} висят дольше трёх дней</span>}
        </div>
        {b.invite.length === 0 ? (
          <div className="ink-empty">
            {query ? 'Среди найденных машин приглашать некого.' : 'Все машины на осмотре уже записаны на дефектовку.'}
          </div>
        ) : (
          <div className="ink-inv-list">
            {b.invite.map((row) => <InviteCard key={row.id} row={row} onOpen={onOpen} />)}
          </div>
        )}
      </section>

      <section className="ink-sec">
        <div className="ink-sec-head">
          <h3>Записаны на дефектовку</h3>
          {firstDay && lastDay && <span className="ink-sec-range">{fmtDay(firstDay.ms)} — {fmtDay(lastDay.ms)}</span>}
        </div>
        <div className="ink-cal">
          {/* Дни недели подписаны один раз сверху, как в месячном календаре. На
              телефоне сетка разворачивается в список, и подпись переезжает в саму
              строку дня (см. .ink-day-wd в App.css). */}
          <div className="ink-cal-head" aria-hidden="true">
            {(b.weeks[0]?.days || []).map((d) => (
              <span key={d.key} className={d.isWeekend ? 'is-weekend' : ''}>{d.weekday}</span>
            ))}
          </div>
          {b.weeks.map((week) => (
            <div className="ink-week" key={week.id}>
              {week.days.map((day) => <Day key={day.key} day={day} onOpen={onOpen} />)}
            </div>
          ))}
        </div>
      </section>

      {b.later.length > 0 && (
        <section className="ink-sec">
          <div className="ink-sec-head">
            <h3>Приедут позже</h3>
            <span className="ink-sec-n">{b.later.length}</span>
            <span className="ink-sec-range">дальше двух недель</span>
          </div>
          <ul className="ink-later">
            {b.later.map((row) => (
              <li key={row.id}>
                <button type="button" className="ink-later-row" onClick={() => onOpen(row.id)}>
                  <span className="ink-later-date">
                    <b>{fmtDayTime(row.scheduled_at)}</b>
                    <span className="ink-muted">{fmtRelativeDay(row.scheduled_at, nowMs)}</span>
                  </span>
                  <Plate row={row} />
                  <span className="ink-later-client">
                    {row.client_name}
                    <Phone phone={row.client_phone} />
                  </span>
                  <Payer row={row} />
                  {row.confirmed && <span className="ink-ok"><Icon name="check" size={12} strokeWidth={2.6} />подтверждено</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
