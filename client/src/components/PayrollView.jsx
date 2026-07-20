import dayjs from 'dayjs';
import Icon from './Icon';

// Presentational half of the owner's «Зарплата мастерам» screen — pure props.
// Fed live by <Payroll> and identically by payroll-demo.jsx. Shows, per master,
// сколько заработано (готовые машины / оклад), выдано в этом месяце и сколько
// осталось выплатить; кнопки записывают аванс / окончательный расчёт.

const fmt = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ₽`;

const BANNER = {
  advance: { cls: 'is-active', text: 'период выдачи аванса (15–20 числа)' },
  settlement: { cls: 'is-active', text: 'период окончательного расчёта (1–5 числа)' },
  none: { cls: '', text: 'аванс — 15–20 числа, окончательный расчёт — 1–5 числа следующего месяца' },
};

export default function PayrollView({ loading, rows, payWindow, totals, payments, now, busy, onRecord, onRemovePayment }) {
  if (loading) {
    return <div className="mw"><div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div></div>;
  }
  const banner = BANNER[payWindow] || BANNER.none;

  return (
    <div className="mw">
      <div className="mw-head">
        <div className="mw-title">
          <h2>Зарплата мастерам</h2>
          <p>Кому и сколько выплатить</p>
        </div>
      </div>

      <div className={`pr-banner ${banner.cls}`}>
        <Icon name="calendar" size={15} />
        <span>Сегодня {dayjs(now).format('D MMMM')} — {banner.text}.</span>
      </div>

      <div className="me-summary">
        <div className="me-tile is-ready"><div className="me-tile-label">К выплате всего</div><div className="me-tile-value">{fmt(totals.owed)}</div></div>
        <div className="me-tile"><div className="me-tile-label">Выдано в этом месяце</div><div className="me-tile-value">{fmt(totals.paidThisMonth)}</div></div>
      </div>

      {rows.length === 0 ? (
        <div className="mw-empty">
          <Icon name="wallet" size={28} />
          <p>Пока некого рассчитывать.</p>
          <p className="mw-empty-sub">Назначьте мастеров на машины и укажите суммы (кнопка «Оплата мастерам» на карточке машины) — расчёт появится здесь.</p>
        </div>
      ) : (
        <div>
          {rows.map((r) => (
            <div key={r.masterId} className="pr-master">
              <div className="pr-master-top">
                <div>
                  <span className="pr-name">{r.name}</span>
                  <span className="pr-tag">{r.isFixed ? 'оклад' : 'сдельная'}</span>
                </div>
                {r.owed > 0
                  ? <span className="pr-num-value" style={{ color: 'var(--color-success)' }}>к выплате {fmt(r.owed)}</span>
                  : <span className="pr-paid-chip"><Icon name="check" size={13} /> рассчитан</span>}
              </div>

              <div className="pr-nums">
                <div className="pr-num">
                  <div className="pr-num-label">{r.isFixed ? 'Оклад за месяц' : 'Заработано (готово)'}</div>
                  <div className="pr-num-value">{fmt(r.earnedReady)}</div>
                </div>
                {!r.isFixed && r.inProgress > 0 && (
                  <div className="pr-num">
                    <div className="pr-num-label">Ещё в работе</div>
                    <div className="pr-num-value" style={{ color: 'var(--color-text-muted)' }}>{fmt(r.inProgress)}</div>
                  </div>
                )}
                <div className="pr-num">
                  <div className="pr-num-label">Выдано в этом месяце</div>
                  <div className="pr-num-value">{fmt(r.paidThisMonth)}</div>
                </div>
                <div className="pr-num is-owed">
                  <div className="pr-num-label">К выплате</div>
                  <div className="pr-num-value">{fmt(r.owed)}</div>
                </div>
              </div>

              <div className="pr-actions">
                {r.advanceGiven ? (
                  <span className="pr-paid-chip"><Icon name="check" size={13} /> аванс выдан</span>
                ) : (
                  <button disabled={busy === r.masterId} onClick={() => onRecord(r, 'advance', r.advance)}>
                    Выдать аванс {fmt(r.advance)}
                  </button>
                )}
                <button
                  className="primary"
                  disabled={busy === r.masterId || r.owed <= 0}
                  onClick={() => onRecord(r, 'settlement', r.owed)}
                >
                  Выплатить остаток {r.owed > 0 ? fmt(r.owed) : ''}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {payments.length > 0 && (
        <div className="pr-history">
          <h3>Последние выплаты</h3>
          <p className="me-note" style={{ margin: '0 0 8px' }}>Нажали случайно? «Отменить» — выплата удалится и здесь, и в «Финансах».</p>
          {payments.slice(0, 12).map((p) => (
            <div key={p.id} className="pr-pay">
              <span className="pr-pay-kind">{p.kind === 'advance' ? 'аванс' : 'расчёт'}</span>
              <span className="pr-pay-name">{p.master_name || '—'}</span>
              <span>{dayjs(p.created_at).format('DD.MM.YYYY')}</span>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(p.amount)}</b>
              <button className="pr-undo" disabled={busy === p.id} onClick={() => onRemovePayment(p.id)}>Отменить</button>
            </div>
          ))}
        </div>
      )}

      <p className="me-note" style={{ marginTop: 16 }}>
        Этот экран — учёт «кому сколько выдали». Сдельная оплата уже входит в себестоимость ремонта
        на «Финансах», поэтому выплаты здесь не добавляются в «Финансы» повторно (иначе прибыль бы задвоилась).
      </p>
    </div>
  );
}
