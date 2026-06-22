import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';

const ZOOM_LEVELS = [8, 12, 20, 32, 48]; // px per hour
const DEFAULT_ZOOM_INDEX = 2;
const ROW_HEIGHT = 64;
const HOURS_PER_DAY = 24;
const WORKING_HOURS_PER_DAY = 12; // used only for load % capacity, not for layout
const LABEL_WIDTH = 220;
const UNASSIGNED = 'unassigned';

const STATUS_COLORS = {
  planned: '#9C9182',
  in_progress: '#3E6E8E',
  done: '#5B7F3A',
  delayed: '#B5482B',
};

const STATUS_LABELS = {
  planned: 'Запланировано',
  in_progress: 'В работе',
  done: 'Готово',
  delayed: 'Задержка',
};

function dateToX(date, rangeStart, hourWidth) {
  const d = dayjs(date);
  const dayIndex = d.startOf('day').diff(rangeStart.startOf('day'), 'day');
  const hoursIntoDay = d.hour() + d.minute() / 60;
  return dayIndex * HOURS_PER_DAY * hourWidth + hoursIntoDay * hourWidth;
}

function xToMinutesOffset(px, hourWidth) {
  return (px / hourWidth) * 60;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart.isBefore(bEnd) && bStart.isBefore(aEnd);
}

function effectiveStatus(stage, now) {
  if (stage.status === 'done') return 'done';
  if (dayjs(stage.end_at).isBefore(now)) return 'delayed';
  return stage.status;
}

// worst-first: a job is as urgent as its most urgent stage
function jobOverallStatus(job, now) {
  const statuses = job.stages.map((s) => effectiveStatus(s, now));
  if (statuses.includes('delayed')) return 'delayed';
  if (statuses.includes('in_progress')) return 'in_progress';
  if (statuses.every((s) => s === 'done')) return 'done';
  return 'planned';
}

// 'missed' = deadline already passed and not all stages done; 'at-risk' = last stage finishes after deadline; 'ok' = on track
function deadlineState(job, now) {
  if (!job.deadline) return null;
  const deadline = dayjs(job.deadline);
  const allDone = job.stages.every((s) => s.status === 'done');
  if (allDone) return null;
  if (deadline.isBefore(now)) return 'missed';
  const lastEnd = job.stages.reduce((max, s) => (dayjs(s.end_at).isAfter(max) ? dayjs(s.end_at) : max), dayjs(job.stages[0].end_at));
  if (lastEnd.isAfter(deadline)) return 'at-risk';
  return 'ok';
}

const LANE_HEIGHT = 46;
const LANE_GAP = 4;

function computeLanes(rowStages) {
  const sorted = [...rowStages].sort((a, b) => dayjs(a.start_at).diff(dayjs(b.start_at)));
  const laneEnds = []; // last end time per lane
  const laneOf = new Map();
  for (const s of sorted) {
    const start = dayjs(s.start_at);
    let lane = laneEnds.findIndex((end) => !end.isAfter(start));
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(dayjs(s.end_at));
    } else {
      laneEnds[lane] = dayjs(s.end_at);
    }
    laneOf.set(s.id, lane);
  }
  return { laneOf, laneCount: Math.max(laneEnds.length, 1) };
}

