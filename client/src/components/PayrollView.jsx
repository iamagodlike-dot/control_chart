import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { money } from '../orderDoc';
import { computePayroll, PAYROLL_CATEGORY } from '../payroll';
import Icon from './Icon';

const todayInput = () => dayjs().format('YYYY-MM-DD');

// «Зарплата» — расчёты с мастерами. Начислено берётся из себестоимости машин
// (финальные суммы «К выплате», введённые вручную), выплачено — из
// транзакций-выплат с master_id.
// Выплата создаёт обычную транзакцию-расход: она видна в ленте движения денег,
// но НЕ задваивает расход в P&L (труд уже входит в себестоимость ремонтов).
export default function PayrollView({ jobs, transactions, masters, company, period, periodLabel, onTxChanged }) {
  const [openKey, setOpenKey] = useState(null);
  const [payFor, setPayFor] = useState(null); // row, для которой открыта форма выплаты
  const [payForm, setPayForm] = useState({ amount: '', date: todayInput(), note: '' });
  const [busy, setBusy] = useState(false);

  const payroll = useMemo(
    () => computePayroll({ jobs, transactions, masters, company, period }),
    [jobs, transactions, masters, company, period],
  );

  function startPayout(row) {
    setPayFor(row);
    setPayForm({ amount: row.balance > 0 ? String(row.balance) : '', date: todayInput(), note: '' });
  }

  async function submitPayout() {
    const amount = Number(payForm.amount) || 0;
    if (!(amount > 0) || !payForm.date || !payFor) return;
    // Выплата возможна только мастеру из справочника — иначе её не с чем
    // сматчить (старые расчёты с именем без id матчатся по имени).
    const masterId = payFor.master_id || masters.find((m) => (m.name || '').trim().toLowerCase() === payFor.name.trim().toLowerCase())?.id;
    if (!masterId) {
      alert('Этот мастер не найден в справочнике. Добавьте его в «Настройки → Мастера», чтобы фиксировать выплаты.');
      return;
    }
    setBusy(true);
    try {
      await api.transactions.create({
        direction: 'expense',
        category: PAYROLL_CATEGORY,
        amount,
        date: payForm.date,
        note: payForm.note,
        master_id: masterId,
        master_name: payFor.name,
      });
      setPayFor(null);
      onTxChanged();
    } catch {
      alert('Не удалось сохранить выплату. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  async function removePayout(id) {
    if (!window.confirm('Удалить эту выплату? Долг мастера увеличится на её сумму.')) return;
    try { await api.transactions.remove(id); onTxChanged(); } catch { /* сеть/правила */ }
  }

  return (
    <div className="fin">
      <div className="hist-cards">
        <div className="hist-card">
          <div className="hist-card-label">Начислено · {periodLabel.toLowerCase()}</div>
          <div className="hist-card-value">{money(payroll.totals.accrued)}</div>
          <div className="hist-card-sub">суммы «К выплате» из себестоимости машин</div>
        </div>
        <div className="hist-card hist-card-success">
          <div className="hist-card-label">Выплачено · {periodLabel.toLowerCase()}</div>
          <div className="hist-card-value">{money(payroll.totals.paid)}</div>
        </div>
        <div className={`hist-card ${payroll.totals.balance > 0 ? 'hist-card-danger' : ''}`}>
          <div className="hist-card-label">Долг мастерам (всего)</div>
          <div className="hist-card-value">{money(payroll.totals.balance)}</div>
          <div className="hist-card-sub">начислено − выплачено за всё время</div>
        </div>
      </div>

      {payroll.rows.length === 0 ? (
        <div className="hist-chart-empty">
          Пока нет начислений мастерам. Укажите суммы «К выплате» мастерам в «Себестоимости» машины — начисления появятся здесь.
        </div>
      ) : (
        <div className="payroll-list">
          {payroll.rows.map((r) => {
            const opened = openKey === r.key;
            return (
              <div className={`payroll-row${opened ? ' is-open' : ''}`} key={r.key}>
                <button className="payroll-row-head" onClick={() => setOpenKey(opened ? null : r.key)}>
                  <span className="payroll-ico"><Icon name="user" size={16} /></span>
                  <span className="payroll-name">{r.name}</span>
                  <span className="payroll-chips">
                    <span className="payroll-chip"><em>Начислено</em> {money(r.accrued)}</span>
                    <span className="payroll-chip"><em>Выплачено</em> {money(r.paid)}</span>
                  </span>
                  <span className={`payroll-balance ${r.balance > 0 ? 'is-debt' : 'is-clear'}`}>
                    {r.balance > 0 ? `долг ${money(r.balance)}` : (r.balance < 0 ? `аванс ${money(-r.balance)}` : 'рассчитан')}
                  </span>
                  <span className="payroll-caret"><Icon name="chevron-down" size={15} /></span>
                </button>

                {opened && (
                  <div className="payroll-row-body">
                    <div className="payroll-detail">
                      <div className="payroll-detail-col">
                        <div className="payroll-detail-title">Наряды за период</div>
                        {r.cars.length === 0 ? (
                          <div className="cc-hint">За выбранный период начислений нет.</div>
                        ) : (
                          r.cars.map((c2) => (
                            <div className="payroll-detail-row" key={`${c2.job_id}`}>
                              <span className="payroll-detail-main">
                                {c2.label}{c2.order_number ? ` · №${c2.order_number}` : ''}
                                <span className="payroll-detail-sub">
                                  {dayjs(c2.date).format('DD.MM.YYYY')}
                                  {c2.works_sum > 0 ? ` · работы по наряду ${money(c2.works_sum)}` : ''}
                                </span>
                              </span>
                              <span className="payroll-detail-amount">{money(c2.amount)}</span>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="payroll-detail-col">
                        <div className="payroll-detail-title">Выплаты за период</div>
                        {r.payouts.length === 0 ? (
                          <div className="cc-hint">Выплат за выбранный период нет.</div>
                        ) : (
                          r.payouts.map((p) => (
                            <div className="payroll-detail-row" key={p.id}>
                              <span className="payroll-detail-main">
                                {dayjs(p.ts).format('DD.MM.YYYY')}
                                {p.note && <span className="payroll-detail-sub">{p.note}</span>}
                              </span>
                              <span className="payroll-detail-amount">− {money(p.amount)}</span>
                              <button className="fin-tx-del" title="Удалить выплату" onClick={() => removePayout(p.id)}>×</button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {payFor?.key === r.key ? (
                      <div className="payroll-payform">
                        <input
                          type="number" min="0" placeholder="Сумма, ₽" autoFocus
                          value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                        />
                        <input type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
                        <input
                          type="text" placeholder="Комментарий (необязательно)"
                          value={payForm.note} onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))}
                        />
                        <button className="primary" disabled={busy || !(Number(payForm.amount) > 0)} onClick={submitPayout}>
                          {busy ? '…' : 'Выплатить'}
                        </button>
                        <button onClick={() => setPayFor(null)}>Отмена</button>
                      </div>
                    ) : (
                      <div className="payroll-actions">
                        <button className="primary small cc-btn-ico" onClick={() => startPayout(r)}>
                          <Icon name="wallet" size={14} />Выплатить{r.balance > 0 ? ` ${money(r.balance)}` : ''}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
