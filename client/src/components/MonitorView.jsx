import dayjs from 'dayjs';
import Icon from './Icon';
import { deadlineState } from './Gantt';
import { PAYMENT_SHORT, isInsurance } from '../insurance';
import { STAGE_FILTERS, SORTS } from '../monitor';

// Презентационная половина экрана «Монитор» — чистые пропсы, без Firestore.
// Реальный экран (Monitor) кормит её живыми данными, демо — сидом, так что обе
// версии рисуют побуквенно одно и то же. Вся логика простоев — в monitor.js.

// Вид бейджа этапа по stageKey из classify().
const STAGE_META = {
  approval: { icon: 'shield', color: 'var(--status-queued)' },
  queue: { icon: 'clock', color: 'var(--status-planned)' },
  parts: { icon: 'box', color: 'var(--status-arrived)' },
  repair: { icon: 'wrench', color: 'var(--status-in-progress)' },
  done: { icon: 'check', color: 'var(--status-done)' },
  rejected: { icon: 'x', color: 'var(--color-danger)' },
};

const DEADLINE_META = {
  missed: { mark: '⚠️', cls: 'is-missed', hint: 'Дедлайн уже прошёл' },
  'at-risk': { mark: '⚠', cls: 'is-risk', hint: 'Маршрут не успевает к дедлайну' },
  ok: { mark: '✓', cls: 'is-ok', hint: 'Успеваем к дедлайну' },
};

const dd = (v) => (v ? dayjs(v).format('DD.MM') : '—');

export default function MonitorView({
  loading, rows = [], counts = {}, summary = {},
  stage = 'all', onStage = () => {},
  payer = 'all', onPayer = () => {},
  query = '', onQuery = () => {},
  sort = 'idle', onSort = () => {},
  onOpen = () => {},
  now, // dayjs-момент для расчёта дедлайнов; по умолчанию — сейчас
}) {
  const clock = now || dayjs();

  return (
    <div className="mon">
      <div className="mon-head">
        <div className="mon-title">
          <h2><Icon name="clock" size={18} />Монитор</h2>
          <p>Все машины на площадке: кто стоит, почему и сколько дней</p>
        </div>
        <div className="mon-summary">
          <span className="mon-stat">на площадке <b>{summary.total ?? 0}</b></span>
          <span className={`mon-stat${summary.over7 ? ' is-bad' : ''}`}>стоят &gt;7 дней: <b>{summary.over7 ?? 0}</b></span>
          {summary.topCause && <span className="mon-stat">главная причина: <b>{summary.topCause}</b></span>}
          <span className="mon-stat">средний простой: <b>{summary.avgIdle ?? 0} дн</b></span>
        </div>
      </div>

      <div className="mon-filters">
        <div className="mon-chips">
          {STAGE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`mon-chip${stage === f.id ? ' active' : ''}`}
              onClick={() => onStage(f.id)}
            >
              {f.label}<span className="mon-chip-count">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="mon-tools">
          <select className="mon-select" value={payer} onChange={(e) => onPayer(e.target.value)} title="Фильтр по оплате">
            <option value="all">Все оплаты</option>
            <option value="insurance">Страховая</option>
            <option value="client">Клиент</option>
          </select>
          <select className="mon-select" value={sort} onChange={(e) => onSort(e.target.value)} title="Сортировка">
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <div className="mon-search">
            <Icon name="search" size={14} />
            <input
              placeholder="Гос.номер, марка, клиент…"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="mon-search-clear" onClick={() => onQuery('')} aria-label="Очистить">
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="list-loading"><div className="spinner" /><span>Загружаем машины…</span></div>
      ) : rows.length === 0 ? (
        <div className="mon-empty">
          <Icon name="clock" size={28} />
          <p>{query ? 'Ничего не найдено по вашему запросу.' : 'По выбранным фильтрам машин нет.'}</p>
        </div>
      ) : (
        <div className="mon-table">
          <div className="mon-head-row">
            <span>Машина</span>
            <span>Клиент / оплата</span>
            <span>Этап</span>
            <span>Въезд</span>
            <span>Всего</span>
            <span>Простой</span>
            <span>Причина</span>
            <span>Дедлайн</span>
          </div>
          {rows.map((r) => <MonitorRow key={r.job.id} row={r} clock={clock} onOpen={onOpen} />)}
        </div>
      )}

      <p className="mon-footnote">
        Простой пока оценивается приблизительно — по дате заведения, старту ремонта и заказам
        деталей. Точность вырастет сама по мере накопления истории переходов.
      </p>
    </div>
  );
}

function MonitorRow({ row, clock, onOpen }) {
  const { job } = row;
  const meta = STAGE_META[row.stageKey] || STAGE_META.queue;
  const dl = job.deadline ? DEADLINE_META[deadlineState(job, clock)] : null;
  const insurance = isInsurance(job);
  const payLabel = PAYMENT_SHORT[job.payment_type] || (insurance ? 'Страховая' : 'Клиент');

  return (
    <div
      className="mon-row"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(job.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(job.id); } }}
      title="Открыть карточку машины"
    >
      <div className="mon-c mon-c-car">
        <span className="mon-car-model">{job.car_model || 'Без марки'}</span>
        <span className="mon-car-sub">
          {job.plate_number && <span className="mon-plate">{job.plate_number}</span>}
          {job.order_number && <span className="mon-order">ЗН {job.order_number}</span>}
        </span>
      </div>
      <div className="mon-c mon-c-client">
        <span className="mon-client-name">{job.client_name || '—'}</span>
        <span className={`mon-pay${insurance ? ' is-insurance' : ''}`}>{payLabel}</span>
      </div>
      <div className="mon-c mon-c-stage">
        <span
          className="mon-stage"
          style={{
            color: meta.color,
            borderColor: `color-mix(in srgb, ${meta.color} 45%, transparent)`,
            background: `color-mix(in srgb, ${meta.color} 11%, transparent)`,
          }}
        >
          <Icon name={meta.icon} size={12} />{row.stageLabel}
        </span>
      </div>
      <div className="mon-c mon-c-entry">{dd(job.created_at)}</div>
      <div className="mon-c mon-c-total">{row.totalDays} дн</div>
      <div className={`mon-c mon-c-idle is-${row.severity}`}>
        {row.ranked ? (
          <>
            <span className="mon-idle-num">{row.idleDays}</span>
            <span className="mon-idle-dot" />
          </>
        ) : (
          <span className="mon-idle-none">·</span>
        )}
      </div>
      <div className={`mon-c mon-c-cause${row.cause === '—' ? ' is-muted' : ''}`}>
        {row.stageKey === 'repair' ? 'в работе' : row.cause}
      </div>
      <div className="mon-c mon-c-deadline">
        {job.deadline ? (
          <span className={`mon-deadline${dl ? ` ${dl.cls}` : ''}`} title={dl?.hint}>
            {dd(job.deadline)}{dl && <b>{dl.mark}</b>}
          </span>
        ) : '—'}
      </div>
      {/* Телефон: даты и дедлайн одной строкой (колонки выше на нём спрятаны) */}
      <div className="mon-c mon-c-mobilemeta">
        въезд {dd(job.created_at)} · всего {row.totalDays} дн
        {job.deadline && <> · сдача {dd(job.deadline)}{dl ? ` ${dl.mark}` : ''}</>}
      </div>
    </div>
  );
}
