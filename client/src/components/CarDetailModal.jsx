import { useState } from 'react';
import dayjs from 'dayjs';
import { STATUS_COLORS, STATUS_LABELS, effectiveStatus, jobOverallStatus, deadlineState } from './Gantt';
import { CellPickerModal } from './Warehouse';

function toLocalInput(iso) {
  return iso ? dayjs(iso).format('YYYY-MM-DDTHH:mm') : '';
}

export default function CarDetailModal({ job, posts, masters, now, onClose, onOpenDocs, onFinalize, onRemove, onEditStage, onUpdateJob, onAddStage }) {
  const [form, setForm] = useState({
    car_model: job.car_model || '',
    plate_number: job.plate_number || '',
    client_name: job.client_name || '',
    client_phone: job.client_phone || '',
    order_number: job.order_number || '',
    cell_ids: job.cell_ids || (job.cell_id ? [job.cell_id] : []),
    expected_at: toLocalInput(job.expected_at),
    deadline: toLocalInput(job.deadline),
    notes: job.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addingStage, setAddingStage] = useState(false);
  const [stageForm, setStageForm] = useState(() => {
    const lastStage = job.stages[job.stages.length - 1];
    const start = lastStage ? dayjs(lastStage.end_at) : dayjs().add(1, 'hour').minute(0).second(0);
    const usedPostIds = new Set(job.stages.map((s) => s.post_id));
    const nextPost = posts.find((p) => !usedPostIds.has(p.id)) || posts[0];
    return {
      post_id: nextPost?.id || '',
      master_id: '',
      start_at: start.format('YYYY-MM-DDTHH:mm'),
      end_at: start.add(4, 'hour').format('YYYY-MM-DDTHH:mm'),
    };
  });

  const overall = jobOverallStatus(job, now);
  const dlState = deadlineState(job, now);
  const sortedStages = [...job.stages].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || (a.start_at > b.start_at ? 1 : -1));

  async function save() {
    setSaving(true);
    await onUpdateJob({
      ...form,
      expected_at: form.expected_at ? dayjs(form.expected_at).toISOString() : null,
      deadline: form.deadline ? dayjs(form.deadline).toISOString() : null,
    });
    setSaving(false);
  }

  async function submitStage() {
    if (!stageForm.post_id || !stageForm.start_at || !stageForm.end_at) return;
    setAddingStage(true);
    try {
      await onAddStage({
        post_id: stageForm.post_id,
        master_id: stageForm.master_id || null,
        sequence: job.stages.length,
        start_at: dayjs(stageForm.start_at).toISOString(),
        end_at: dayjs(stageForm.end_at).toISOString(),
        status: 'planned',
      });
    } finally {
      setAddingStage(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide car-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="car-detail-header">
          <div>
            <h3>{job.car_model} {job.plate_number ? `(${job.plate_number})` : ''}</h3>
            <span className="job-status-badge" style={{ '--badge-color': STATUS_COLORS[overall] }}>{STATUS_LABELS[overall]}</span>
          </div>
        </div>

        <div className="car-detail-body">
          <div className="car-detail-section">
            <h4>Информация</h4>
            <div className="company-grid">
              <input placeholder="Марка и модель" value={form.car_model} onChange={(e) => setForm({ ...form, car_model: e.target.value })} />
              <input placeholder="Гос. номер" value={form.plate_number} onChange={(e) => setForm({ ...form, plate_number: e.target.value })} />
              <input placeholder="Клиент" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
              <input placeholder="Телефон" value={form.client_phone} onChange={(e) => setForm({ ...form, client_phone: e.target.value })} />
              <input placeholder="№ заказ-наряда" value={form.order_number} onChange={(e) => setForm({ ...form, order_number: e.target.value })} />
              <label className="job-form-field">
                <span>Ячейки склада</span>
                <button type="button" onClick={() => setPickerOpen(true)}>
                  {form.cell_ids.length ? `📦 ${form.cell_ids.join(', ')} — изменить` : '📦 Выбрать ячейки'}
                </button>
              </label>
              {!form.cell_ids.length && job.storage_location && (
                <div className="job-form-hint" style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Старая запись места (текст): «{job.storage_location}» — выберите ячейку, чтобы связать со складом
                </div>
              )}
              <label className="job-form-field">
                <span>Дата заезда (если ещё не приехала)</span>
                <input type="datetime-local" value={form.expected_at} onChange={(e) => setForm({ ...form, expected_at: e.target.value })} />
              </label>
              <label className="job-form-field">
                <span>Дедлайн — выдать клиенту до</span>
                <input type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
              </label>
            </div>
            <textarea placeholder="Примечания" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            {job.deadline && dlState && (
              <div className={`job-item-deadline is-${dlState}`}>
                {dlState === 'missed' && '⚠ Дедлайн просрочен'}
                {dlState === 'at-risk' && '⚠ Маршрут не укладывается в дедлайн'}
                {dlState === 'ok' && '✓ Укладывается в дедлайн'}
              </div>
            )}
            <button className="primary small" disabled={saving} onClick={save}>{saving ? 'Сохраняем…' : 'Сохранить информацию'}</button>
          </div>

          <div className="car-detail-section">
            <h4>Маршрут по постам</h4>
            {sortedStages.length === 0 ? (
              <div className="job-empty">Маршрут ещё не запланирован</div>
            ) : (
              <div className="car-stepper">
                {sortedStages.map((s, i) => {
                  const post = posts.find((p) => p.id === s.post_id);
                  const master = masters.find((m) => m.id === s.master_id);
                  const status = effectiveStatus(s, now);
                  return (
                    <div key={s.id} className="car-stepper-item" onClick={() => onEditStage(s)}>
                      <div className="car-stepper-dot" style={{ background: STATUS_COLORS[status] }}>{i + 1}</div>
                      <div className="car-stepper-content">
                        <div className="car-stepper-title">{post?.name || 'Пост'}</div>
                        <div className="car-stepper-sub">
                          {dayjs(s.start_at).format('DD.MM HH:mm')} — {dayjs(s.end_at).format('DD.MM HH:mm')}
                          {master ? ` · ${master.name}` : ''}
                        </div>
                        <span className="job-status-badge" style={{ '--badge-color': STATUS_COLORS[status] }}>{STATUS_LABELS[status]}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="car-add-stage">
              <h4>{sortedStages.length === 0 ? 'Запланировать первый этап' : 'Добавить следующий этап'}</h4>
              <div className="inline-form">
                <select value={stageForm.post_id} onChange={(e) => setStageForm({ ...stageForm, post_id: e.target.value })}>
                  {posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={stageForm.master_id} onChange={(e) => setStageForm({ ...stageForm, master_id: e.target.value })}>
                  <option value="">— мастер не назначен —</option>
                  {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <input type="datetime-local" value={stageForm.start_at} onChange={(e) => setStageForm({ ...stageForm, start_at: e.target.value })} />
                <input type="datetime-local" value={stageForm.end_at} onChange={(e) => setStageForm({ ...stageForm, end_at: e.target.value })} />
                <button className="primary" disabled={addingStage} onClick={submitStage}>{addingStage ? 'Добавляем…' : '+ Добавить этап'}</button>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="danger" onClick={onRemove}>Удалить машину</button>
          <div>
            <button onClick={onOpenDocs}>📄 Документы</button>
            {sortedStages.length > 0 && <button className="primary" onClick={onFinalize}>✓ Завершить</button>}
            <button onClick={onClose}>Закрыть</button>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <CellPickerModal
          currentCellIds={form.cell_ids}
          onSave={(ids) => setForm({ ...form, cell_ids: ids })}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
