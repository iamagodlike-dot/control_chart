import { EXPENSE_CATEGORIES } from '../expenses';
import { money } from '../parts';
import Icon from './Icon';

// Presentational half of «Мои траты» — pure props, no Firestore. The real screen
// (MyExpenses) feeds live data; the demo feeds seed data. Same markup for both.
export default function MyExpensesView({
  loading, expenses, total, monthTotal, form, onFormChange, onAdd, onRemove, busy, error,
}) {
  const canAdd = (Number(form.amount) || 0) > 0;

  return (
    <div className="exp">
      <div className="exp-head">
        <div className="exp-title">
          <h2>Мои траты</h2>
          <p>Что вы потратили по работе — руководитель это видит</p>
        </div>
        <div className="exp-totals">
          <div className="exp-total"><span>За этот месяц</span><b>{money(monthTotal)}</b></div>
          <div className="exp-total is-muted"><span>Всего</span><b>{money(total)}</b></div>
        </div>
      </div>

      <div className="exp-add">
        <div className="exp-add-row">
          <div className="exp-field exp-field--amount">
            <label>Сумма, ₽</label>
            <input
              type="number" inputMode="numeric" min="0" placeholder="0"
              value={form.amount}
              onChange={(e) => onFormChange({ ...form, amount: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && canAdd) onAdd(); }}
            />
          </div>
          <div className="exp-field">
            <label>Категория</label>
            <select value={form.category} onChange={(e) => onFormChange({ ...form, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="exp-field exp-field--note">
            <label>Комментарий</label>
            <input
              type="text" placeholder="на что потрачено"
              value={form.note}
              onChange={(e) => onFormChange({ ...form, note: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && canAdd) onAdd(); }}
            />
          </div>
          <button className="exp-add-btn" disabled={!canAdd || busy === 'add'} onClick={onAdd}>
            <Icon name="plus" size={16} />Добавить
          </button>
        </div>
        {error ? <div className="auth-error">{error}</div> : null}
      </div>

      {loading ? (
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      ) : expenses.length === 0 ? (
        <div className="exp-empty">
          <Icon name="wallet" size={26} />
          <p>Трат пока нет. Добавьте первую тратой выше.</p>
        </div>
      ) : (
        <ul className="exp-list">
          {expenses.map((e) => (
            <li key={e.id} className="exp-item">
              <span className="exp-date">{e.date || ''}</span>
              <span className="exp-cat">{e.category || 'Прочее'}</span>
              <span className="exp-note">{e.note || <span className="exp-note-empty">без комментария</span>}</span>
              <span className="exp-amount">{money(e.amount)}</span>
              <button
                className="exp-del"
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
