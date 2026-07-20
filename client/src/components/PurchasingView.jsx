import { money } from '../parts';
import Icon from './Icon';

// Presentational half of «Закупки» — pure props. Top list = approved requests to
// buy (enter price → «Куплено»); below = recently purchased, for reassurance.
export default function PurchasingView({ loading, toBuy, bought, prices, onPriceChange, onBuy, busy, error }) {
  return (
    <div className="req">
      <div className="req-head">
        <div className="req-title">
          <h2>Закупки</h2>
          <p>Одобренные заявки к покупке. Отметьте «куплено» и цену — сумма попадёт в ваши траты</p>
        </div>
      </div>

      {error ? <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div> : null}

      {loading ? (
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      ) : toBuy.length === 0 ? (
        <div className="req-empty">
          <Icon name="cart" size={26} />
          <p>Нет одобренных заявок к покупке.</p>
        </div>
      ) : (
        <ul className="req-list">
          {toBuy.map((r) => {
            const price = Number(prices[r.id]) || 0;
            return (
              <li key={r.id} className="req-item">
                <div className="req-main">
                  <div className="req-name">
                    {r.item_name} · {r.qty} {r.unit || ''}
                    {r.urgent ? <span className="req-flag">срочно</span> : null}
                  </div>
                  <div className="req-meta">
                    <span className="req-num">{r.number || '—'}</span>
                    {r.for_job_label ? <span>· для {r.for_job_label}</span> : null}
                    {r.created_by_name || r.created_by ? <span>· {r.created_by_name || r.created_by}</span> : null}
                    {r.comment ? <span>· {r.comment}</span> : null}
                  </div>
                </div>
                <div className="req-buy">
                  <input
                    type="number" inputMode="numeric" min="0" placeholder="цена, ₽"
                    value={prices[r.id] ?? ''}
                    onChange={(e) => onPriceChange(r.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && price > 0) onBuy(r.id); }}
                  />
                  <button className="exp-add-btn" disabled={busy === r.id || price <= 0} onClick={() => onBuy(r.id)}>
                    <Icon name="check" size={16} />Куплено
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {bought.length > 0 && (
        <>
          <div className="req-subhead">Недавно куплено</div>
          <ul className="req-list">
            {bought.map((r) => (
              <li key={r.id} className="req-item is-done">
                <div className="req-main">
                  <div className="req-name">{r.item_name} · {r.qty} {r.unit || ''}</div>
                  <div className="req-meta">
                    <span className="req-num">{r.number || '—'}</span>
                    {r.for_job_label ? <span>· для {r.for_job_label}</span> : null}
                  </div>
                </div>
                <span className="req-amount">{money(r.purchased_price)}</span>
                <span className="req-badge req-badge--done">куплено</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
