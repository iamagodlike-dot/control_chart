import Icon from './Icon';

// Presentational half of the экспедитор «Приёмка» screen — pure props, no
// Firestore. The real screen (PartsReceiving) feeds it live data; the demo
// (src/demo/receiving-demo.jsx) feeds it seed data. Keeping the markup here means
// both render byte-for-byte the same thing, so the credential-free preview is faithful.
const FILTERS = [
  { id: 'ordered', label: 'Ждут приёмки' },
  { id: 'in', label: 'На складе' },
  { id: 'all', label: 'Все' },
];

export default function ReceivingView({ loading, groups, counts, filter, onFilter, onSetStatus, busy }) {
  if (loading) {
    return (
      <div className="recv">
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      </div>
    );
  }

  return (
    <div className="recv">
      <div className="recv-head">
        <div className="recv-title">
          <h2>Приёмка запчастей</h2>
          <p>Что приехало и в какую ячейку положить</p>
        </div>
        <div className="recv-filters">
          {FILTERS.map((f) => {
            const n = f.id === 'ordered' ? counts.ordered : f.id === 'in' ? counts.in : counts.total;
            return (
              <button
                key={f.id}
                className={`recv-filter${filter === f.id ? ' active' : ''}`}
                onClick={() => onFilter(f.id)}
              >
                {f.label}<span className="recv-count">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="recv-empty">
          <Icon name="box" size={28} />
          <p>
            {filter === 'ordered' ? 'Нет запчастей, ожидающих приёмки.'
              : filter === 'in' ? 'На складе пока ничего не отмечено.'
              : 'Запчастей в пути и на складе нет.'}
          </p>
        </div>
      ) : (
        <div className="recv-list">
          {groups.map((g) => (
            <div key={g.jobId} className={`recv-card${g.waiting ? ' is-waiting' : ''}`}>
              <div className="recv-car">
                <div className="recv-car-line">
                  <span className="recv-model">{g.car}</span>
                  {g.plate && <span className="recv-plate">{g.plate}</span>}
                </div>
                <div className="recv-car-sub">
                  {g.orderNum && <span>ЗН № {g.orderNum}</span>}
                  {g.client && <span>{g.client}</span>}
                </div>
                <div className={`recv-cell${g.hasCell ? '' : ' is-none'}`}>
                  <Icon name="box" size={14} />
                  {g.hasCell
                    ? <span>Класть в ячейку <b>{g.cellIds.join(', ')}</b></span>
                    : <span>Ячейка не назначена</span>}
                </div>
              </div>

              <ul className="recv-parts">
                {g.parts.map((p) => (
                  <li key={p.id} className="recv-part">
                    <span className="recv-dot" style={{ background: p.statusColor }} />
                    <span className="recv-part-name">
                      {p.name}
                      {p.code ? <span className="recv-part-code">{p.code}</span> : null}
                    </span>
                    {p.supplier
                      ? (
                        <span className="recv-supplier" title="Поставщик — где забрать запчасть">
                          <Icon name="pin" size={13} />{p.supplier}
                        </span>
                      ) : (
                        <span className="recv-supplier is-none" title="Поставщик не указан — уточните у менеджера">
                          <Icon name="pin" size={13} />не указан
                        </span>
                      )}
                    <span className="recv-qty">{p.qty} шт</span>
                    {p.eta && p.status === 'ordered' ? <span className="recv-eta">до {p.eta}</span> : null}
                    {p.status === 'ordered' ? (
                      <button
                        className="recv-arrive"
                        disabled={busy === p.id}
                        onClick={() => onSetStatus(g.jobId, p.id, 'in')}
                      >
                        <Icon name="check" size={14} />Приехало
                      </button>
                    ) : (
                      <span className="recv-instock">
                        <Icon name="check" size={13} />На складе
                        <button
                          className="recv-undo"
                          disabled={busy === p.id}
                          title="Вернуть в «в пути»"
                          onClick={() => onSetStatus(g.jobId, p.id, 'ordered')}
                        >↩</button>
                      </span>
                    )}
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
