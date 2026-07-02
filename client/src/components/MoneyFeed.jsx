import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { money } from '../orderDoc';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../finance';

const todayInput = () => dayjs().format('YYYY-MM-DD');

const KIND_ICON = { prepayment: '🪙', invoice_paid: '💳', income: '➕', expense: '➖' };
const KIND_BADGE = { prepayment: 'предоплата', invoice_paid: 'оплата счёта', income: 'доход', expense: 'расход' };

// «Лента» — the cash-flow view: every money event (предоплаты, оплаты счетов,
// траты, прочие доходы) in one chronological feed, grouped by day, plus the
// add-expense/income form. `cash` comes from computeCashFlow (already filtered
// to the parent's period). Derived events (payments) are confirmed/undone on
// the «Машины» sub-tab; only manual transactions can be deleted here.
export default function MoneyFeed({ cash, onTxChanged }) {
  const [form, setForm] = useState({ direction: 'expense', category: EXPENSE_CATEGORIES[0], amount: '', date: todayInput(), note: '' });
  const [busy, setBusy] = useState(false);

  const categories = form.direction === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  function patchForm(patch) {
    setForm((f) => {
      const next = { ...f, ...patch };
      if (patch.direction) {
        const list = patch.direction === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
        if (!list.includes(next.category)) next.category = list[0];
      }
      return next;
    });
  }

  async function addTx() {
    const amount = Number(form.amount) || 0;
    if (amount <= 0 || !form.date) return;
    setBusy(true);
    try {
      await api.transactions.create({ ...form, amount });
      setForm((f) => ({ ...f, amount: '', note: '' }));
      onTxChanged();
    } catch {
      alert('Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  async function removeTx(id) {
    if (!window.confirm('Удалить эту запись?')) return;
    try { await api.transactions.remove(id); onTxChanged(); } catch { /* сеть/правила */ }
  }

  // Group the period's events by calendar day (feed is already sorted desc).
  const days = useMemo(() => {
    const m = new Map();
    for (const e of cash.inPeriod) {
      const k = dayjs(e.ts).format('YYYY-MM-DD');
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return [...m.entries()];
  }, [cash.inPeriod]);

  return (
    <div className="fin">
      <div className="hist-cards">
        <div className="hist-card hist-card-success">
          <div className="hist-card-label">Приход за период</div>
          <div className="hist-card-value">{money(cash.income)}</div>
        </div>
        <div className="hist-card hist-card-danger">
          <div className="hist-card-label">Расход за период</div>
          <div className="hist-card-value">{money(cash.expense)}</div>
        </div>
        <div className={`hist-card ${cash.saldo >= 0 ? 'hist-card-success' : 'hist-card-danger'}`}>
          <div className="hist-card-label">Сальдо (приход − расход)</div>
          <div className="hist-card-value">{money(cash.saldo)}</div>
        </div>
        <div className="hist-card hist-card-danger">
          <div className="hist-card-label">Долг клиентов (всего)</div>
          <div className="hist-card-value">{money(cash.outstanding)}</div>
          <div className="hist-card-sub">{cash.outstandingCount} неоплаченных счетов · с учётом предоплат</div>
        </div>
      </div>

      <div className="fin-expenses">
        <h3>Добавить трату или доход</h3>
        <p className="panel-hint">Аренда, зарплаты, налоги, закупки — всё, что не привязано к машинам. Оплаты по машинам подтверждаются на вкладке «Машины» и попадают в ленту сами.</p>
        <div className="fin-tx-form">
          <select value={form.direction} onChange={(e) => patchForm({ direction: e.target.value })}>
            <option value="expense">Расход</option>
            <option value="income">Доход</option>
          </select>
          <select value={form.category} onChange={(e) => patchForm({ category: e.target.value })}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="number" min="0" placeholder="Сумма, ₽" value={form.amount} onChange={(e) => patchForm({ amount: e.target.value })} />
          <input type="date" value={form.date} onChange={(e) => patchForm({ date: e.target.value })} />
          <input type="text" placeholder="Комментарий (необязательно)" value={form.note} onChange={(e) => patchForm({ note: e.target.value })} />
          <button className="primary" disabled={busy || !(Number(form.amount) > 0)} onClick={addTx}>{busy ? '…' : 'Добавить'}</button>
        </div>
      </div>

      <h3 style={{ marginTop: 18 }}>Лента движения денег</h3>
      {days.length === 0 ? (
        <div className="hist-chart-empty">
          За этот период движений нет. Подтвердите оплату или предоплату на вкладке «Машины» — и они появятся здесь.
        </div>
      ) : (
        days.map(([day, evs]) => (
          <div key={day}>
            <div className="feed-day-head">{dayjs(day).format('D MMMM, dddd')}</div>
            <div className="fin-tx-list">
              {evs.map((e) => (
                <div className="fin-tx-row" key={e.id}>
                  <span className="feed-ico">{KIND_ICON[e.kind] || '•'}</span>
                  <span className={`fin-tx-badge ${e.direction === 'income' ? 'is-income' : 'is-expense'}`}>{KIND_BADGE[e.kind] || e.kind}</span>
                  <span className="fin-tx-cat">{e.title}{e.sub ? <span className="fin-tx-note"> · {e.sub}</span> : ''}</span>
                  <span className={`fin-tx-amount ${e.direction === 'income' ? 'is-gain' : 'is-loss'}`}>
                    {e.direction === 'income' ? '+' : '−'}{money(e.amount)}
                  </span>
                  {e.tx_id
                    ? <button className="fin-tx-del" title="Удалить" onClick={() => removeTx(e.tx_id)}>×</button>
                    : <span className="fin-tx-del-spacer" />}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
