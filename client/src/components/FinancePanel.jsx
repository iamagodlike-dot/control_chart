import { money } from '../orderDoc';

// Small stacked-bar breakdown reused for cost parts, payroll, payment types…
// NB: props are NOT named `valueOf`/`labelOf` — `valueOf` collides with
// Object.prototype.valueOf, so a missing prop would resolve to the inherited
// method instead of the default and crash. `getVal`/`getLabel` are safe.
function Breakdown({ title, rows, total, getVal = (r) => r.amount, getLabel = (r) => r.label, showPct = true }) {
  const safeRows = (rows || []).filter((r) => r != null);
  if (!safeRows.length) return null;
  const base = total || safeRows.reduce((s, r) => s + (Number(getVal(r)) || 0), 0);
  return (
    <div className="hist-breakdown">
      <div className="hist-breakdown-title">{title}</div>
      <div className="hist-breakdown-rows">
        {safeRows.map((r) => {
          const v = Number(getVal(r)) || 0;
          const pct = base > 0 ? Math.round((v / base) * 100) : 0;
          return (
            <div className="hist-breakdown-row" key={getLabel(r)}>
              <span className="hist-breakdown-label">{getLabel(r)}</span>
              <div className="hist-breakdown-track"><div className="hist-breakdown-fill" style={{ width: `${pct}%` }} /></div>
              <span className="hist-breakdown-val">{money(v)}{showPct ? ` · ${pct}%` : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// «Обзор» — pure P&L dashboard for the selected period (прибыль, accrual view).
// Cash flow (лента движения денег) and per-car economics live in the sibling
// sub-tabs of the Финансы screen; period/export controls live in the parent.
export default function FinancePanel({ fin, periodLabel }) {
  const topOrders = fin.perOrder.slice(0, 3);
  const lossOrders = fin.perOrder.filter((o) => o.profit < 0).slice(-3).reverse();

  return (
    <div className="fin">
      {/* Чистая прибыль — главный итог */}
      <div className={`fin-hero ${fin.net >= 0 ? 'is-gain' : 'is-loss'}`}>
        <div className="fin-hero-label">Чистая прибыль · {periodLabel.toLowerCase()}</div>
        <div className="fin-hero-value">{money(fin.net)}</div>
        <div className="fin-hero-formula">
          прибыль с ремонтов {money(fin.repairs.profit)} − расходы {money(fin.expenses.total)}
          {fin.otherIncome.total > 0 ? ` + доходы ${money(fin.otherIncome.total)}` : ''}
        </div>
      </div>

      <div className="hist-cards">
        <div className="hist-card">
          <div className="hist-card-label">Выручка (ремонты)</div>
          <div className="hist-card-value">{money(fin.repairs.revenue)}</div>
          <div className="hist-card-sub">{fin.coverage.withCosting} заказов с себестоимостью</div>
        </div>
        <div className="hist-card">
          <div className="hist-card-label">Себестоимость</div>
          <div className="hist-card-value">{money(fin.repairs.cost)}</div>
        </div>
        <div className={`hist-card ${fin.repairs.profit >= 0 ? 'hist-card-success' : 'hist-card-danger'}`}>
          <div className="hist-card-label">Прибыль с ремонтов</div>
          <div className="hist-card-value">{money(fin.repairs.profit)}</div>
          <div className="hist-card-sub">рентабельность {fin.repairs.margin}%</div>
        </div>
        <div className="hist-card hist-card-danger">
          <div className="hist-card-label">Прочие расходы</div>
          <div className="hist-card-value">{money(fin.expenses.total)}</div>
        </div>
        {fin.otherIncome.total > 0 && (
          <div className="hist-card">
            <div className="hist-card-label">Прочие доходы</div>
            <div className="hist-card-value">{money(fin.otherIncome.total)}</div>
          </div>
        )}
      </div>

      <div className="fin-two-col">
        <Breakdown title="Из чего складывается себестоимость" total={fin.repairs.cost} rows={[
          { label: '🔩 Запчасти', amount: fin.repairs.parts },
          { label: '🎨 Материалы', amount: fin.repairs.materials },
          { label: '👷 Оплата мастерам', amount: fin.repairs.labor },
          { label: '🏢 Накладные', amount: fin.repairs.overhead },
        ].filter((r) => r.amount > 0)} />
        <Breakdown title="Выручка по типу оплаты" rows={fin.byPayment} getVal={(r) => r.revenue} getLabel={(r) => r.label} />
      </div>

      <div className="fin-two-col">
        <Breakdown title="Выплаты мастерам (сдельно)" total={fin.repairs.labor} rows={fin.payroll} getVal={(r) => r.amount} getLabel={(r) => `👤 ${r.label}`} />
        {fin.byInsurer.length > 0 && (
          <Breakdown title="По страховым компаниям" rows={fin.byInsurer} getVal={(r) => r.revenue} getLabel={(r) => `🛡 ${r.label}`} />
        )}
      </div>

      {fin.expenses.byCategory.length > 0 && (
        <Breakdown title="Прочие расходы по категориям" total={fin.expenses.total} rows={fin.expenses.byCategory} getVal={(r) => r.amount} getLabel={(r) => r.label} />
      )}

      {(topOrders.length > 0 || lossOrders.length > 0) && (
        <div className="fin-two-col">
          {topOrders.length > 0 && (
            <div className="hist-breakdown">
              <div className="hist-breakdown-title">🏆 Самые прибыльные заказы</div>
              <div className="fin-order-rows">
                {topOrders.map((o) => (
                  <div className="fin-order-row" key={o.id}>
                    <span className="fin-order-name">{o.car_model}{o.plate_number ? ` · ${o.plate_number}` : ''}</span>
                    <span className="fin-order-profit is-gain">{money(o.profit)} · {o.margin}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {lossOrders.length > 0 && (
            <div className="hist-breakdown">
              <div className="hist-breakdown-title">⚠ Убыточные заказы</div>
              <div className="fin-order-rows">
                {lossOrders.map((o) => (
                  <div className="fin-order-row" key={o.id}>
                    <span className="fin-order-name">{o.car_model}{o.plate_number ? ` · ${o.plate_number}` : ''}</span>
                    <span className="fin-order-profit is-loss">{money(o.profit)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
