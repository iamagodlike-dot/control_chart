import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import DocumentsModal from './DocumentsModal';
import CarDetailModal from './CarDetailModal';

const ZOOM_LEVELS = [8, 12, 20, 32, 48]; // px per hour
const DEFAULT_ZOOM_INDEX = 2;
const ROW_HEIGHT = 64;
const HOURS_PER_DAY = 24;
const HOUR_ROW_HEIGHT = 20;
const HEADER_HEIGHT = 44 + HOUR_ROW_HEIGHT;
const HOUR_TICK_CANDIDATES = [1, 2, 3, 6, 12];
export const WORKING_HOURS_PER_DAY = 12; // used only for load % capacity, not for layout
const LABEL_WIDTH = 220;
const UNASSIGNED = 'unassigned';

export const STATUS_COLORS = {
  planned: 'var(--status-planned)',
  in_progress: 'var(--status-in-progress)',
  done: 'var(--status-done)',
  delayed: 'var(--status-delayed)',
  queued: 'var(--status-queued)',
};

export const STATUS_LABELS = {
  planned: 'Запланировано',
  in_progress: 'В работе',
  done: 'Готово',
  delayed: 'Задержка',
  queued: 'Ожидается',
};

// Non-working hours are compressed to a fraction of their real width instead
// of being hidden — the timeline stays uncluttered but overtime work before
// opening/after closing is still visible and draggable, just at a denser scale.
const OFF_HOURS_SCALE = 1 / 8;

function dayWidthFor(hourWidth, workStart, workEnd) {
  const workHours = workEnd - workStart;
  const offHours = HOURS_PER_DAY - workHours;
  return workHours * hourWidth + offHours * hourWidth * OFF_HOURS_SCALE;
}

// Position of `hoursIntoDay` (0-24) within a single compressed day, in px.
function hourOffsetX(hoursIntoDay, hourWidth, workStart, workEnd) {
  const offScale = hourWidth * OFF_HOURS_SCALE;
  if (hoursIntoDay <= workStart) return hoursIntoDay * offScale;
  if (hoursIntoDay <= workEnd) return workStart * offScale + (hoursIntoDay - workStart) * hourWidth;
  return workStart * offScale + (workEnd - workStart) * hourWidth + (hoursIntoDay - workEnd) * offScale;
}

function dateToX(date, rangeStart, hourWidth, workStart, workEnd) {
  const d = dayjs(date);
  const dayIndex = d.startOf('day').diff(rangeStart.startOf('day'), 'day');
  const hoursIntoDay = d.hour() + d.minute() / 60;
  return dayIndex * dayWidthFor(hourWidth, workStart, workEnd) + hourOffsetX(hoursIntoDay, hourWidth, workStart, workEnd);
}

// Exact inverse of dateToX — needed because dragging can no longer convert a
// pixel delta into a time delta (the scale differs on each side of the
// compressed zone); instead we re-derive the date from the cursor's
// absolute position on every move.
function xToDate(x, rangeStart, hourWidth, workStart, workEnd) {
  const dw = dayWidthFor(hourWidth, workStart, workEnd);
  const dayIndex = Math.floor(x / dw);
  const within = x - dayIndex * dw;
  const offScale = hourWidth * OFF_HOURS_SCALE;
  const offBefore = workStart * offScale;
  const workSpan = (workEnd - workStart) * hourWidth;
  let hoursIntoDay;
  if (within <= offBefore) {
    hoursIntoDay = within / offScale;
  } else if (within <= offBefore + workSpan) {
    hoursIntoDay = workStart + (within - offBefore) / hourWidth;
  } else {
    hoursIntoDay = workEnd + (within - offBefore - workSpan) / offScale;
  }
  return rangeStart.startOf('day').add(dayIndex, 'day').add(Math.round(hoursIntoDay * 60), 'minute');
}

const MIN_DURATION_MINUTES = 15;

function roundTo15(d) {
  const ms = 15 * 60 * 1000;
  return dayjs(Math.round(d.valueOf() / ms) * ms);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart.isBefore(bEnd) && bStart.isBefore(aEnd);
}

function hourOf(dateStr) {
  const d = dayjs(dateStr);
  return d.hour() + d.minute() / 60;
}

function isOvertimeHour(h, workStart, workEnd) {
  return h < workStart || h > workEnd;
}

