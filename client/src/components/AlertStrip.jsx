import Icon from './Icon';

// «Требует внимания» — dispatcher risk strip. Counters (`alerts`) are computed
// from live jobs/stages by the Gantt and passed in; this component only renders.
export default function AlertStrip({ alerts, shift }) {
  return (
    <div className="alert-strip">
      <div className="alert-strip-title">
        <Icon name="warning" size={15} strokeWidth={1.8} />
        <span>Требует внимания</span>
      </div>
      <div className="alert-strip-pills">
        {alerts.length === 0 ? (
          <span className="alert-strip-calm">
            <span className="alert-dot" style={{ background: 'var(--done)', boxShadow: '0 0 8px var(--done)' }} />
            Всё под контролем
          </span>
        ) : (
          alerts.map((a) => (
            <span key={a.key} className="alert-pill" style={{ '--ac': a.color }}>
              <span className={`alert-dot${a.pulse ? ' is-pulse' : ''}`} />
              <b>{a.count}</b>
              <span className="alert-pill-label">{a.label}</span>
            </span>
          ))
        )}
      </div>
      {shift && (
        <div className="alert-shift">
          <span className="alert-dot" style={{ background: 'var(--done)', boxShadow: '0 0 8px var(--done)' }} />
          {shift}
        </div>
      )}
    </div>
  );
}
