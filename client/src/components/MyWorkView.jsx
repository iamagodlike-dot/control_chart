import dayjs from 'dayjs';
import Icon from './Icon';

// Presentational half of the master's «Мои машины» screen — pure props, no
// Firestore. Fed live by <MyWork>, and identically by the demo (mywork-demo.jsx)
// with seed data, so the credential-free preview matches the real screen byte-for-byte.

const fmtRange = (start, end) => {
  const s = dayjs(start);
  if (!s.isValid()) return '';
  const e = dayjs(end);
  if (!e.isValid()) return s.format('DD.MM HH:mm');
  return s.isSame(e, 'day')
    ? `${s.format('DD.MM')} · ${s.format('HH:mm')}–${e.format('HH:mm')}`
    : `${s.format('DD.MM HH:mm')} → ${e.format('DD.MM HH:mm')}`;
};

const fmtDay = (d) => { const x = dayjs(d); return x.isValid() ? x.format('DD.MM') : ''; };

export default function MyWorkView({ loading, hasMaster, cards, counts }) {
  if (loading) {
    return (
      <div className="mw">
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      </div>
    );
  }

  // Логин мастера не привязан к записи в «Мастера» — своих машин определить нельзя.
  if (!hasMaster) {
    return (
      <div className="mw">
        <div className="mw-empty">
          <Icon name="user" size={28} />
          <p>Ваш логин ещё не привязан к мастеру.</p>
          <p className="mw-empty-sub">Попросите управленца открыть «Настройки → Сотрудники и доступ» и указать вас как мастера — тогда здесь появятся ваши машины.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mw">
      <div className="mw-head">
        <div className="mw-title">
          <h2>Мои машины</h2>
          <p>Ваши работы и сроки</p>
        </div>
        <div className="mw-chips">
          <span className="mw-chip"><b>{counts.cars}</b> {carsWord(counts.cars)}</span>
          {counts.active > 0 && <span className="mw-chip is-active"><b>{counts.active}</b> в работе</span>}
          {counts.overdue > 0 && <span className="mw-chip is-overdue"><b>{counts.overdue}</b> с задержкой</span>}
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="mw-empty">
          <Icon name="car" size={28} />
          <p>Пока нет назначенных вам работ.</p>
          <p className="mw-empty-sub">Когда управленец поставит вас на машину в графике — она появится здесь.</p>
        </div>
      ) : (
        <div className="mw-list">
          {cards.map((c) => (
            <div
              key={c.jobId}
              className={`mw-card${c.overdue ? ' is-overdue' : c.active ? ' is-active' : ''}${c.done ? ' is-done' : ''}`}
            >
              <div className="mw-car">
                <div className="mw-car-line">
                  <span className="mw-model">{c.car}</span>
                  {c.plate && <span className="mw-plate">{c.plate}</span>}
                  {c.done && <span className="mw-badge-done"><Icon name="check" size={13} />Готово</span>}
                </div>
                <div className="mw-car-sub">
                  {c.orderNum && <span>ЗН № {c.orderNum}</span>}
                  {c.client && <span>{c.client}</span>}
                  {c.deadline && (
                    <span className="mw-deadline"><Icon name="clock" size={12} />срок {fmtDay(c.deadline)}</span>
                  )}
                </div>
              </div>

              <ul className="mw-stages">
                {c.stages.map((s) => (
                  <li key={s.id} className={`mw-stage${s.overdue ? ' is-overdue' : ''}`}>
                    <span className="mw-dot" style={{ background: s.statusColor }} />
                    <span className="mw-stage-name">
                      {s.post}
                      {s.title && s.title !== s.post ? <span className="mw-stage-note">{s.title}</span> : null}
                    </span>
                    <span className="mw-time">{fmtRange(s.start_at, s.end_at)}</span>
                    <span className="mw-status" style={{ color: s.statusColor }}>{s.statusLabel}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// «1 машина / 2 машины / 5 машин» — простое русское склонение для счётчика.
function carsWord(n) {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return 'машина';
  if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return 'машины';
  return 'машин';
}
