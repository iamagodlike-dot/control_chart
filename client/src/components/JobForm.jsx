import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { CellPickerModal } from './Warehouse';

const PREVIEW_HOUR_WIDTH = 16;

function emptyStage(posts, masters, prevEnd) {
  const start = prevEnd || dayjs().add(1, 'hour').minute(0).second(0);
  const end = start.add(4, 'hour');
  return {
    post_id: posts[0]?.id || '',
    master_id: '',
    title: '',
    start_at: start.format('YYYY-MM-DDTHH:mm'),
    end_at: end.format('YYYY-MM-DDTHH:mm'),
    status: 'planned',
  };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart.isBefore(bEnd) && bStart.isBefore(aEnd);
}

const EMPTY_JOB = { car_model: '', plate_number: '', client_name: '', client_phone: '', order_number: '', cell_ids: [], expected_at: '', deadline: '', notes: '' };

export default function JobForm({ onCreated }) {
  const [posts, setPosts] = useState([]);
  const [masters, setMasters] = useState([]);
  const [existingStages, setExistingStages] = useState([]);
  const [job, setJob] = useState({ ...EMPTY_JOB });
  const [stages, setStages] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, m, g] = await Promise.all([api.posts.list(), api.masters.list(), api.gantt()]);
      setPosts(p);
      setMasters(m);
      setExistingStages(g.stages);
    })();
  }, []);

  function addStage() {
    const last = stages[stages.length - 1];
    const prevEnd = last ? dayjs(last.end_at) : null;
    setStages([...stages, emptyStage(posts, masters, prevEnd)]);
  }

  function updateStage(i, patch) {
    setStages(stages.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function removeStage(i) {
    setStages(stages.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!job.car_model.trim()) return alert('Укажите марку/модель автомобиля');
    const payload = {
      ...job,
      expected_at: job.expected_at ? dayjs(job.expected_at).toISOString() : null,
      deadline: job.deadline ? dayjs(job.deadline).toISOString() : null,
      stages: stages.map((s, i) => ({
        ...s,
        master_id: s.master_id || null,
        sequence: i,
        start_at: dayjs(s.start_at).toISOString(),
        end_at: dayjs(s.end_at).toISOString(),
      })),
    };
    const created = await api.jobs.create(payload);
    if (job.cell_ids.length) await api.warehouse.setJobCells(created, job.cell_ids);
    setJob({ ...EMPTY_JOB });
    setStages([]);
    onCreated && onCreated();
    alert(stages.length > 0 ? 'Автомобиль добавлен и поставлен в график' : 'Автомобиль добавлен — ждём заезда, маршрут можно запланировать позже');
  }

  return (
    <div className="panel job-form-panel">
      <h3>Добавить автомобиль</h3>
      <p className="panel-hint">Заведите данные сразу — и заезд, и дедлайн, и маршрут (если уже известен). Машина появится в общем списке.</p>
      <div className="job-form-grid">
        <input placeholder="Марка и модель *" value={job.car_model} onChange={(e) => setJob({ ...job, car_model: e.target.value })} />
        <input placeholder="Гос. номер" value={job.plate_number} onChange={(e) => setJob({ ...job, plate_number: e.target.value })} />
        <input placeholder="№ заказ-наряда" value={job.order_number} onChange={(e) => setJob({ ...job, order_number: e.target.value })} />
        <div className="job-form-field">
          <span>Ячейки склада</span>
          <button type="button" onClick={() => setPickerOpen(true)}>
            {job.cell_ids.length ? `📦 ${job.cell_ids.join(', ')} — изменить` : '📦 Выбрать ячейки'}
          </button>
        </div>
        <input placeholder="Клиент" value={job.client_name} onChange={(e) => setJob({ ...job, client_name: e.target.value })} />
        <input placeholder="Телефон" value={job.client_phone} onChange={(e) => setJob({ ...job, client_phone: e.target.value })} />
        <label className="job-form-field">
          <span>Дата заезда (если ещё не приехала)</span>
          <input type="datetime-local" value={job.expected_at} onChange={(e) => setJob({ ...job, expected_at: e.target.value })} />
        </label>
        <label className="job-form-field">
          <span>Дедлайн (выдать клиенту до)</span>
          <input type="datetime-local" value={job.deadline} onChange={(e) => setJob({ ...job, deadline: e.target.value })} />
        </label>
        <textarea className="job-form-full" placeholder="Примечания" value={job.notes} onChange={(e) => setJob({ ...job, notes: e.target.value })} />
      </div>
      {job.deadline && stages.length > 0 && (() => {
        const lastEnd = dayjs(stages[stages.length - 1].end_at);
        const deadline = dayjs(job.deadline);
        return lastEnd.isAfter(deadline)
          ? <div className="deadline-warning">⚠ Последний этап заканчивается {lastEnd.format('DD.MM HH:mm')} — позже дедлайна {deadline.format('DD.MM HH:mm')}</div>
          : null;
      })()}

      <h4>Маршрут по постам <span className="panel-hint-inline">(необязательно — можно запланировать позже, когда машина приедет)</span></h4>
      {stages.length === 0 && <div className="job-empty">Маршрут не задан — машина встанет в общий список как ожидаемая</div>}
      {stages.length > 0 && <table className="stage-table">
        <thead>
          <tr>
            <th>#</th><th>Пост</th><th>Мастер</th><th>Начало</th><th>Конец</th><th></th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <select value={s.post_id} onChange={(e) => updateStage(i, { post_id: e.target.value })}>
                  {posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </td>
              <td>
                <select value={s.master_id} onChange={(e) => updateStage(i, { master_id: e.target.value })}>
                  <option value="">—</option>
                  {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </td>
              <td><input type="datetime-local" value={s.start_at} onChange={(e) => updateStage(i, { start_at: e.target.value })} /></td>
              <td><input type="datetime-local" value={s.end_at} onChange={(e) => updateStage(i, { end_at: e.target.value })} /></td>
              <td><button className="danger small" onClick={() => removeStage(i)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>}
      <div className="inline-form">
        <button onClick={addStage}>+ Добавить этап</button>
        <button className="primary" onClick={submit}>{stages.length > 0 ? 'Сохранить машину и маршрут' : 'Добавить машину (без маршрута)'}</button>
      </div>

      {stages.length > 0 && (
        <>
          <h4>Где это встанет в графике</h4>
          <RoutePreview posts={posts} draftStages={stages} existingStages={existingStages} deadline={job.deadline} />
        </>
      )}

      {pickerOpen && (
        <CellPickerModal
          currentCellIds={job.cell_ids}
          onSave={(ids) => setJob({ ...job, cell_ids: ids })}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function RoutePreview({ posts, draftStages, existingStages, deadline }) {
  const validDraft = draftStages.filter((s) => s.post_id && s.start_at && s.end_at);

  const usedPostIds = useMemo(() => {
    const seen = new Set();
    const ordered = [];
    for (const s of validDraft) {
      if (!seen.has(s.post_id)) { seen.add(s.post_id); ordered.push(s.post_id); }
    }
    return ordered;
  }, [validDraft]);

  if (usedPostIds.length === 0) {
    return <div className="route-preview"><div className="route-preview-empty">Заполните пост и время этапа, чтобы увидеть превью на графике</div></div>;
  }

  const starts = validDraft.map((s) => dayjs(s.start_at));
  const ends = validDraft.map((s) => dayjs(s.end_at));
  if (deadline) ends.push(dayjs(deadline));
  const rangeStart = starts.reduce((min, d) => (d.isBefore(min) ? d : min), starts[0]).subtract(1, 'hour').startOf('hour');
  const rangeEnd = ends.reduce((max, d) => (d.isAfter(max) ? d : max), ends[0]).add(1, 'hour').endOf('hour');
  const totalHours = Math.max(rangeEnd.diff(rangeStart, 'hour'), 1);
  const totalWidth = totalHours * PREVIEW_HOUR_WIDTH;
  const now = dayjs();

  const toX = (date) => dayjs(date).diff(rangeStart, 'minute') / 60 * PREVIEW_HOUR_WIDTH;

  const dayTicks = [];
  let cursor = rangeStart.startOf('day');
  while (cursor.isBefore(rangeEnd)) {
    if (cursor.isAfter(rangeStart)) dayTicks.push(cursor);
    cursor = cursor.add(1, 'day');
  }

  const rowsByPost = usedPostIds.map((postId) => {
    const post = posts.find((p) => p.id === postId);
    const existing = existingStages.filter((s) => s.post_id === postId);
    const draft = validDraft.filter((s) => s.post_id === postId);
    return { postId, name: post?.name || `Пост #${postId}`, existing, draft };
  });

  return (
    <div className="route-preview">
      <div className="route-preview-scroll">
        <div style={{ width: 150 + totalWidth, position: 'relative' }}>
          <div className="route-preview-ticks" style={{ width: 150 + totalWidth }}>
            <div style={{ width: 150, flexShrink: 0 }} />
            <div style={{ position: 'relative', width: totalWidth }}>
              {dayTicks.map((d) => (
                <div key={d.format()} className="route-preview-tick" style={{ left: toX(d) }}>{d.format('DD.MM')}</div>
              ))}
              {now.isAfter(rangeStart) && now.isBefore(rangeEnd) && (
                <div className="route-preview-now" style={{ left: toX(now) }} />
              )}
            </div>
          </div>

          {deadline && dayjs(deadline).isAfter(rangeStart) && dayjs(deadline).isBefore(rangeEnd) && (
            <div className="route-preview-deadline" style={{ left: 150 + toX(deadline), height: 22 + rowsByPost.length * 41 }}>
              <span className="route-preview-deadline-label">дедлайн</span>
            </div>
          )}

          {rowsByPost.map((row) => (
            <div className="route-preview-row" key={row.postId}>
              <div className="route-preview-label">{row.name}</div>
              <div className="route-preview-track" style={{ width: totalWidth }}>
                {row.existing.map((s) => (
                  <div
                    key={s.id}
                    className="route-preview-block"
                    style={{ left: toX(s.start_at), width: Math.max(toX(s.end_at) - toX(s.start_at), 8) }}
                    title={`${s.car_model} (занято)`}
                  >
                    {s.car_model}
                  </div>
                ))}
                {row.draft.map((s, i) => {
                  const conflict = row.existing.some((e) => e.status !== 'done' && overlaps(dayjs(s.start_at), dayjs(s.end_at), dayjs(e.start_at), dayjs(e.end_at)));
                  return (
                    <div
                      key={`draft-${i}`}
                      className={`route-preview-block is-draft${conflict ? ' has-conflict' : ''}`}
                      style={{ left: toX(s.start_at), width: Math.max(toX(s.end_at) - toX(s.start_at), 8) }}
                      title={conflict ? 'Пересекается с существующей записью на этом посту' : 'Новый этап'}
                    >
                      новый
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="route-preview-hint">Серые блоки — уже занято на посту, синие — этапы нового заказа, красные — конфликт по времени</div>
    </div>
  );
}
