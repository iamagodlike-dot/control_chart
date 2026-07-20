import { REQUEST_UNITS, requestStatus, jobLabel } from '../requests';
import Icon from './Icon';

// Presentational half of «Заявки на закупку» — pure props, no Firestore. Same form
// for everyone; the owner additionally gets «одобрить / отклонить» on new requests,
// the author gets «удалить» on their own not-yet-decided ones.
export default function RequestsView({
  isOwner, loading, requests, jobs, form, onFormChange, onAdd, onApprove, onReject, onCancel, busy, error, myEmail,
}) {
  const canAdd = !!form.item_name.trim() && (Number(form.qty) || 0) > 0;

  return (
    <div className="req">
      <div className="req-head">
        <div className="req-title">
          <h2>Заявки на закупку</h2>
          <p>{isOwner
            ? 'Заявки от мастеров и сотрудников — одобряйте, что покупать'
            : 'Что нужно купить для работы — руководитель это одобрит'}</p>
        </div>
      </div>

      <div className="exp-add">
        <div className="exp-add-row">
          <div className="exp-field exp-field--note">
            <label>Что купить</label>
            <input
              type="text" placeholder="напр. грунт акриловый 4:1"
              value={form.item_name}
              onChange={(e) => onFormChange({ ...form, item_name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && canAdd) onAdd(); }}
            />
          </div>
          <div className="exp-field exp-field--amount">
            <label>Сколько</label>
            <input
              type="number" inputMode="numeric" min="0" placeholder="1"
              value={form.qty}
              onChange={(e) => onFormChange({ ...form, qty: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && canAdd) onAdd(); }}
            />
          </div>
          <div className="exp-field">
            <label>Ед.</label>
            <select value={form.unit} onChange={(e) => onFormChange({ ...form, unit: e.target.value })}>
              {REQUEST_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="exp-field">
            <label>Для машины</label>
            <select value={form.for_job_id} onChange={(e) => onFormChange({ ...form, for_job_id: e.target.value })}>
              <option value="">— не привязывать —</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{jobLabel(j)}</option>)}
            </select>
          </div>
        </div>
        <div className="exp-add-row req-add-row2">
          <div className="exp-field exp-field--note">
            <label>Комментарий</label>
            <input
              type="text" placeholder="необязательно"
              value={form.comment}
              onChange={(e) => onFormChange({ ...form, comment: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && canAdd) onAdd(); }}
            />
          </div>
          <label className="req-urgent">
            <input type="checkbox" checked={form.urgent} onChange={(e) => onFormChange({ ...form, urgent: e.target.checked })} />
            Срочно
          </label>
          <button className="exp-add-btn" disabled={!canAdd || busy === 'add'} onClick={onAdd}>
            <Icon name="plus" size={16} />Отправить заявку
          </button>
        </div>
        {error ? <div className="auth-error">{error}</div> : null}
      </div>

      {loading ? (
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      ) : requests.length === 0 ? (
        <div className="req-empty">
          <Icon name="clipboard" size={26} />
          <p>{isOwner ? 'Заявок пока нет.' : 'Вы ещё не отправляли заявок. Создайте первую выше.'}</p>
        </div>
      ) : (
        <ul className="req-list">
          {requests.map((r) => {
            const st = requestStatus(r.status);
            const canModerate = isOwner && r.status === 'new';
            const canCancel = !isOwner && r.status === 'new' && (r.created_by || '') === myEmail;
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
                    {isOwner && (r.created_by_name || r.created_by) ? <span>· {r.created_by_name || r.created_by}</span> : null}
                    {r.comment ? <span>· {r.comment}</span> : null}
                    {r.status === 'rejected' && r.reject_reason ? <span className="req-reason">· {r.reject_reason}</span> : null}
                  </div>
                </div>
                <span className={`req-badge req-badge--${st.tone}`}>{st.label}</span>
                {canModerate ? (
                  <span className="req-actions">
                    <button className="req-btn req-btn--ok" disabled={busy === r.id} onClick={() => onApprove(r.id)}>
                      <Icon name="check" size={15} />Одобрить
                    </button>
                    <button className="req-btn req-btn--bad" disabled={busy === r.id} onClick={() => onReject(r.id)}>
                      <Icon name="x" size={15} />Отклонить
                    </button>
                  </span>
                ) : canCancel ? (
                  <button className="req-del" title="Удалить заявку" disabled={busy === r.id} onClick={() => onCancel(r.id)}>
                    <Icon name="trash" size={14} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