export function effectiveStatus(stage, now) {
  if (stage.status === 'done') return 'done';
  if (dayjs(stage.end_at).isBefore(now)) return 'delayed';
  return stage.status;
}

// worst-first: a job is as urgent as its most urgent stage
export function jobOverallStatus(job, now) {
  if (!job.stages || job.stages.length === 0) return 'queued';
  const statuses = job.stages.map((s) => effectiveStatus(s, now));
  if (statuses.includes('delayed')) return 'delayed';
  if (statuses.includes('in_progress')) return 'in_progress';
  if (statuses.every((s) => s === 'done')) return 'done';
  return 'planned';
}

// 'missed' = deadline already passed and not all stages done; 'at-risk' = last stage finishes after deadline; 'ok' = on track
export function deadlineState(job, now) {
  if (!job.deadline || !job.stages || job.stages.length === 0) return null;
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

// The stage happening "now" stays centered and in focus; earlier/later
// stages dim with distance and fade out at the edges instead of wrapping.
function RouteStrip({ stages, posts, now }) {
  const currentRef = useRef(null);
  const sorted = [...stages].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  let currentIndex = sorted.findIndex((s) => !dayjs(s.start_at).isAfter(now) && !dayjs(s.end_at).isBefore(now));
  if (currentIndex === -1) currentIndex = sorted.findIndex((s) => dayjs(s.start_at).isAfter(now));
  if (currentIndex === -1) currentIndex = sorted.length - 1;

  useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [currentIndex, sorted.length]);

  return (
    <div className="job-item-route">
      {sorted.map((s, i) => {
        const dist = Math.abs(i - currentIndex);
        const isCurrent = i === currentIndex;
        return (
          <span key={s.id} ref={isCurrent ? currentRef : null} className="job-route-step" style={{ opacity: isCurrent ? 1 : Math.max(0.3, 1 - dist * 0.3) }}>
            {i > 0 && <span className="job-route-arrow">→</span>}
            <span
              className={`job-route-chip${isCurrent ? ' is-current' : ''}`}
              style={{ '--chip-color': STATUS_COLORS[effectiveStatus(s, now)] }}
              title={posts.find((p) => p.id === s.post_id)?.name}
            >
              {posts.find((p) => p.id === s.post_id)?.name || '—'}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default function Gantt({ onCreateJob, openJobId, onOpenJobHandled }) {
  const [posts, setPosts] = useState([]);
  const [stages, setStages] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [masters, setMasters] = useState([]);
  const [rangeStart, setRangeStart] = useState(dayjs().startOf('day'));
  const [days, setDays] = useState(7);
  const [rowMode, setRowMode] = useState('post'); // 'post' | 'master'
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const hourWidth = ZOOM_LEVELS[zoomIndex];
  const [selectedStage, setSelectedStage] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [hoveredJobId, setHoveredJobId] = useState(null);
  const [hoveredStageId, setHoveredStageId] = useState(null);
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(dayjs());
  const [dragLocked, setDragLocked] = useState(() => localStorage.getItem('gantt-drag-locked') === 'true');
  const [dragInfo, setDragInfo] = useState(null);
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
  const [docsJob, setDocsJob] = useState(null);
  const [detailJob, setDetailJob] = useState(null);
  const [company, setCompany] = useState({});
  const workHourStart = company.workHourStart ?? 8;
  const workHourEnd = company.workHourEnd ?? 20;
  const dayWidth = dayWidthFor(hourWidth, workHourStart, workHourEnd);

  async function openDocs(jobId) {
    setDocsJob(await api.jobs.get(jobId));
  }

  async function refreshDetailJob(jobId) {
    const fresh = await api.jobs.get(jobId);
    if (fresh) fresh.job_id = jobId;
    setDetailJob(fresh);
    return fresh;
  }

  // Deep link from the warehouse tab ("Открыть заказ-наряд →" on a linked cell).
  useEffect(() => {
    if (!openJobId) return;
    refreshDetailJob(openJobId).finally(() => onOpenJobHandled && onOpenJobHandled());
  }, [openJobId]);

  const load = async () => {
    const [g, m] = await Promise.all([api.gantt(), api.masters.list()]);
    setPosts(g.posts);
    setStages(g.stages);
    setJobs(g.jobs);
    setMasters(m);
    setLoading(false);
  };

  useEffect(() => { api.settings.getCompany().then(setCompany); }, []);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 60000);
    return () => clearInterval(t);
  }, []);

  const dayList = useMemo(
    () => Array.from({ length: days }, (_, i) => rangeStart.add(i, 'day')),
    [rangeStart, days]
  );

  // Spacing adapts to zoom: fewer, wider-spaced ticks when zoomed out, hourly ticks when zoomed in.
  const hourTickInterval = HOUR_TICK_CANDIDATES.find((h) => h * hourWidth >= 40) ?? 12;
  // Labels only inside working hours — the compressed off-hours band is so
  // narrow that ticks at the same interval would overlap into unreadable
  // mush, and it's already marked by the shaded band itself.
  const hourTicks = useMemo(() => {
    const ticks = [];
    for (let d = 0; d < days; d++) {
      const dayStart = rangeStart.add(d, 'day');
      ticks.push({ key: `${dayStart.format()}-0`, x: dateToX(dayStart, rangeStart, hourWidth, workHourStart, workHourEnd), label: '00:00', isDayStart: true });
      for (let h = hourTickInterval; h < 24; h += hourTickInterval) {
        if (h < workHourStart || h > workHourEnd) continue;
        const t = dayStart.add(h, 'hour');
        ticks.push({ key: t.format(), x: dateToX(t, rangeStart, hourWidth, workHourStart, workHourEnd), label: t.format('HH:mm'), isDayStart: false });
      }
    }
    return ticks;
  }, [days, rangeStart, hourWidth, hourTickInterval, workHourStart, workHourEnd]);

  // Non-working bands (before opening / after closing) per visible day, for the shaded background.
  const offHourBands = useMemo(() => {
    const bands = [];
    for (let d = 0; d < days; d++) {
      const dayStart = rangeStart.add(d, 'day');
      const x0 = dateToX(dayStart, rangeStart, hourWidth, workHourStart, workHourEnd);
      const xWorkStart = dateToX(dayStart.add(workHourStart, 'hour'), rangeStart, hourWidth, workHourStart, workHourEnd);
      const xWorkEnd = dateToX(dayStart.add(workHourEnd, 'hour'), rangeStart, hourWidth, workHourStart, workHourEnd);
      const x1 = dateToX(dayStart.add(1, 'day'), rangeStart, hourWidth, workHourStart, workHourEnd);
      if (xWorkStart > x0) bands.push({ key: `${d}-pre`, left: x0, width: xWorkStart - x0 });
      if (x1 > xWorkEnd) bands.push({ key: `${d}-post`, left: xWorkEnd, width: x1 - xWorkEnd });
    }
    return bands;
  }, [days, rangeStart, hourWidth, workHourStart, workHourEnd]);

  const rows = useMemo(() => {
    if (rowMode === 'post') return posts;
    if (rowMode === 'job') {
      return jobs
        .filter((j) => j.stages.length > 0)
        .map((j) => ({ id: j.job_id, name: `${j.car_model}${j.plate_number ? ` (${j.plate_number})` : ''}` }));
    }
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
      [j.car_model, j.plate_number, j.client_name, j.order_number, j.storage_location, ...api.warehouse.cellIds(j)].some((v) => (v || '').toLowerCase().includes(q))
    );
  }, [jobs, search]);

  const conflictCount = conflictsByStage.size;

  async function patchStage(id, patch) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    await api.stages.update(id, patch);
  }

  async function finalizeJob(job, overall) {
    if (overall !== 'done') {
      if (!window.confirm('Не все этапы завершены. Всё равно завершить заказ и убрать его в историю?')) return;
    }
    if (selectedJobId === job.job_id) setSelectedJobId(null);
    const freedIds = api.warehouse.cellIds(job);
    await api.jobs.archive(job.job_id);
    await api.warehouse.freeJobCells(job);
    showToast(freedIds.length ? `Заказ завершён, ячейки освобождены: ${freedIds.join(', ')}` : 'Заказ завершён и перемещён в историю');
    load();
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
    setJobs(g.jobs);
    return g.stages.find((s) => s.id === newStage.id) || null;
  }

  function startDrag(e, stage, mode) {
    if (dragLocked) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const origStart = dayjs(stage.start_at);
    const origEnd = dayjs(stage.end_at);
    // Drag works off absolute cursor position (not accumulated pixel deltas)
    // because the compressed non-working hours mean pixels-per-minute isn't
    // constant across the timeline — see dateToX/xToDate above.
    const origStartX = dateToX(origStart, rangeStart, hourWidth, workHourStart, workHourEnd);
    const origEndX = dateToX(origEnd, rangeStart, hourWidth, workHourStart, workHourEnd);
    const dur = origEnd.diff(origStart, 'minute');
    let lastStart = origStart;
    let lastEnd = origEnd;
    let changed = false;

    function onMove(ev) {
      const deltaPx = ev.clientX - startX;
      let nextStart = origStart;
      let nextEnd = origEnd;

      if (mode === 'move') {
        nextStart = roundTo15(xToDate(origStartX + deltaPx, rangeStart, hourWidth, workHourStart, workHourEnd));
        nextEnd = nextStart.add(dur, 'minute');
      } else if (mode === 'resize-right') {
        nextEnd = roundTo15(xToDate(origEndX + deltaPx, rangeStart, hourWidth, workHourStart, workHourEnd));
        if (nextEnd.diff(origStart, 'minute') < MIN_DURATION_MINUTES) return;
      } else {
        nextStart = roundTo15(xToDate(origStartX + deltaPx, rangeStart, hourWidth, workHourStart, workHourEnd));
        if (origEnd.diff(nextStart, 'minute') < MIN_DURATION_MINUTES) return;
      }

      if (nextStart.isSame(lastStart) && nextEnd.isSame(lastEnd)) return;
      lastStart = nextStart;
      lastEnd = nextEnd;
      changed = true;
      setStages((prev) => prev.map((s) => (
        s.id === stage.id ? { ...s, start_at: nextStart.toISOString(), end_at: nextEnd.toISOString() } : s
      )));
      setDragInfo({ stageId: stage.id, start: nextStart, end: nextEnd });
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragInfo(null);
      if (changed) {
        suppressClickRef.current = true;
        setStages((prev) => {
          const moved = prev.find((s) => s.id === stage.id);
          if (moved) api.stages.update(moved.id, { start_at: moved.start_at, end_at: moved.end_at });
          return prev;
        });
      }
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

  const totalWidth = days * dayWidth;
  const showNowLine = !now.isBefore(rangeStart) && now.isBefore(rangeStart.add(days, 'day'));
  const nowX = showNowLine ? dateToX(now, rangeStart, hourWidth, workHourStart, workHourEnd) : null;
  const rowHeights = rows.map((row) => {
    const { laneCount } = computeLanes(stagesByRow[row.id] || []);
    return Math.max(ROW_HEIGHT, laneCount * LANE_HEIGHT + (laneCount - 1) * LANE_GAP + 16);
  });
  const gridHeight = HEADER_HEIGHT + rowHeights.reduce((sum, h) => sum + h + 1, 0);

  const rowTops = useMemo(() => {
    let y = HEADER_HEIGHT;
    return rows.map((row, i) => {
      const top = y;
      y += rowHeights[i] + 1;
      return top;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, stagesByRow]);

  // Absolute vertical center of each stage's bar, used to draw connectors
  // between consecutive stages of the same job across different rows.
  const stageLayout = useMemo(() => {
    const map = new Map();
    rows.forEach((row, i) => {
      const rowStages = stagesByRow[row.id] || [];
      const { laneOf } = computeLanes(rowStages);
      rowStages.forEach((s) => {
        const lane = laneOf.get(s.id) || 0;
        map.set(s.id, rowTops[i] + 8 + lane * (LANE_HEIGHT + LANE_GAP) + LANE_HEIGHT / 2);
      });
    });
    return map;
  }, [rows, stagesByRow, rowTops]);

  const jobLinks = useMemo(() => {
    if (rowMode === 'job') return [];
    const byJob = new Map();
    for (const s of stages) {
      if (!byJob.has(s.job_id)) byJob.set(s.job_id, []);
      byJob.get(s.job_id).push(s);
    }
    const links = [];
    for (const list of byJob.values()) {
      const sorted = [...list].sort((a, b) => dayjs(a.start_at).valueOf() - dayjs(b.start_at).valueOf());
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i], b = sorted[i + 1];
        const y1 = stageLayout.get(a.id), y2 = stageLayout.get(b.id);
        if (y1 == null || y2 == null) continue;
        links.push({
          id: `${a.id}-${b.id}`,
          x1: dateToX(a.end_at, rangeStart, hourWidth, workHourStart, workHourEnd), y1,
          x2: dateToX(b.start_at, rangeStart, hourWidth, workHourStart, workHourEnd), y2,
          jobId: a.job_id,
        });
      }
    }
    return links;
  }, [stages, stageLayout, rowMode, rangeStart, hourWidth]);

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
            const isQueued = j.stages.length === 0;
            return (
            <div
              key={j.job_id}
              className={`job-item${isQueued ? ' is-queued' : ''}${hoveredJobId === j.job_id ? ' hovered' : ''}`}
              onClick={() => setDetailJob(j)}
              onMouseEnter={() => setHoveredJobId(j.job_id)}
              onMouseLeave={() => setHoveredJobId(null)}
            >
              <div className="job-item-head">
                <div className="job-item-title">{j.car_model}{j.order_number ? <span className="job-item-order"> №{j.order_number}</span> : ''}</div>
                <div className="job-item-head-actions">
                  <span className="job-status-badge" style={{ '--badge-color': STATUS_COLORS[overall] }}>{STATUS_LABELS[overall]}</span>
                  <button
                    className="job-item-docs"
                    title="Документы: заказ-наряд, акты"
                    onClick={(e) => { e.stopPropagation(); openDocs(j.job_id); }}
                  >
                    📄
                  </button>
                  {!isQueued && (
                    <button
                      className="job-item-finish"
                      title="Завершить и убрать в историю"
                      onClick={(e) => { e.stopPropagation(); finalizeJob(j, overall); }}
                    >
                      ✓
                    </button>
                  )}
                </div>
              </div>
              <div className="job-item-sub">{j.plate_number || '—'} {j.client_name ? `· ${j.client_name}` : ''}</div>
              {(api.warehouse.cellIds(j).length || j.storage_location) && <div className="job-item-storage">📦 {api.warehouse.cellIds(j).join(', ') || j.storage_location}</div>}
              {isQueued && j.expected_at && (
                <div className="job-item-deadline">🕒 заедет {dayjs(j.expected_at).format('DD.MM HH:mm')}</div>
              )}
              {j.deadline && (
                <div className={`job-item-deadline${dlState ? ` is-${dlState}` : ''}`}>
                  ⏰ до {dayjs(j.deadline).format('DD.MM HH:mm')}
                  {dlState === 'missed' && ' — просрочен'}
                  {dlState === 'at-risk' && ' — под угрозой'}
                </div>
              )}
              {isQueued ? (
                <div className="job-item-queued-hint">🛣 Маршрут не задан — нажмите, чтобы запланировать</div>
              ) : (
                <div className="job-item-route-row">
                  <RouteStrip stages={j.stages} posts={posts} now={now} />
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
              )}
            </div>
            );
          })}
          {filteredJobs.length === 0 && <div className="job-empty">Ничего не найдено</div>}
        </div>
        <button className="job-sidebar-new" onClick={onCreateJob}>+ Добавить автомобиль</button>
      </aside>

      <div className="gantt">
        <div className="gantt-toolbar">
          <div className="row-mode-toggle">
            <button className={rowMode === 'post' ? 'active' : ''} onClick={() => setRowMode('post')}>По постам</button>
            <button className={rowMode === 'master' ? 'active' : ''} onClick={() => setRowMode('master')}>По мастерам</button>
            <button className={rowMode === 'job' ? 'active' : ''} onClick={() => setRowMode('job')}>По машинам</button>
          </div>

          <div className="toolbar-divider" />

          <div className="date-nav">
            <button onClick={() => setRangeStart((d) => d.subtract(1, 'day'))} title="Предыдущий день">◀</button>
            <strong>{rangeStart.format('DD.MM')} — {rangeStart.add(days - 1, 'day').format('DD.MM')}</strong>
            <button onClick={() => setRangeStart((d) => d.add(1, 'day'))} title="Следующий день">▶</button>
            <span className="date-nav-sep" />
            <button onClick={() => setRangeStart(dayjs().startOf('day'))}>Сегодня</button>
            <span className="date-nav-sep" />
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={3}>3 дня</option>
              <option value={7}>7 дней</option>
              <option value={14}>14 дней</option>
            </select>
          </div>

          <div className="toolbar-tools" style={{ marginLeft: conflictCount > 0 ? 0 : 'auto' }}>
            <button onClick={load} title="Обновить данные">↻</button>
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
              {dragLocked ? '🔒' : '🔓'}
            </button>
          </div>

          {conflictCount > 0 && <span className="conflict-banner" style={{ marginLeft: 'auto' }}>⚠ Конфликтов: {conflictCount}</span>}
          <div className="legend">
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <span key={k} className="legend-item"><i style={{ background: STATUS_COLORS[k] }} />{label}</span>
            ))}
          </div>
        </div>

        <div className="gantt-scroll" ref={scrollRef} onClick={() => setSelectedJobId(null)}>
          <div className="gantt-grid" style={{ width: LABEL_WIDTH + totalWidth }}>
            <div className="gantt-header" style={{ width: LABEL_WIDTH + totalWidth }}>
              <div className="gantt-header-row">
                <div className="gantt-row-label gantt-corner">{rowMode === 'post' ? 'Посты' : rowMode === 'job' ? 'Машины' : 'Мастера'}</div>
                <div className="gantt-days" style={{ width: totalWidth }}>
                  {dayList.map((d) => (
                    <div key={d.format()} className={`gantt-day${d.isSame(now, 'day') ? ' is-today' : ''}`} style={{ width: dayWidth }}>
                      {d.format('dd DD.MM')}
                    </div>
                  ))}
                </div>
              </div>
              <div className="gantt-hour-row">
                <div className="gantt-corner-sub" />
                <div className="gantt-hour-labels" style={{ width: totalWidth }}>
                  {hourTicks.filter((t) => !t.isDayStart).map((t) => (
                    <span key={t.key} className="gantt-hour-label" style={{ left: t.x }}>{t.label}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="gantt-offhours-grid" style={{ position: 'absolute', left: LABEL_WIDTH, top: HEADER_HEIGHT, width: totalWidth, height: gridHeight - HEADER_HEIGHT, pointerEvents: 'none' }}>
              {offHourBands.map((b) => (
                <div key={b.key} className="gantt-offhours-band" style={{ left: b.left, width: b.width }} />
              ))}
            </div>

            <div className="gantt-hour-grid" style={{ position: 'absolute', left: LABEL_WIDTH, top: HEADER_HEIGHT, width: totalWidth, height: gridHeight - HEADER_HEIGHT, pointerEvents: 'none' }}>
              {hourTicks.map((t) => (
                <div key={t.key} className={`gantt-hour-line${t.isDayStart ? ' is-day-start' : ''}`} style={{ left: t.x }} />
              ))}
            </div>

            {jobLinks.length > 0 && (
              <svg className="gantt-links" width={totalWidth} height={gridHeight} style={{ position: 'absolute', left: LABEL_WIDTH, top: 0, pointerEvents: 'none' }}>
                {jobLinks.map((l) => {
                  // Rounded elbow instead of a bezier "S" — a straight midpoint turn
                  // can't loop or overshoot no matter how the two stages are placed
                  // relative to each other, unlike a curve with fixed control points.
                  const midX = (l.x1 + l.x2) / 2;
                  const d = l.y1 === l.y2
                    ? `M${l.x1},${l.y1} H${l.x2}`
                    : `M${l.x1},${l.y1} H${midX} V${l.y2} H${l.x2}`;
                  return (
                    <path
                      key={l.id}
                      d={d}
                      className={`gantt-link${hoveredJobId === l.jobId || selectedJobId === l.jobId ? ' is-focused' : ''}`}
                      fill="none"
                      strokeLinejoin="round"
                    />
                  );
                })}
              </svg>
            )}

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
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                    {rowStages.length > 0 && (
                      <span className="load-wrap">
                        <span className={`load-bar${loadPct >= 90 ? ' load-high' : loadPct >= 60 ? ' load-mid' : ''}`}><i style={{ width: `${loadPct}%` }} /></span>
                        <span className={`load-pill${loadPct >= 90 ? ' load-high' : loadPct >= 60 ? ' load-mid' : ''}`}>{loadPct}%</span>
                      </span>
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
                        <div className="gantt-deadline-line" style={{ left: dateToX(job.deadline, rangeStart, hourWidth, workHourStart, workHourEnd), height: rowHeight }}>
                          <span className="gantt-deadline-label">дедлайн {dl.format('DD.MM HH:mm')}</span>
                        </div>
                      );
                    })()}
                    {rowStages.map((s) => {
                      const x = dateToX(s.start_at, rangeStart, hourWidth, workHourStart, workHourEnd);
                      const x2 = dateToX(s.end_at, rangeStart, hourWidth, workHourStart, workHourEnd);
                      const width = Math.max(x2 - x, 10);
                      const isFocused = selectedJobId === s.job_id || hoveredJobId === s.job_id;
                      const isDimmed = (selectedJobId || hoveredJobId) && !isFocused;
                      const status = effectiveStatus(s, now);
                      const conflicts = conflictsByStage.get(s.id);
                      const conflictTitle = conflicts ? `\nКонфликт с: ${conflicts.map((c) => c.stage.car_model).join(', ')} (${conflicts[0].reason === 'post' ? 'тот же пост' : 'тот же мастер'})` : '';
                      const lane = laneOf.get(s.id) || 0;
                      const top = 8 + lane * (LANE_HEIGHT + LANE_GAP);
                      const isDragging = dragInfo?.stageId === s.id;
                      return (
                        <div
                          key={s.id}
                          className={`gantt-bar${isFocused ? ' is-focused' : ''}${isDimmed ? ' is-dimmed' : ''}${conflicts ? ' has-conflict' : ''}${dragLocked ? ' is-locked' : ''}${isDragging ? ' is-dragging' : ''}`}
                          draggable={!dragLocked}
                          onDragStart={(e) => e.dataTransfer.setData('stageId', String(s.id))}
                          style={{ left: x, width, top, height: LANE_HEIGHT, background: STATUS_COLORS[status] || '#888' }}
                          onMouseDown={(e) => startDrag(e, s, 'move')}
                          onMouseEnter={() => { setHoveredJobId(s.job_id); setHoveredStageId(s.id); }}
                          onMouseLeave={() => { setHoveredJobId(null); setHoveredStageId(null); }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                            setSelectedStage(s);
                          }}
                        >
                          {isDragging ? (
                            <div className="gantt-bar-tooltip">
                              {dragInfo.start.format('DD.MM HH:mm')} – {dragInfo.end.format('DD.MM HH:mm')}
                            </div>
                          ) : hoveredStageId === s.id && (
                            <div className="gantt-bar-tooltip">
                              <div className="gantt-bar-tooltip-title">{s.car_model}{s.plate_number ? ` · ${s.plate_number}` : ''}</div>
                              <div className="gantt-bar-tooltip-sub">{dayjs(s.start_at).format('DD.MM HH:mm')} – {dayjs(s.end_at).format('DD.MM HH:mm')}</div>
                              <div className="gantt-bar-tooltip-sub">{s.master_name || 'без мастера'}{s.order_number ? ` · №${s.order_number}` : ''}</div>
                              {conflicts && <div className="gantt-bar-tooltip-sub is-conflict">{conflictTitle.replace(/^\n/, '')}</div>}
                              {(isOvertimeHour(hourOf(s.start_at), workHourStart, workHourEnd) || isOvertimeHour(hourOf(s.end_at), workHourStart, workHourEnd)) && (
                                <div className="gantt-bar-tooltip-sub is-overtime">⏱ Есть овертайм — вне рабочих часов</div>
                              )}
                            </div>
                          )}
                          {conflicts && <span className="conflict-flag">⚠</span>}
                          {isOvertimeHour(hourOf(s.start_at), workHourStart, workHourEnd) && (
                            <span className="gantt-bar-overtime left">⏱</span>
                          )}
                          {isOvertimeHour(hourOf(s.end_at), workHourStart, workHourEnd) && (
                            <span className="gantt-bar-overtime right">⏱</span>
                          )}
                          <div className="gantt-bar-content">
                            <span className="gantt-bar-label">{rowMode === 'job' ? (posts.find((p) => p.id === s.post_id)?.name || s.car_model) : s.car_model}</span>
                            {width > 90 && (
                              <span className="gantt-bar-sub">
                                {dayjs(s.start_at).format('HH:mm')}–{dayjs(s.end_at).format('HH:mm')}{s.master_name ? ` · ${s.master_name.split(' ')[0]}` : ''}
                              </span>
                            )}
                          </div>
                          {!dragLocked && (
                            <>
                              <div className="gantt-bar-resize left" onMouseDown={(e) => startDrag(e, s, 'resize-left')} />
                              <div className="gantt-bar-resize right" onMouseDown={(e) => startDrag(e, s, 'resize-right')} />
                            </>
                          )}
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
          onSaved={(patch) => {
            patchStage(selectedStage.id, patch);
            setSelectedStage(null);
          }}
          onDeleted={async () => { await api.stages.remove(selectedStage.id); setSelectedStage(null); load(); }}
          onAddNext={async () => {
            const created = await addNextStage(selectedStage);
            setSelectedStage(created);
          }}
          onOpenCar={async () => {
            const job = await api.jobs.get(selectedStage.job_id);
            setSelectedStage(null);
            setDetailJob(job);
          }}
        />
      )}

      {docsJob && (
        <DocumentsModal
          job={docsJob}
          company={company}
          onClose={() => setDocsJob(null)}
          onJobUpdated={async () => setDocsJob(await api.jobs.get(docsJob.id))}
        />
      )}

      {detailJob && (
        <CarDetailModal
          job={detailJob}
          posts={posts}
          masters={masters}
          now={now}
          onClose={() => setDetailJob(null)}
          onOpenDocs={() => { openDocs(detailJob.job_id); setDetailJob(null); }}
          onFinalize={() => { finalizeJob(detailJob, jobOverallStatus(detailJob, now)); setDetailJob(null); }}
          onRemove={async () => {
            if (!window.confirm('Удалить эту машину без возможности восстановить?')) return;
            const freedIds = api.warehouse.cellIds(detailJob);
            await api.warehouse.freeJobCells(detailJob);
            await api.jobs.remove(detailJob.job_id);
            if (freedIds.length) showToast(`Машина удалена, ячейки освобождены: ${freedIds.join(', ')}`);
            setDetailJob(null);
            load();
          }}
          onEditStage={(stage) => { setSelectedStage(stage); setDetailJob(null); }}
          onUpdateJob={async (patch) => {
            await api.jobs.update(detailJob.job_id, patch);
            const merged = { ...detailJob, ...patch };
            if ('cell_ids' in patch) {
              const before = api.warehouse.cellIds(detailJob);
              const after = patch.cell_ids || [];
              await api.warehouse.setJobCells(merged, after);
              if (after.length && !before.length) showToast(`Машина поставлена в ячейки: ${after.join(', ')}`);
              else if (!after.length && before.length) showToast(`Ячейки освобождены: ${before.join(', ')}`);
              else if (after.join(',') !== before.join(',')) showToast(`Ячейки обновлены: ${after.join(', ') || '—'}`);
            } else if (api.warehouse.cellIds(merged).length) {
              await api.warehouse.syncParts(merged);
            }
            await refreshDetailJob(detailJob.job_id);
            load();
          }}
          onAddStage={async (stageData) => {
            await api.stages.create(detailJob.job_id, stageData);
            await refreshDetailJob(detailJob.job_id);
            load();
          }}
        />
      )}
    </div>
  );
}

function StageEditor({ stage, posts, masters, onClose, onSaved, onDeleted, onAddNext, onOpenCar }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    post_id: stage.post_id,
    master_id: stage.master_id || '',
    status: stage.status,
    start_at: dayjs(stage.start_at).format('YYYY-MM-DDTHH:mm'),
    end_at: dayjs(stage.end_at).format('YYYY-MM-DDTHH:mm'),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stage-editor" onClick={(e) => e.stopPropagation()}>
        <div className="stage-editor-header">
          <h3>{stage.car_model} {stage.plate_number ? `(${stage.plate_number})` : ''}</h3>
          <button className="stage-editor-car-link" onClick={onOpenCar}>Карточка машины →</button>
        </div>

        <div className="stage-editor-grid">
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
              {Object.entries(STATUS_LABELS).filter(([k]) => k !== 'queued').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label>Начало
            <input type="datetime-local" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
          </label>
          <label>Конец
            <input type="datetime-local" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} />
          </label>
        </div>

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
            })}>Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  );
}
