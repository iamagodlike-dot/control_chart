import Icon from './Icon';
import { INTAKE_SORTS } from '../intake';
import { PAYMENT_SHORT } from '../insurance';

// Презентационная половина экрана «Приёмка авто»: чистые пропсы, без Firestore.
// Реальный экран (Intake) кормит её живой подпиской, демо-страница — сидом,
// поэтому обе рисуют побуквенно одно и то же. Вся логика — в intake.js.

function pluralRu(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// Подпись «сколько стоит»: у только что заехавшей машины «сегодня» честнее, чем «0 дней».
const waitLabel = (d) => (d <= 0 ? 'сегодня' : `${d} ${pluralRu(d, 'день', 'дня', 'дней')}`);

// Полоска прогресса. Красная, только когда не хватает ОБЯЗАТЕЛЬНОГО, — иначе
// «7 из 8» с необязательной рубрикой выглядело бы как недоделка.
function Bar({ label, done, total, blocked }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="ink-bar">
      <span className="ink-bar-label">{label}</span>
      <span className="ink-bar-track">
        <span
          className={`ink-bar-fill${blocked ? ' is-blocked' : ''}${done >= total ? ' is-full' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="ink-bar-num">{done}/{total}</span>
    </div>
  );
}

function StatusChip({ status }) {
  if (status.skipped) return <span className="ink-chip is-skipped">Без приёмки</span>;
  if (status.done) return <span className="ink-chip is-done"><Icon name="check" size={12} strokeWidth={2.4} />Принята</span>;
  if (status.ready) return <span className="ink-chip is-ready">Можно закрывать</span>;
  if (status.untouched) return <span className="ink-chip is-new">Не начата</span>;
  return <span className="ink-chip">В работе</span>;
}

function Card({ row, onOpen }) {
  const { status } = row;
  const insured = row.payment_type === 'insurance';
  // Первые три блокера — этого хватает, чтобы понять, за чем идти к машине;
  // полный список приёмщик увидит, когда откроет карточку.
  const preview = status.blockers.slice(0, 3);
  const rest = status.blockers.length - preview.length;

  return (
    <button type="button" className={`ink-card is-${row.severity}`} onClick={() => onOpen(row.id)}>
      <div className="ink-card-top">
        <div className="ink-card-id">
          {row.plate_number && <span className="ink-plate">{row.plate_number}</span>}
          <span className="ink-model">{row.car_model}</span>
        </div>
        <StatusChip status={status} />
      </div>

      <div className="ink-card-meta">
        {row.client_name && <span><Icon name="user" size={12} />{row.client_name}</span>}
        <span className={insured ? 'is-insured' : ''}>
          <Icon name={insured ? 'shield' : 'wallet'} size={12} />
          {insured ? (row.insurer_name || 'Страховая') : PAYMENT_SHORT[row.payment_type] || 'Клиент'}
        </span>
        <span className={`ink-days is-${row.severity}`}>
          <Icon name="clock" size={12} />на площадке {waitLabel(row.daysWaiting)}
        </span>
      </div>

      <div className="ink-card-bars">
        <Bar
          label="Чек-лист"
          done={status.checklist.done}
          total={status.checklist.total}
          blocked={status.checklistMissing.length > 0}
        />
        <Bar
          label="Фото"
          done={status.photos.done}
          total={status.photos.total}
          blocked={status.photosMissing.length > 0}
        />
      </div>

      {status.damages > 0 && (
        <div className="ink-card-damages">
          <Icon name="warning" size={12} />
          отмечено повреждений: <b>{status.damages}</b>
        </div>
      )}

      {!status.done && !status.skipped && preview.length > 0 && (
        <div className="ink-card-todo">
          <span className="ink-card-todo-h">Осталось</span>
          {preview.join(' · ')}{rest > 0 ? ` · ещё ${rest}` : ''}
        </div>
      )}

      <span className="ink-card-go">Открыть приёмку →</span>
    </button>
  );
}

export default function IntakeView({
  loading = false,
  rows = [],
  counts = {},
  query = '',
  onQuery = () => {},
  sort = 'urgent',
  onSort = () => {},
  onOpen = () => {},
}) {
  return (
    <div className="ink">
      <div className="ink-head">
        <div className="ink-title">
          <h2><Icon name="clipboard" size={18} />Приёмка авто</h2>
          <p>Машины на осмотре: зафиксировать состояние до начала ремонта</p>
        </div>
        <div className="ink-summary">
          <span className="ink-stat">на осмотре <b>{counts.total ?? 0}</b></span>
          {counts.ready > 0 && <span className="ink-stat is-ready">можно закрывать: <b>{counts.ready}</b></span>}
          {counts.alert > 0 && <span className="ink-stat is-bad">стоят без приёмки: <b>{counts.alert}</b></span>}
        </div>
      </div>

      <div className="ink-tools">
        <label className="ink-search">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Госномер, модель или клиент"
            aria-label="Поиск машины"
          />
          {query && (
            <button type="button" onClick={() => onQuery('')} aria-label="Очистить поиск">
              <Icon name="x" size={14} />
            </button>
          )}
        </label>
        <select value={sort} onChange={(e) => onSort(e.target.value)} aria-label="Сортировка">
          {INTAKE_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      ) : rows.length === 0 ? (
        <div className="ink-empty">
          <Icon name="clipboard" size={40} />
          <div className="ink-empty-title">
            {query ? 'Ничего не нашлось' : 'Сейчас машин на осмотре нет'}
          </div>
          <div className="ink-empty-text">
            {query
              ? 'Попробуйте другой госномер или имя клиента.'
              : 'Сюда попадают машины из колонки «Осмотр / дефектовка» доски «Согласование» — сразу как их заводят в систему.'}
          </div>
        </div>
      ) : (
        <div className="ink-grid">
          {rows.map((row) => <Card key={row.id} row={row} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}
