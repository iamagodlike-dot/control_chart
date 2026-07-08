import { money } from '../parts';
import Icon from './Icon';

// Presentational half of the owner's «Траты сотрудников» screen — pure props.
// The real screen (StaffExpenses) feeds live data; the demo feeds seed data.
const PERIODS = [
  { id: 'month', label: 'Этот месяц' },
  { id: 'all', label: 'Всё время' },
];

const personLabel = (e) => e.created_by_name || e.created_by || '—';

export default function StaffExpensesView({
  loading, expenses, total, count, byPerson, period, onPeriod, onRemove, busy,
}) {
  return (
    <div className="stx">
      <div className="stx-head">
        <div className="stx-title">
          <h2>Траты сотрудников</h2>
          <p>Что потратили сотрудники по работе — для сверки и возмещения</p>
        </div>
        <div className="stx-periods">
          {PERIODS.map((p) => (
            <button key={p.id} className={`stx-period${period === p.id ? ' active' : ''}`} onClick={() => onPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stx-summary">
        <div className="stx-sum-total">
          <span>Итого {period === 'month' ? 'за месяц' : 'за всё время'}</span>
          <b>{money(total)}</b>
          <em>{count} {count === 1 ? 'трата' : 'трат'}</em>
        </div>
        {byPerson.length > 0 && (
          <div className="stx-people">
            {byPerson.map((r) => (
              <div key={r.key} className="stx-person">
                <span className="stx-person-name">{r.name || r.key}</span>
                <span className="stx-person-sum">{money(r.total)}</span>
                <span className="stx-person-cnt">{r.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      ) : expenses.length === 0 ? (
        <div className="stx-empty">
          <Icon name="receipt" size={26} />
          <p>{period === 'month' ? 'В этом месяце трат ещё нет.' : 'Трат пока нет.'}</p>
        </div>
      ) : (
        <ul className="stx-list">
          {expenses.map((e) => (
            <li key={e.id} className="stx-item">
              <span className="stx-date">{e.date || ''}</span>
              <span className="stx-who" title={e.created_by || ''}>{personLabel(e)}</span>
              <span className="stx-cat">{e.category || 'Прочее'}</span>
              <span className="stx-note">{e.note || <span className="stx-note-empty">без комментария</span>}</span>
              <span className="stx-amount">{money(e.amount)}</span>
              <button
                className="stx-del"
                title="Удалить трату"
                disabled={busy === e.id}
                onClick={() => onRemove(e.id)}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