export default function Gantt({ onCreateJob }) {
  const [posts, setPosts] = useState([]);
  const [stages, setStages] = useState([]);
  const [masters, setMasters] = useState([]);
  const [rangeStart, setRangeStart] = useState(dayjs().startOf('day'));
  const [days, setDays] = useState(7);
  const [rowMode, setRowMode] = useState('post'); // 'post' | 'master'
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const hourWidth = ZOOM_LEVELS[zoomIndex];
  const dayWidth = HOURS_PER_DAY * hourWidth;
  const [selectedStage, setSelectedStage] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [hoveredJobId, setHoveredJobId] = useState(null);
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(dayjs());
  const [dragLocked, setDragLocked] = useState(() => localStorage.getItem('gantt-drag-locked') === 'true');
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const suppressClickRef = useRef(false);

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }
  const scrollRef = useRef(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [g, m] = await Promise.all([api.gantt(), api.masters.list()]);
    setPosts(g.posts);
    setStages(g.stages);
    setMasters(m);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 60000);
    return () => clearInterval(t);
  }, []);

  const dayList = useMemo(
    () => Array.from({ length: days }, (_, i) => rangeStart.add(i, 'day')),
    [rangeStart, days]
  );

  const jobs = useMemo(() => {
    const map = new Map();
    for (const s of stages) {
      if (!map.has(s.job_id)) {
        map.set(s.job_id, {
          job_id: s.job_id,
          car_model: s.car_model,
          plate_number: s.plate_number,
          client_name: s.client_name,
          order_number: s.order_number,
          storage_location: s.storage_location,
          deadline: s.deadline,
          stages: [],
        });
      }
      map.get(s.job_id).stages.push(s);
    }
    const list = Array.from(map.values());
    for (const j of list) j.stages.sort((a, b) => a.sequence - b.sequence || dayjs(a.start_at).diff(dayjs(b.start_at)));
    list.sort((a, b) => dayjs(a.stages[0].start_at).diff(dayjs(b.stages[0].start_at)));
    return list;
  }, [stages]);

  const rows = useMemo(() => {
    if (rowMode === 'post') return posts;
    if (rowMode === 'job') return jobs.map((j) => ({ id: j.job_id, name: `${j.car_model}${j.plate_number ? ` (${j.plate_number})` : ''}` }));
    return [...masters, { id: UNASSIGNED, name: 'Без мастера' }];
  }, [rowMode, posts, masters, jobs]);

  const stagesByRow = useMemo(() => {
    const map = {};
    for (const r of rows) map[r.id] = [];
    for (const s of stages) {
      const key = rowMode === 'post' ? s.post_id : rowMode === 'job' ? s.job_id : (s.master_id || UNASSIGNED);
      if (!map[key]) map[key] = [];
      map[key].push(s);
    }
    return map;
  }, [rows, stages, rowMode]);

  // conflicts: same post OR (if both assigned) same master, overlapping time, excluding finished stages
  const conflictsByStage = useMemo(() => {
    const map = new Map();
    const active = stages.filter((s) => s.status !== 'done');
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        if (a.id === b.id) continue;
        const samePost = a.post_id === b.post_id;
        const sameMaster = a.master_id && b.master_id && a.master_id === b.master_id;
        if (!samePost && !sameMaster) continue;
        if (overlaps(dayjs(a.start_at), dayjs(a.end_at), dayjs(b.start_at), dayjs(b.end_at))) {
          if (!map.has(a.id)) map.set(a.id, []);
          if (!map.has(b.id)) map.set(b.id, []);
          map.get(a.id).push({ stage: b, reason: samePost ? 'post' : 'master' });
          map.get(b.id).push({ stage: a, reason: samePost ? 'post' : 'master' });
        }
      }
    }
    return map;
  }, [stages]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      [j.car_model, j.plate_number, j.client_name, j.order_number, j.storage_location].some((v) => (v || '').toLowerCase().includes(q))
    );
  }, [jobs, search]);

  const conflictCount = conflictsByStage.size;

  async function patchStage(id, patch) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    await api.stages.update(id, patch);
  }

  async function finalizeJob(jobId, overall) {
    if (overall !== 'done') {
      if (!window.confirm('Не все этапы завершены. Всё равно завершить заказ и убрать его в историю?')) return;
    }
    if (selectedJobId === jobId) setSelectedJobId(null);
    await api.jobs.archive(jobId);
    showToast('Заказ завершён и перемещён в историю');
    load();
  }

  async function patchJob(jobId, patch) {
    setStages((prev) => prev.map((s) => (s.job_id === jobId ? { ...s, ...patch } : s)));
    await api.jobs.update(jobId, patch);
  }

  async function addNextStage(fromStage) {
    const jobStages = stages.filter((s) => s.job_id === fromStage.job_id);
    const last = jobStages.reduce((max, s) => (s.sequence > max.sequence ? s : max), jobStages[0]);
    const postIdx = posts.findIndex((p) => p.id === last.post_id);
    const nextPost = posts[postIdx + 1] || posts[postIdx] || posts[0];
    const start = dayjs(last.end_at);
    const newStage = await api.stages.create(fromStage.job_id, {
      post_id: nextPost.id,
      master_id: null,
      sequence: last.sequence + 1,
      start_at: start.toISOString(),
      end_at: start.add(4, 'hour').toISOString(),
      status: 'planned',
    });
    const g = await api.gantt();
    setPosts(g.posts);
    setStages(g.stages);
    return g.stages.find((s) => s.id === newStage.id) || null;
  }

  function startDrag(e, stage, mode) {
    if (dragLocked) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const origStart = dayjs(stage.start_at);
    const origEnd = dayjs(stage.end_at);
    const jobStages = stages.filter((s) => s.job_id === stage.job_id && s.id !== stage.id);

    function onMove(ev) {
      const deltaPx = ev.clientX - startX;
      const deltaMin = Math.round(xToMinutesOffset(deltaPx, hourWidth) / 15) * 15;
      if (deltaMin === 0) return;
      setStages((prev) => prev.map((s) => {
        if (s.id === stage.id) {
          if (mode === 'move') {
            const newStart = origStart.add(deltaMin, 'minute');
            const dur = origEnd.diff(origStart, 'minute');
            return { ...s, start_at: newStart.toISOString(), end_at: newStart.add(dur, 'minute').toISOString() };
          }
          const newEnd = origEnd.add(deltaMin, 'minute');
          if (!newEnd.isAfter(origStart)) return s;
          return { ...s, end_at: newEnd.toISOString() };
        }
        // cascade: move shifts whole job chain together; resize pushes only later stages
        const other = jobStages.find((j) => j.id === s.id);
        if (!other) return s;
        const isLater = other.sequence > stage.sequence;
        if (mode === 'move') {
          return { ...s, start_at: dayjs(other.start_at).add(deltaMin, 'minute').toISOString(), end_at: dayjs(other.end_at).add(deltaMin, 'minute').toISOString() };
        }
        if (mode === 'resize' && isLater) {
          return { ...s, start_at: dayjs(other.start_at).add(deltaMin, 'minute').toISOString(), end_at: dayjs(other.end_at).add(deltaMin, 'minute').toISOString() };
        }
        return s;
      }));
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setStages((prev) => {
        const patches = {};
        const moved = prev.find((s) => s.id === stage.id);
        const changed = moved && (moved.start_at !== stage.start_at || moved.end_at !== stage.end_at);
        if (moved) patches[moved.id] = { start_at: moved.start_at, end_at: moved.end_at };
        for (const other of jobStages) {
          const cur = prev.find((s) => s.id === other.id);
          if (cur && (cur.start_at !== other.start_at || cur.end_at !== other.end_at)) {
            patches[cur.id] = { start_at: cur.start_at, end_at: cur.end_at };
          }
        }
        Object.entries(patches).forEach(([id, patch]) => api.stages.update(id, patch));
        if (mode === 'resize' && changed && moved) {
          suppressClickRef.current = true;
          showToast(`${moved.car_model}: новые сроки этапа ${dayjs(moved.start_at).format('DD.MM HH:mm')} — ${dayjs(moved.end_at).format('DD.MM HH:mm')}`);
        }
        return prev;
      });
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function allowDrop(e) { if (rowMode !== 'job') e.preventDefault(); }

  function onDropToRow(e, rowId) {
    if (rowMode === 'job' || dragLocked) return;
    e.preventDefault();
    const stageId = e.dataTransfer.getData('stageId');
    if (!stageId) return;
    if (rowMode === 'post') {
      patchStage(stageId, { post_id: rowId });
    } else {
      patchStage(stageId, { master_id: rowId === UNASSIGNED ? null : rowId });
    }
  }

  function focusJob(job) {
    setSelectedJobId((prev) => (prev === job.job_id ? null : job.job_id));
    const earliest = dayjs(job.stages[0].start_at);
    if (earliest.isBefore(rangeStart) || earliest.isAfter(rangeStart.add(days - 1, 'day'))) {
      setRangeStart(earliest.startOf('day'));
    }
  }

  const totalWidth = days * dayWidth;
  const showNowLine = !now.isBefore(rangeStart) && now.isBefore(rangeStart.add(days, 'day'));
  const nowX = showNowLine ? dateToX(now, rangeStart, hourWidth) : null;
  const rowHeights = rows.map((row) => {
    const { laneCount } = computeLanes(stagesByRow[row.id] || []);
    return Math.max(ROW_HEIGHT, laneCount * LANE_HEIGHT + (laneCount - 1) * LANE_GAP + 16);
  });
  const gridHeight = 44 + rowHeights.reduce((sum, h) => sum + h + 1, 0);

  if (loading) {
    return (
      <div className="gantt-loading">
        <div className="spinner" />
        <span>Загружаем график…</span>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="gantt-empty">
        <div className="gantt-empty-icon">🚗</div>
        <h3>Пока нет ни одного заказа</h3>
        <p>Создайте первую машину с маршрутом по постам — она появится здесь на графике.</p>
        <button className="primary" onClick={onCreateJob}>+ Создать первый заказ</button>
      </div>
    );
  }

  return (
    <div className="gantt-layout">
      <aside className="job-sidebar">
        <input
          className="job-search"
          placeholder="Поиск по машине, номеру, клиенту…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="job-list">
          {filteredJobs.map((j) => {
            const dlState = deadlineState(j, now);
            const overall = jobOverallStatus(j, now);
            return (
            <div
              key={j.job_id}
              className={`job-item${selectedJobId === j.job_id ? ' active' : ''}${hoveredJobId === j.job_id ? ' hovered' : ''}`}
              onClick={() => focusJob(j)}
              onMouseEnter={() => setHoveredJobId(j.job_id)}
              onMouseLeave={() => setHoveredJobId(null)}
            >
              <div className="job-item-head">
                <div className="job-item-title">{j.car_model}{j.order_number ? <span className="job-item-order"> №{j.order_number}</span> : ''}</div>
                <div className="job-item-head-actions">
                  <span className="job-status-badge" style={{ '--badge-color': STATUS_COLORS[overall] }}>{STATUS_LABELS[overall]}</span>
                  <button
                    className="job-item-finish"
                    title="Завершить и убрать в историю"
                    onClick={(e) => { e.stopPropagation(); finalizeJob(j.job_id, overall); }}
                  >
                    ✓
                  </button>
                </div>
              </div>
              <div className="job-item-sub">{j.plate_number || '—'} {j.client_name ? `· ${j.client_name}` : ''}</div>
              {j.storage_location && <div className="job-item-storage">📦 {j.storage_location}</div>}
              {j.deadline && (
                <div className={`job-item-deadline${dlState ? ` is-${dlState}` : ''}`}>
                  ⏰ до {dayjs(j.deadline).format('DD.MM HH:mm')}
                  {dlState === 'missed' && ' — просрочен'}
                  {dlState === 'at-risk' && ' — под угрозой'}
                </div>
              )}
              <div className="job-item-route">
                {j.stages.map((s) => (
                  <span key={s.id} className="job-route-dot" style={{ background: STATUS_COLORS[effectiveStatus(s, now)] }} title={posts.find((p) => p.id === s.post_id)?.name} />
                ))}
                <button
                  className="job-item-add-stage"
                  title="Добавить следующий этап маршрута"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const created = await addNextStage(j.stages[0]);
                    setSelectedStage(created);
                  }}
                >
                  +
                </button>
              </div>
            </div>
            );
          })}
          {filteredJobs.length === 0 && <div className="job-empty">Ничего не найдено</div>}
        </div>
        <button className="job-sidebar-new" onClick={onCreateJob}>+ Новый заказ</button>
      </aside>

      <div className="gantt">
        <div className="gantt-toolbar">
          <div className="row-mode-toggle">
            <button className={rowMode === 'post' ? 'active' : ''} onClick={() => setRowMode('post')}>По постам</button>
            <button className={rowMode === 'master' ? 'active' : ''} onClick={() => setRowMode('master')}>По мастерам</button>
            <button className={rowMode === 'job' ? 'active' : ''} onClick={() => setRowMode('job')}>По машинам</button>
          </div>
          <button onClick={() => setRangeStart((d) => d.subtract(1, 'day'))}>◀ день</button>
          <strong>{rangeStart.format('DD.MM.YYYY')} — {rangeStart.add(days - 1, 'day').format('DD.MM.YYYY')}</strong>
          <button onClick={() => setRangeStart((d) => d.add(1, 'day'))}>день ▶</button>
          <button onClick={() => setRangeStart(dayjs().startOf('day'))}>сегодня</button>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={3}>3 дня</option>
            <option value={7}>7 дней</option>
            <option value={14}>14 дней</option>
          </select>
          <button onClick={load}>обновить</button>
          <div className="zoom-control">
            <button onClick={() => setZoomIndex((i) => Math.max(i - 1, 0))} disabled={zoomIndex === 0} title="Уменьшить масштаб">－</button>
            <span className="zoom-label">{Math.round((hourWidth / ZOOM_LEVELS[DEFAULT_ZOOM_INDEX]) * 100)}%</span>
            <button onClick={() => setZoomIndex((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1))} disabled={zoomIndex === ZOOM_LEVELS.length - 1} title="Увеличить масштаб">＋</button>
          </div>
          <button
            className={`lock-toggle${dragLocked ? ' active' : ''}`}
            onClick={() => setDragLocked((v) => {
              const next = !v;
              localStorage.setItem('gantt-drag-locked', String(next));
              return next;
            })}
            title={dragLocked ? 'Перетаскивание заблокировано — нажмите, чтобы разрешить' : 'Перетаскивание разрешено — нажмите, чтобы заблокировать'}
          >
            {dragLocked ? '🔒 Заблокировано' : '🔓 Перетаскивание'}
          </button>
          {conflictCount > 0 && <span className="conflict-banner">⚠ Конфликтов: {conflictCount}</span>}
          <div className="legend">
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <span key={k} className="legend-item"><i style={{ background: STATUS_COLORS[k] }} />{label}</span>
            ))}
          </div>
        </div>

        <div className="gantt-scroll" ref={scrollRef} onClick={() => setSelectedJobId(null)}>
          <div className="gantt-grid" style={{ width: LABEL_WIDTH + totalWidth }}>
            <div className="gantt-header" style={{ width: LABEL_WIDTH + totalWidth }}>
              <div className="gantt-row-label gantt-corner">{rowMode === 'post' ? 'Посты' : rowMode === 'job' ? 'Машины' : 'Мастера'}</div>
              <div className="gantt-days" style={{ width: totalWidth }}>
                {dayList.map((d) => (
                  <div key={d.format()} className={`gantt-day${d.isSame(now, 'day') ? ' is-today' : ''}`} style={{ width: dayWidth }}>
                    {d.format('dd DD.MM')}
                  </div>
                ))}
              </div>
            </div>

            {rows.map((row) => {
              const rowStages = stagesByRow[row.id] || [];
              const occupiedMin = rowStages.reduce((sum, s) => {
                const st = dayjs(s.start_at), en = dayjs(s.end_at);
                if (en.isBefore(rangeStart) || st.isAfter(rangeStart.add(days, 'day'))) return sum;
                return sum + en.diff(st, 'minute');
              }, 0);
              const capacityMin = days * WORKING_HOURS_PER_DAY * 60;
              const loadPct = Math.min(100, Math.round((occupiedMin / capacityMin) * 100));
              const { laneOf, laneCount } = computeLanes(rowStages);
              const rowHeight = Math.max(ROW_HEIGHT, laneCount * LANE_HEIGHT + (laneCount - 1) * LANE_GAP + 16);
              return (
                <div className="gantt-row" key={row.id} style={{ width: LABEL_WIDTH + totalWidth }}>
                  <div className="gantt-row-label">
                    <span>{row.name}</span>
                    {rowStages.length > 0 && (
                      <span className={`load-pill${loadPct >= 90 ? ' load-high' : loadPct >= 60 ? ' load-mid' : ''}`}>{loadPct}%</span>
                    )}
                  </div>
                  <div
                    className="gantt-row-track"
                    style={{ width: totalWidth, height: rowHeight }}
                    onDragOver={allowDrop}
                    onDrop={(e) => onDropToRow(e, row.id)}
                  >
                    {dayList.map((d, i) => (
                      <div key={i} className={`gantt-cell${d.isSame(now, 'day') ? ' is-today' : ''}`} style={{ left: i * dayWidth, width: dayWidth }} />
                    ))}
                    {rowMode === 'job' && (() => {
                      const job = jobs.find((j) => j.job_id === row.id);
                      if (!job?.deadline) return null;
                      const dl = dayjs(job.deadline);
                      if (dl.isBefore(rangeStart) || dl.isAfter(rangeStart.add(days, 'day'))) return null;
                      return (
                        <div className="gantt-deadline-line" style={{ left: dateToX(job.deadline, rangeStart, hourWidth), height: rowHeight }}>
                          <span className="gantt-deadline-label">дедлайн {dl.format('DD.MM HH:mm')}</span>
                        </div>
                      );
                    })()}
                    {rowStages.map((s) => {
                      const x = dateToX(s.start_at, rangeStart, hourWidth);
                      const x2 = dateToX(s.end_at, rangeStart, hourWidth);
                      const width = Math.max(x2 - x, 10);
                      const isFocused = selectedJobId === s.job_id || hoveredJobId === s.job_id;
                      const isDimmed = (selectedJobId || hoveredJobId) && !isFocused;
                      const status = effectiveStatus(s, now);
                      const conflicts = conflictsByStage.get(s.id);
                      const conflictTitle = conflicts ? `\nКонфликт с: ${conflicts.map((c) => c.stage.car_model).join(', ')} (${conflicts[0].reason === 'post' ? 'тот же пост' : 'тот же мастер'})` : '';
                      const lane = laneOf.get(s.id) || 0;
                      const top = 8 + lane * (LANE_HEIGHT + LANE_GAP);
                      return (
                        <div
                          key={s.id}
                          className={`gantt-bar${isFocused ? ' is-focused' : ''}${isDimmed ? ' is-dimmed' : ''}${conflicts ? ' has-conflict' : ''}${dragLocked ? ' is-locked' : ''}`}
                          draggable={!dragLocked}
                          onDragStart={(e) => e.dataTransfer.setData('stageId', String(s.id))}
                          style={{ left: x, width, top, height: LANE_HEIGHT, background: STATUS_COLORS[status] || '#888' }}
                          onMouseDown={(e) => startDrag(e, s, 'move')}
                          onMouseEnter={() => setHoveredJobId(s.job_id)}
                          onMouseLeave={() => setHoveredJobId(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                            setSelectedStage(s);
                          }}
                          title={`${s.car_model} (${s.plate_number || ''}) — ${s.master_name || 'без мастера'}${conflictTitle}${dragLocked ? '\nПеретаскивание заблокировано' : ''}`}
                        >
                          {conflicts && <span className="conflict-flag">⚠</span>}
                          <span className="gantt-bar-label">{rowMode === 'job' ? (posts.find((p) => p.id === s.post_id)?.name || s.car_model) : s.car_model}</span>
                          {!dragLocked && <div className="gantt-bar-resize" onMouseDown={(e) => startDrag(e, s, 'resize')} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {showNowLine && (
              <div className="gantt-now-line" style={{ left: LABEL_WIDTH + nowX, height: gridHeight }}>
                <span className="gantt-now-label">{now.format('HH:mm')}</span>
              </div>
            )}
          </div>
        </div>

        {toast && <div className="gantt-toast">{toast}</div>}
      </div>

      {selectedStage && (
        <StageEditor
          key={selectedStage.id}
          stage={selectedStage}
          posts={posts}
          masters={masters}
          onClose={() => setSelectedStage(null)}
          onSaved={(patch, jobPatch) => {
            patchStage(selectedStage.id, patch);
            if (jobPatch) patchJob(selectedStage.job_id, jobPatch);
            setSelectedStage(null);
          }}
          onDeleted={async () => { await api.stages.remove(selectedStage.id); setSelectedStage(null); load(); }}
          onAddNext={async () => {
            const created = await addNextStage(selectedStage);
            setSelectedStage(created);
          }}
        />
      )}
    </div>
  );
}

function StageEditor({ stage, posts, masters, onClose, onSaved, onDeleted, onAddNext }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    post_id: stage.post_id,
    master_id: stage.master_id || '',
    status: stage.status,
    start_at: dayjs(stage.start_at).format('YYYY-MM-DDTHH:mm'),
    end_at: dayjs(stage.end_at).format('YYYY-MM-DDTHH:mm'),
  });
  const [jobForm, setJobForm] = useState({
    order_number: stage.order_number || '',
    storage_location: stage.storage_location || '',
    deadline: stage.deadline ? dayjs(stage.deadline).format('YYYY-MM-DDTHH:mm') : '',
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{stage.car_model} {stage.plate_number ? `(${stage.plate_number})` : ''}</h3>
        <label>№ заказ-наряда
          <input value={jobForm.order_number} onChange={(e) => setJobForm({ ...jobForm, order_number: e.target.value })} placeholder="напр. 0001234" />
        </label>
        <label>Место на складе
          <input value={jobForm.storage_location} onChange={(e) => setJobForm({ ...jobForm, storage_location: e.target.value })} placeholder="напр. стеллаж А-3" />
        </label>
        <label>Дедлайн (выдать клиенту до)
          <input type="datetime-local" value={jobForm.deadline} onChange={(e) => setJobForm({ ...jobForm, deadline: e.target.value })} />
        </label>
        <label>Пост
          <select value={form.post_id} onChange={(e) => setForm({ ...form, post_id: e.target.value })}>
            {posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>Мастер
          <select value={form.master_id} onChange={(e) => setForm({ ...form, master_id: e.target.value || '' })}>
            <option value="">— не назначен —</option>
            {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label>Статус
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>Начало
          <input type="datetime-local" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
        </label>
        <label>Конец
          <input type="datetime-local" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} />
        </label>
        <button
          className="add-next-stage"
          disabled={adding}
          onClick={async () => {
            setAdding(true);
            try { await onAddNext(); } finally { setAdding(false); }
          }}
        >
          + Добавить следующий этап маршрута {adding ? '…' : ''}
        </button>
        <p className="add-next-hint">Несохранённые изменения этого этапа нужно сохранить отдельно — кнопка добавляет этап после последнего сохранённого в маршруте.</p>
        <div className="modal-actions">
          <button className="danger" onClick={onDeleted}>Удалить этап</button>
          <div>
            <button onClick={onClose}>Отмена</button>
            <button className="primary" onClick={() => onSaved({
              post_id: form.post_id,
              master_id: form.master_id || null,
              status: form.status,
              start_at: dayjs(form.start_at).toISOString(),
              end_at: dayjs(form.end_at).toISOString(),
            }, {
              order_number: jobForm.order_number,
              storage_location: jobForm.storage_location,
              deadline: jobForm.deadline ? dayjs(jobForm.deadline).toISOString() : '',
            })}>Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  );
}
