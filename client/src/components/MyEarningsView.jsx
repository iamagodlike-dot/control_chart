import Icon from './Icon';

// Presentational half of the master's «Мой заработок» screen — pure props, no
// Firestore. Fed live by <MyEarnings>, and identically by earnings-demo.jsx with
// seed data. Shows ТОЛЬКО деньги этого мастера — маржа/себестоимость не раскрывается.

const fmt = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ₽`;

export default function MyEarningsView({ loading, hasMaster, isFixed, pay, cards, totals }) {
  if (loading) {
    return (
      <div className="mw">
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      </div>
    );
  }

  // Логин мастера не привязан к записи в «Мастера» — своих денег определить нельзя.
  if (!hasMaster) {
    return (
      <div className="mw">
        <div className="mw-empty">
          <Icon name="user" size={28} />
          <p>Ваш логин ещё не привязан к мастеру.</p>
          <p className="mw-empty-sub">Попросите управленца открыть «Настройки → Сотрудники и доступ» и указать вас как мастера — тогда здесь появится ваш заработок.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mw">
      <div className="mw-head">
        <div className="mw-title">
          <h2>Мой заработок</h2>
          <p>Сколько вы получаете за свои машины</p>
        </div>
      </div>

      {isFixed ? (
        <div className="me-summary">
          <div className="me-tile"><div className="me-tile-label">Оклад за месяц</div><div className="me-tile-value">{fmt(pay.salary)}</div></div>
          <div className="me-tile is-advance"><div className="me-tile-label">Аванс (гарантированный)</div><div className="me-tile-value">{fmt(pay.advance)}</div></div>
        </div>
      ) : (
        <div className="me-summary">
          <div className="me-tile is-ready"><div className="me-tile-label">Готово к выплате</div><div className="me-tile-value">{fmt(totals.ready)}</div></div>
          <div className="me-tile"><div className="me-tile-label">Ещё в работе</div><div className="me-tile-value">{fmt(totals.inProgress)}</div></div>
          <div className="me-tile is-advance"><div className="me-tile-label">Аванс (гарантированный)</div><div className="me-tile-value">{fmt(pay.advance)}</div></div>
        </div>
      )}

      <p className="me-note">
        {isFixed
          ? 'У вас оклад — оплата не зависит от количества машин. '
          : 'Сумма за машину идёт «к выплате», когда вы закрыли свои этапы по ней. '}
        Аванс выдают 15–20 числа, окончательный расчёт — 1–5 числа следующего месяца.
      </p>

      {cards.length === 0 ? (
        <div className="mw-empty">
          <Icon name="wallet" size={28} />
          <p>Пока нет машин с оплатой.</p>
          <p className="mw-empty-sub">Когда управленец назначит вас на машину и укажет сумму — она появится здесь.</p>
        </div>
      ) : (
        <div>
          {cards.map((c) => (
            <div key={c.jobId} className={`me-card${!isFixed && c.ready ? ' is-ready' : ''}`}>
              <div>
                <div className="me-car-line">
                  <span className="me-model">{c.car}</span>
                  {c.plate && <span className="me-plate">{c.plate}</span>}
                </div>
                {(c.orderNum || c.client) && (
                  <div className="me-car-sub">
                    {c.orderNum ? `ЗН № ${c.orderNum}` : ''}{c.orderNum && c.client ? ' · ' : ''}{c.client || ''}
                  </div>
                )}
              </div>
              <div className="me-right">
                {isFixed ? (
                  <span className={`me-status ${c.ready ? 'is-ready' : 'is-work'}`}>{c.ready ? 'работа сделана' : 'в работе'}</span>
                ) : (
                  <>
                    {c.hasAmount
                      ? <div className="me-amount">{fmt(c.amount)}</div>
                      : <div className="me-amount is-empty">сумма не указана</div>}
                    <span className={`me-status ${c.ready ? 'is-ready' : 'is-work'}`}>{c.ready ? 'готово к выплате' : 'в работе'}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
