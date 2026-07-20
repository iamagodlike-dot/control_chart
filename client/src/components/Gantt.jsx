import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { isInsurance, PAYMENT_SHORT } from '../insurance';
import { PHASE, DEFAULT_APPROVAL_STATUS } from '../phase';
import DocumentsModal from './DocumentsModal';
import CarCard from './CarCard';
import AlertStrip from './AlertStrip';
import Icon from './Icon';
import DateTimeField from './DateTimeField';
import { DocsButton, FinishButton } from './RowActionButtons';

const fmtMoney = (n) => `${(Number(n) || 0).toLocaleString('ru-RU')} ₽`;
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

// The one-tap "advance" action for a stage: Запланировано → Начать → В работе →
// Готово. `due` = the scheduled moment has arrived — drives the nudge highlight.
// We never flip the status on our own, only offer the next step for one tap.
export function nextStatusAction(stage, now) {
  if (stage.status === 'done') return null;
  if (stage.status === 'in_progress') {
    return { next: 'done', label: 'Готово', icon: '✓', due: dayjs(stage.end_at).isBefore(now) };
  }
  return { next: 'in_progress', label: 'Начать', icon: '▶', due: !dayjs(stage.start_at).isAfter(now) };
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

export default function Gantt({ openJobId, onOpenJobHandled, tv = false, isOwner = false }) {
  // TV / kiosk mode: a clean, read-only view for the big screen in the shop.
  // No editing affordances, bigger bars, auto-follows the current day & time,
  // and keeps the display awake. Opened via the ?tv=1 URL.
  const readOnly = !!tv;
  const [posts, setPosts] = useState([]);
  const [stages, setStages] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [masters, setMasters] = useState([]);
  // Start one day earlier so "now" always has lead-in context (yesterday's tail)
  // before it, instead of being jammed to the left edge in the early morning.
  const [rangeStart, setRangeStart] = useState(dayjs().subtract(1, 'day').startOf('day'));
  const [days, setDays] = useState(tv ? 3 : 7);
  const [rowMode, setRowMode] = useState('post'); // 'post' | 'master'
  const [zoomIndex, setZoomIndex] = useState(tv ? 3 : DEFAULT_ZOOM_INDEX);
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
  const suppressClickRef = useRef(false);

  // Auto-dismiss declaratively (no ref writes in render-reachable helpers): an
  // action toast lingers longer so there's time to hit Отменить / Начать.
  useEffect(() => {
    if (!toast) return undefined;
    const ms = typeof toast === 'string' ? 4000 : 7000;
    const t = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(t);
  }, [toast]);

  // Toast with one or more inline buttons. Actions are plain DATA (not closures)
  // so runToastAction — re-created fresh on every render — interprets them against
  // LIVE state, never a stale snapshot captured when the toast was shown.
  function showActionToast(message, actions) {
    setToast({ message, actions });
  }

  async function runToastAction(action) {
    setToast(null);
    if (action.kind === 'undo') {
      for (const c of action.changes) await patchStage(c.id, { status: c.prev });
      if (detailJob?.job_id === action.jobId) await refreshDetailJob(action.jobId);
    } else if (action.kind === 'start') {
      const fresh = stages.find((s) => s.id === action.stageId);
      if (fresh && fresh.status === 'planned') advanceStage(fresh);
    }
  }

  function showToast(message) {
    setToast(message);
  }
  const scrollRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [docsJob, setDocsJob] = useState(null);
  const [detailJob, setDetailJob] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
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
    const [g, m, docs] = await Promise.all([api.gantt(), api.masters.list(), api.orderDocuments.listAll().catch(() => [])]);
    setPosts(g.posts);
    setStages(g.stages);
    setJobs(g.jobs);
    setMasters(m);
    setInvoices(docs.filter((d) => d.type === 'invoice'));
    setLoading(false);
  };

  useEffect(() => { api.settings.getCompany().then(setCompany); }, []);

  // Live data: subscribe once and let Firestore push every change (from any
  // device) straight onto the screen — no manual refresh needed. The returned
  // function unsubscribes when the component unmounts.
  useEffect(() => {
    const unsub = api.subscribeGantt(
      ({ posts, stages, jobs, masters, invoices }) => {
        setPosts(posts);
        setStages(stages);
        setJobs(jobs);
        setMasters(masters);
        setInvoices(invoices);
        setLoading(false);
      },
      (err) => console.error('Живые обновления графика недоступны:', err),
    );
    return unsub;
  }, []);

  // Tick the clock every minute (drives the «now» line). In TV mode also roll
  // the visible window onto the new day at midnight so a screen left running for
  // days always shows today.
  useEffect(() => {
    const t = setInterval(() => {
      const n = dayjs();
      setNow(n);
      if (tv) setRangeStart((prev) => (prev.isSame(n, 'day') ? prev : n.startOf('day')));
    }, 60000);
    return () => clearInterval(t);
  }, [tv]);

  // TV mode: keep the monitor from going to sleep while the schedule is shown.
  // The lock is dropped when the tab is hidden, so re-acquire it on return.
  useEffect(() => {
    if (!tv || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    const request = async () => {
      try { lock = await navigator.wakeLock.request('screen'); } catch { /* denied / unsupported — ignore */ }
    };
    request();
    const onVisible = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (lock) lock.release().catch(() => {});
    };
  }, [tv]);

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
    // Warn before archiving a car that still has an unpaid счёт — otherwise its debt
    // lingers in Финансы with no car to open on the active screens.
    try {
      const invs = await api.orderDocuments.listByJob(job.job_id, 'invoice');
      const unpaid = invs.filter((i) => !i.paid);
      if (unpaid.length) {
        const sum = unpaid.reduce((s, i) => s + (Number(i.totals?.total) || 0), 0);
        if (!window.confirm(`По этой машине есть неоплаченный счёт${sum ? ` на ${sum.toLocaleString('ru-RU')} ₽` : ''}. Всё равно завершить заказ?`)) return;
      }
    } catch { /* если не удалось проверить счета — не блокируем завершение */ }
    if (selectedJobId === job.job_id) setSelectedJobId(null);
    const freedIds = api.warehouse.cellIds(job);
    await api.jobs.archive(job.job_id);
    await api.warehouse.freeJobCells(job);
    showToast(freedIds.length ? `Заказ завершён, ячейки освобождены: ${freedIds.join(', ')}` : 'Заказ завершён и перемещён в историю');
    load();
  }

  async function addNextStage(fromStage) {
    // Read fresh so we chain after the latest saved end (e.g. the stage editor
    // may have just persisted a new end via "Сохранить и добавить следующий").
    const fresh = await api.gantt();
    const jobStages = fresh.stages.filter((s) => s.job_id === fromStage.job_id);
    if (!jobStages.length) return null;
    const last = jobStages.reduce((max, s) => (s.sequence > max.sequence ? s : max), jobStages[0]);
    const postIdx = fresh.posts.findIndex((p) => p.id === last.post_id);
    const nextPost = fresh.posts[postIdx + 1] || fresh.posts[postIdx] || fresh.posts[0];
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

  // One-tap status advance with all the guardrails: confirm before «Готово»,
  // warn if the previous stage isn't done, keep only one «В работе» per car
  // (auto-close the previous), then offer to start the next stage — all undoable.
  async function advanceStage(passed) {
    // Resolve against the current render's `stages` (fresh: the bar passes a live
    // stage, and the toast «Начать» is dispatched via runToastAction which also
    // holds live state). undo/next are emitted as data, resolved live on click.
    const stage = stages.find((s) => s.id === passed.id) || passed;
    const action = nextStatusAction(stage, now);
    if (!action) return;
    const jobStages = stages
      .filter((s) => s.job_id === stage.job_id)
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const idx = jobStages.findIndex((s) => s.id === stage.id);
    const postName = (st) => posts.find((p) => p.id === st?.post_id)?.name || 'этап';

    if (action.next === 'done') {
      const prev = idx > 0 ? jobStages[idx - 1] : null;
      const msg = prev && prev.status !== 'done'
        ? `Предыдущий этап «${postName(prev)}» ещё не завершён. Всё равно отметить «${postName(stage)}» готовым?`
        : `Отметить этап «${postName(stage)}» готовым?`;
      if (!window.confirm(msg)) return;
    }

    const changes = [{ id: stage.id, prev: stage.status }];
    let closed = [];
    if (action.next === 'in_progress') {
      closed = jobStages.filter((s) => s.id !== stage.id && s.status === 'in_progress');
      for (const c of closed) changes.push({ id: c.id, prev: c.status });
    }

    await patchStage(stage.id, { status: action.next });
    for (const c of closed) await patchStage(c.id, { status: 'done' });
    if (detailJob?.job_id === stage.job_id) await refreshDetailJob(stage.job_id);

    const actions = [{ label: 'Отменить', kind: 'undo', changes, jobId: stage.job_id }];
    let message = action.next === 'done' ? `«${postName(stage)}» — готово` : `«${postName(stage)}» — в работе`;
    if (closed.length) message += ', предыдущий закрыт';

    if (action.next === 'done') {
      const next = jobStages[idx + 1];
      if (next && next.status === 'planned') {
        actions.push({ label: `Начать «${postName(next)}»`, kind: 'start', stageId: next.id });
      }
    }
    showActionToast(message, actions);
  }

  function startDrag(e, stage, mode) {
    if (dragLocked || readOnly) return;
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
    if (rowMode === 'job' || dragLocked || readOnly) return;
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

  // TV mode: keep "now" centred horizontally so the relevant part of the day is
  // always visible on the wall screen, re-centring each minute as time advances.
  useEffect(() => {
    if (!tv || loading || nowX == null || !scrollRef.current) return;
    const el = scrollRef.current;
    el.scrollLeft = Math.max(0, LABEL_WIDTH + nowX - el.clientWidth / 2);
  }, [tv, loading, nowX, days, zoomIndex, rowMode]);

  // Normal mode: on first load and on layout changes (view/zoom/date), scroll so
  // "now" sits ~28% from the left — leaving a lead-in of recent time BEFORE it,
  // instead of jamming the now-line against the edge. Keyed on structural changes
  // only (NOT on `now`), so it re-positions once and never fights manual scroll.
  useEffect(() => {
    if (tv || loading || !showNowLine) return undefined;
    const apply = () => {
      const el = scrollRef.current;
      if (!el) return;
      const nx = dateToX(now, rangeStart, hourWidth, workHourStart, workHourEnd);
      el.scrollLeft = Math.max(0, LABEL_WIDTH + nx - el.clientWidth * 0.28);
    };
    const raf = requestAnimationFrame(apply);
    const t = setTimeout(apply, 160); // re-apply after live-update churn settles on first load
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tv, loading, days, zoomIndex, rowMode, rangeStart]);

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

  // Shared "add car" modal — the same CarCard as the detail view, but empty.
  // Kept as a variable so it renders in every early-return branch too.
  const createModal = createOpen && (
    <CarCard
      mode="create"
      job={null}
      posts={posts}
      masters={masters}
      now={now}
      onClose={() => setCreateOpen(false)}
      onCreate={async (payload, cellIds) => {
        const created = await api.jobs.create(payload);
        if (cellIds?.length) await api.warehouse.setJobCells(created, cellIds);
        setCreateOpen(false);
        showToast(payload.stages.length ? 'Автомобиль добавлен и поставлен в график' : 'Автомобиль добавлен — ждём заезда, маршрут можно запланировать позже');
        load();
      }}
    />
  );

  // «Требует внимания» counters — derived live from the same jobs/stages/posts.
  // Declared before the early returns so the hook order stays stable.
  const alerts = useMemo(() => {
    const active = jobs.filter((j) => !j.archived);
    let delay = 0; let noRoute = 0; let inProg = 0; let ready = 0;
    for (const j of active) {
      if (!j.stages || j.stages.length === 0) { noRoute += 1; continue; }
      const st = jobOverallStatus(j, now);
      if (st === 'delayed' || deadlineState(j, now) === 'missed') delay += 1;
      else if (st === 'in_progress') inProg += 1;
      else if (st === 'done') ready += 1;
    }
    const busyPosts = new Set(
      stages
        .filter((s) => s.status !== 'done' && !dayjs(s.start_at).isAfter(now) && !dayjs(s.end_at).isBefore(now))
        .map((s) => s.post_id),
    );
    const idle = posts.filter((p) => !busyPosts.has(p.id)).length;
    return [
      { key: 'delay', count: delay, label: 'Задержка', color: 'var(--delay)', pulse: true },
      { key: 'idle', count: idle, label: 'Простой постов', color: 'var(--wait)' },
      { key: 'noroute', count: noRoute, label: 'Без маршрута', color: 'var(--color-primary)' },
      { key: 'prog', count: inProg, label: 'В работе', color: 'var(--progress)' },
      { key: 'ready', count: ready, label: 'Готово к выдаче', color: 'var(--done)' },
    ].filter((a) => a.count > 0);
  }, [jobs, stages, posts, now]);
  const shiftInfo = `Смена активна · ${posts.length} постов · ${masters.length} мастеров`;

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
        {!readOnly && <p>Создайте первую машину с маршрутом по постам — она появится здесь на графике.</p>}
        {!readOnly && <button className="primary" onClick={() => setCreateOpen(true)}>+ Создать первый заказ</button>}
        {createModal}
      </div>
    );
  }

  return (
    <div className={`gantt-page${readOnly ? ' gantt-page--tv' : ''}`}>
      {!readOnly && <AlertStrip alerts={alerts} shift={shiftInfo} />}
      <div className={`gantt-layout${readOnly ? ' gantt-layout--tv' : ''}`}>
      <aside className="job-sidebar">
        {!readOnly && (
          <div className="job-search-wrap">
            <span className="job-search-icon"><Icon name="search" size={16} strokeWidth={1.8} /></span>
            <input
              className="job-search"
              placeholder="Поиск по машине, номеру, клиенту"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
        {!readOnly && (
          <div className="job-queue-label">
            <span>Очередь · {filteredJobs.length}</span>
            <span>сегодня</span>
          </div>
        )}
        <div className="job-list">
          {filteredJobs.map((j) => {
            const dlState = deadlineState(j, now);
            const overall = jobOverallStatus(j, now);
            const isQueued = j.stages.length === 0;
            const jobInvoices = invoices.filter((i) => i.job_id === j.job_id);
            const hasPay = jobInvoices.length > 0;
            const payTotal = jobInvoices.reduce((s, i) => s + (Number(i.totals?.total) || 0), 0);
            const payAllPaid = hasPay && jobInvoices.every((i) => i.paid);
            return (
            <div
              key={j.job_id}
              className={`job-item${isQueued ? ' is-queued' : ''}${overall === 'delayed' ? ' is-delay' : ''}${hoveredJobId === j.job_id ? ' hovered' : ''}${selectedJobId === j.job_id ? ' selected' : ''}`}
              style={{ '--sc': STATUS_COLORS[overall] }}
              onClick={() => (readOnly ? setSelectedJobId((id) => (id === j.job_id ? null : j.job_id)) : setDetailJob(j))}
              onMouseEnter={() => setHoveredJobId(j.job_id)}
              onMouseLeave={() => setHoveredJobId(null)}
            >
              <div className="job-item-head" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="job-item-title" style={{ flex: '1 1 auto', minWidth: 0 }}>{j.car_model}{j.order_number ? <span className="job-item-order"> №{j.order_number}</span> : ''}</div>
                <span className="job-status-badge" style={{ '--badge-color': STATUS_COLORS[overall] }}>{STATUS_LABELS[overall]}</span>
                {!readOnly && (
                  <div className="job-item-head-actions" style={{ flexBasis: '100%', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <DocsButton onClick={() => openDocs(j.job_id)} />
                    {!isQueued && <FinishButton onClick={() => finalizeJob(j, overall)} />}
                  </div>
                )}
              </div>
              <div className="job-item-sub">{j.plate_number || '—'}{j.client_name ? ` · ${j.client_name}` : ''}</div>
              <div className="job-item-meta">
                <div className="job-meta-row">
                  <Icon name="shield" size={14} />
                  <span>{isInsurance(j) && j.insurer_name ? j.insurer_name : (PAYMENT_SHORT[j.payment_type] || 'Наличные')}</span>
                </div>
                {hasPay && (payAllPaid ? (
                  <div className="job-meta-row is-done"><Icon name="check" size={14} strokeWidth={2} /><span>Оплачено</span></div>
                ) : (
                  <div className="job-meta-row is-danger"><span className="job-meta-dot" /><span>Не оплачено · {fmtMoney(payTotal)}</span></div>
                ))}
                {(api.warehouse.cellIds(j).length || j.storage_location) && (
                  <div className="job-meta-row"><Icon name="box" size={14} /><span>{api.warehouse.cellIds(j).join(', ') || j.storage_location}</span></div>
                )}
                {isQueued && j.expected_at && (
                  <div className="job-meta-row"><Icon name="clock" size={14} /><span>заедет {dayjs(j.expected_at).format('DD.MM HH:mm')}</span></div>
                )}
                {j.deadline && (
                  <div className={`job-meta-row${dlState === 'missed' ? ' is-danger' : (dlState === 'at-risk' ? ' is-warn' : '')}`}>
                    <Icon name="clock" size={14} />
                    <span>до {dayjs(j.deadline).format('DD.MM HH:mm')}{dlState === 'missed' ? ' — просрочен' : (dlState === 'at-risk' ? ' — под угрозой' : '')}</span>
                  </div>
                )}
              </div>
              {isQueued ? (
                <div className="job-item-queued-hint">
                  <Icon name="chevron-right" size={15} strokeWidth={1.8} />
                  <span>Маршрут не задан{readOnly ? '' : ' — нажмите, чтобы запланировать'}</span>
                </div>
              ) : (
                <div className="job-item-route-row">
                  <RouteStrip stages={j.stages} posts={posts} now={now} />
                  {!readOnly && (
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
                  )}
                </div>
              )}
            </div>
            );
          })}
          {filteredJobs.length === 0 && <div className="job-empty">Ничего не найдено</div>}
        </div>
        {!readOnly && <button className="job-sidebar-new" onClick={() => setCreateOpen(true)}>+ Добавить автомобиль</button>}
      </aside>

      <div className="gantt">
        {readOnly ? (
          <div className="gantt-toolbar gantt-toolbar--tv">
            <div className="tv-clock">
              <span className="tv-clock-time">{now.format('HH:mm')}</span>
              <span className="tv-clock-date">{now.format('dd, D MMMM')}</span>
            </div>
            <div className="legend">
              {Object.entries(STATUS_LABELS).map(([k, label]) => (
                <span key={k} className="legend-item"><i style={{ background: STATUS_COLORS[k] }} />{label}</span>
              ))}
            </div>
            {conflictCount > 0 && <span className="conflict-banner">⚠ Конфликтов: {conflictCount}</span>}
          </div>
        ) : (
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
            <button onClick={() => setRangeStart(dayjs().subtract(1, 'day').startOf('day'))}>Сегодня</button>
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
        )}

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

            {rows.map((row, rowIdx) => {
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
                <div className={`gantt-row${rowIdx % 2 === 1 ? ' gantt-row--alt' : ''}`} key={row.id} style={{ width: LABEL_WIDTH + totalWidth }}>
                  <div className="gantt-row-label">
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                    {rowStages.length > 0 && (
                      <span className="load-wrap">
                        <span className={`load-bar${loadPct >= 60 ? ' load-high' : loadPct >= 30 ? ' load-mid' : ''}`}><i style={{ width: `${loadPct}%` }} /></span>
                        <span className={`load-pill${loadPct >= 60 ? ' load-high' : loadPct >= 30 ? ' load-mid' : ''}`}>{loadPct}%</span>
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
                          className={`gantt-bar${status === 'delayed' ? ' is-delay' : ''}${isFocused ? ' is-focused' : ''}${isDimmed ? ' is-dimmed' : ''}${conflicts ? ' has-conflict' : ''}${dragLocked ? ' is-locked' : ''}${isDragging ? ' is-dragging' : ''}${isOvertimeHour(hourOf(s.start_at), workHourStart, workHourEnd) ? ' is-ot-start' : ''}${isOvertimeHour(hourOf(s.end_at), workHourStart, workHourEnd) ? ' is-ot-end' : ''}`}
                          draggable={!dragLocked && !readOnly}
                          onDragStart={(e) => e.dataTransfer.setData('stageId', String(s.id))}
                          style={{ left: x, width, top, height: LANE_HEIGHT, '--jc': STATUS_COLORS[status] || '#888' }}
                          onMouseDown={(e) => startDrag(e, s, 'move')}
                          onMouseEnter={() => { setHoveredJobId(s.job_id); setHoveredStageId(s.id); }}
                          onMouseLeave={() => { setHoveredJobId(null); setHoveredStageId(null); }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                            if (readOnly) { setSelectedJobId((id) => (id === s.job_id ? null : s.job_id)); return; }
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
                          <div className="gantt-bar-content">
                            <span className="gantt-bar-label">{rowMode === 'job' ? (posts.find((p) => p.id === s.post_id)?.name || s.car_model) : s.car_model}</span>
                            {width > 90 && (
                              <span className="gantt-bar-sub">
                                {dayjs(s.start_at).format('HH:mm')}–{dayjs(s.end_at).format('HH:mm')}{s.master_name ? ` · ${s.master_name.split(' ')[0]}` : ''}
                              </span>
                            )}
                          </div>
                          {!dragLocked && !readOnly && (
                            <>
                              <div className="gantt-bar-resize left" onMouseDown={(e) => startDrag(e, s, 'resize-left')} />
                              <div className="gantt-bar-resize right" onMouseDown={(e) => startDrag(e, s, 'resize-right')} />
                            </>
                          )}
                          {!readOnly && width >= 40 && (() => {
                            const act = nextStatusAction(s, now);
                            if (!act) return null;
                            return (
                              <button
                                className={`gantt-bar-advance${act.due ? ' is-due' : ''}`}
                                title={`${act.label} этап`}
                                draggable={false}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); advanceStage(s); }}
                              >
                                {act.icon}
                              </button>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {showNowLine && (
              <div className="gantt-now-line" style={{ left: LABEL_WIDTH + nowX, top: HEADER_HEIGHT, height: gridHeight - HEADER_HEIGHT }}>
                <span className="gantt-now-label">{now.format('HH:mm')}</span>
              </div>
            )}
          </div>
        </div>

        {toast && (
          <div className="gantt-toast">
            {typeof toast === 'string' ? toast : (
              <>
                <span>{toast.message}</span>
                {toast.actions.map((a, i) => (
                  <button
                    key={i}
                    className="gantt-toast-btn"
                    onClick={() => runToastAction(a)}
                  >
                    {a.label}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {selectedStage && (
        <StageEditor
          key={selectedStage.id}
          stage={selectedStage}
          posts={posts}
          masters={masters}
          allStages={stages}
          now={now}
          onClose={() => setSelectedStage(null)}
          onSaved={(patch) => {
            patchStage(selectedStage.id, patch);
            setSelectedStage(null);
          }}
          onDeleted={async () => { await api.stages.remove(selectedStage.id); setSelectedStage(null); load(); }}
          onAddNext={async (patch) => {
            if (patch) await patchStage(selectedStage.id, patch);
            const created = await addNextStage({ ...selectedStage, ...(patch || {}) });
            if (created) setSelectedStage(created);
          }}
          onOpenCar={async () => {
            // Go through refreshDetailJob so the job gets its `job_id` stamped —
            // api.jobs.get returns only `id`, and every CarCard callback below
            // reads detailJob.job_id (save/remove/finalize/docs/stages would all
            // hit an undefined id otherwise).
            const jobId = selectedStage.job_id;
            setSelectedStage(null);
            await refreshDetailJob(jobId);
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
        <CarCard
          mode="edit"
          job={detailJob}
          posts={posts}
          masters={masters}
          now={now}
          isOwner={isOwner}
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
          onSaveInfo={async (patch) => {
            await api.jobs.update(detailJob.job_id, patch);
            const merged = { ...detailJob, ...patch };
            const before = api.warehouse.cellIds(detailJob);
            const after = patch.cell_ids || [];
            if (before.join(',') !== after.join(',')) {
              // Diff against the OLD cell set (keep new labels) so cells actually open/free.
              await api.warehouse.setJobCells({ ...merged, cell_ids: before, cell_id: before[0] ?? null }, after);
              if (after.length && !before.length) showToast(`Машина поставлена в ячейки: ${after.join(', ')}`);
              else if (!after.length && before.length) showToast(`Ячейки освобождены: ${before.join(', ')}`);
              else showToast(`Ячейки обновлены: ${after.join(', ') || '—'}`);
            } else if (after.length) {
              await api.warehouse.syncParts(merged);
            }
            await refreshDetailJob(detailJob.job_id);
            load();
          }}
          onAddStage={async (stageData) => {
            const created = await api.stages.create(detailJob.job_id, stageData);
            await refreshDetailJob(detailJob.job_id);
            load();
            return created;
          }}
          onUpdateStage={async (id, patch) => {
            await api.stages.update(id, patch);
            await refreshDetailJob(detailJob.job_id);
            load();
          }}
          onRemoveStage={async (id) => {
            await api.stages.remove(id);
            await refreshDetailJob(detailJob.job_id);
            load();
          }}
          onReturnToApproval={async () => {
            await api.jobs.update(detailJob.job_id, {
              phase: PHASE.APPROVAL,
              approval_status: detailJob.approval_status || DEFAULT_APPROVAL_STATUS,
            });
            setDetailJob(null);
            load();
          }}
        />
      )}

      {createModal}
      </div>
    </div>
  );
}

const SE_FMT = 'YYYY-MM-DDTHH:mm';
const SE_DURATIONS = [1, 2, 3, 4, 6, 8];

function StageEditor({ stage, posts, masters, allStages = [], now, onClose, onSaved, onDeleted, onAddNext, onOpenCar }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    post_id: stage.post_id,
    master_id: stage.master_id || '',
    status: stage.status,
    start_at: dayjs(stage.start_at).format(SE_FMT),
    end_at: dayjs(stage.end_at).format(SE_FMT),
  });

  const start = dayjs(form.start_at);
  const end = dayjs(form.end_at);
  const durationMin = start.isValid() && end.isValid() ? end.diff(start, 'minute') : NaN;
  const invalid = !form.start_at || !form.end_at || !(durationMin > 0);
  const nowD = now || dayjs();
  const badgeStatus = form.status === 'done'
    ? 'done'
    : (end.isValid() && end.isBefore(nowD) ? 'delayed' : form.status);
  const durText = durationMin > 0
    ? `${Math.floor(durationMin / 60)} ч${durationMin % 60 ? ` ${durationMin % 60} мин` : ''}`
    : '—';

  // Moving the start keeps the stage's length (end follows), so scheduling is one
  // action; editing the end (input or a duration chip) sets a new length.
  function setStart(v) {
    setForm((f) => {
      const dur = dayjs(f.end_at).diff(dayjs(f.start_at), 'minute');
      const ns = dayjs(v);
      const ne = ns.isValid() ? ns.add(dur > 0 ? dur : 240, 'minute') : null;
      return { ...f, start_at: v, end_at: ne ? ne.format(SE_FMT) : f.end_at };
    });
  }
  function setEnd(v) { setForm((f) => ({ ...f, end_at: v })); }
  function setDuration(h) {
    setForm((f) => {
      const s = dayjs(f.start_at);
      if (!s.isValid()) return f; // no valid start → don't write "Invalid Date" into end
      return { ...f, end_at: s.add(h, 'hour').format(SE_FMT) };
    });
  }
  function startNow() {
    setForm((f) => {
      const dur = dayjs(f.end_at).diff(dayjs(f.start_at), 'minute');
      const n = roundTo15(dayjs());
      return { ...f, start_at: n.format(SE_FMT), end_at: n.add(dur > 0 ? dur : 240, 'minute').format(SE_FMT) };
    });
  }

  const conflicts = invalid ? [] : allStages.filter((o) =>
    o.id !== stage.id && o.status !== 'done'
    && (o.post_id === form.post_id || (form.master_id && o.master_id === form.master_id))
    && overlaps(start, end, dayjs(o.start_at), dayjs(o.end_at)),
  );
  const conflictText = conflicts
    .map((c) => `${c.car_model || 'машина'}${c.post_id === form.post_id ? ' (тот же пост)' : ' (тот же мастер)'}`)
    .join(', ');

  function buildPatch() {
    return {
      post_id: form.post_id,
      master_id: form.master_id || null,
      status: form.status,
      start_at: dayjs(form.start_at).toISOString(),
      end_at: dayjs(form.end_at).toISOString(),
    };
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cc-modal is-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="cc-header">
          <div className="cc-header-main">
            <span className="cc-header-icon">🔧</span>
            <div className="cc-header-text">
              <h3 className="cc-title">{stage.car_model || 'Этап'}</h3>
              <div className="cc-header-meta">
                {stage.plate_number && <span className="cc-plate">{stage.plate_number}</span>}
                <span className="job-status-badge" style={{ '--badge-color': STATUS_COLORS[badgeStatus] }}>{STATUS_LABELS[badgeStatus]}</span>
                <button className="cc-linkbtn" onClick={onOpenCar}>Карточка машины →</button>
              </div>
            </div>
          </div>
          <button className="cc-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="cc-body">
          <div className="cc-field full">
            <span>Статус</span>
            <div className="seg">
              {['planned', 'in_progress', 'done'].map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`seg-btn${form.status === k ? ' active' : ''}`}
                  style={form.status === k ? { background: STATUS_COLORS[k] } : undefined}
                  onClick={() => setForm({ ...form, status: k })}
                >
                  {STATUS_LABELS[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="cc-grid">
            <label className="cc-field">
              <span>Пост</span>
              <select value={form.post_id} onChange={(e) => setForm({ ...form, post_id: e.target.value })}>
                {posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>Мастер</span>
              <select value={form.master_id} onChange={(e) => setForm({ ...form, master_id: e.target.value })}>
                <option value="">— не назначен —</option>
                {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>Начало</span>
              <DateTimeField value={form.start_at} onChange={setStart} />
            </label>
            <label className="cc-field">
              <span>Конец</span>
              <DateTimeField value={form.end_at} onChange={setEnd} />
            </label>
          </div>

          <div className="se-quick">
            <button type="button" className="dur-chip" onClick={startNow}>🕒 Сейчас</button>
            <span className="se-dur-label">Длительность: <b>{durText}</b></span>
            {SE_DURATIONS.map((h) => (
              <button
                key={h}
                type="button"
                className={`dur-chip${durationMin === h * 60 ? ' active' : ''}`}
                onClick={() => setDuration(h)}
              >
                {h} ч
              </button>
            ))}
          </div>

          {invalid && <div className="se-warn err">⚠ Конец раньше начала — поправьте время (или задайте длительность кнопками)</div>}
          {!invalid && conflicts.length > 0 && <div className="se-warn">⚠ Пересекается: {conflictText}</div>}

          <button
            className="cc-add-stage"
            disabled={adding || invalid}
            onClick={async () => { setAdding(true); try { await onAddNext(buildPatch()); } finally { setAdding(false); } }}
          >
            {adding ? 'Добавляем…' : '＋ Сохранить и добавить этап в конец маршрута'}
          </button>
          <div className="se-hint">Сохранит этот этап и добавит новый в конец маршрута.</div>
        </div>

        <div className="cc-footer">
          <button className="danger" onClick={() => { if (window.confirm('Удалить этот этап?')) onDeleted(); }}>🗑 Удалить</button>
          <div className="cc-footer-actions">
            <button onClick={onClose}>Отмена</button>
            <button className="primary" disabled={invalid} onClick={() => onSaved(buildPatch())}>Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  );
}
