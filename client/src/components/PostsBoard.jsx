import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { iconFor } from '../postIcons';
import { STATUS_COLORS, effectiveStatus, WORKING_HOURS_PER_DAY } from './Gantt';

const IDLE_COLOR = '#475569';
const QUEUE_LIMIT = 4;

export default function PostsBoard() {
  const [posts, setPosts] = useState([]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('today'); // 'today' | 'week'
  const [now, setNow] = useState(dayjs());

  const load = async () => {
    const g = await api.gantt();
    setPosts(g.posts);
    setStages(g.stages);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 60000);
    return () => clearInterval(t);
  }, []);

  const rangeStart = useMemo(() => now.startOf('day'), [now]);
  const rangeEnd = useMemo(() => rangeStart.add(range === 'week' ? 7 : 1, 'day'), [rangeStart, range]);
  const capacityMin = (range === 'week' ? 7 : 1) * WORKING_HOURS_PER_DAY * 60;

  const cards = useMemo(() => {
    return posts.map((post) => {
      const postStages = stages.filter((s) => s.post_id === post.id);

      let occupiedMin = 0;
      for (const s of postStages) {
        const st = dayjs(s.start_at), en = dayjs(s.end_at);
        const clippedStart = st.isAfter(rangeStart) ? st : rangeStart;
        const clippedEnd = en.isBefore(rangeEnd) ? en : rangeEnd;
        if (clippedEnd.isAfter(clippedStart)) occupiedMin += clippedEnd.diff(clippedStart, 'minute');
      }
      const loadPct = Math.min(100, Math.round((occupiedMin / capacityMin) * 100));

      const active = postStages.find((s) => s.status !== 'done' && !dayjs(s.start_at).isAfter(now) && dayjs(s.end_at).isAfter(now));
      const queue = postStages
        .filter((s) => s.status !== 'done' && dayjs(s.start_at).isAfter(now))
        .sort((a, b) => (a.start_at > b.start_at ? 1 : -1))
        .slice(0, QUEUE_LIMIT);

      const accent = active ? STATUS_COLORS[effectiveStatus(active, now)] : IDLE_COLOR;

      return { post, loadPct, active, queue, accent };
    });
  }, [posts, stages, rangeStart, rangeEnd, capacityMin, now]);

  const summary = useMemo(() => {
    const busy = cards.filter((c) => c.active).length;
    const avg = cards.length ? Math.round(cards.reduce((sum, c) => sum + c.loadPct, 0) / cards.length) : 0;
    return { total: cards.length, busy, idle: cards.length - busy, avg };
  }, [cards]);

  if (loading) {
    return (
      <div className="gantt-loading">
        <div className="spinner" />
        <span>Загружаем загрузку постов…</span>
      </div>
    );
  }

  return (
    <div className="board">
      <div className="board-summary">
        <div className="board-summary-stat">
          <span className="board-summary-stat-value">{summary.total}</span>
          <span className="board-summary-stat-label">Постов</span>
        </div>
        <div className="board-summary-stat">
          <span className="board-summary-stat-value">{summary.busy}</span>
          <span className="board-summary-stat-label">Заняты</span>
        </div>
        <div className="board-summary-stat">
          <span className="board-summary-stat-value">{summary.idle}</span>
          <span className="board-summary-stat-label">Свободны</span>
        </div>
        <div className="board-summary-stat">
          <span className="board-summary-stat-value">{summary.avg}%</span>
          <span className="board-summary-stat-label">Средняя загрузка</span>
        </div>
        <div className="board-range-toggle">
          <button className={range === 'today' ? 'active' : ''} onClick={() => setRange('today')}>Сегодня</button>
          <button className={range === 'week' ? 'active' : ''} onClick={() => setRange('week')}>Неделя</button>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="gantt-empty">
          <div className="gantt-empty-icon">🅿️</div>
          <h3>Постов пока нет</h3>
          <p>Добавьте посты на вкладке «Посты и мастера» — они появятся здесь.</p>
        </div>
      ) : (
        <div className="board-grid">
          {cards.map(({ post, loadPct, active, queue, accent }) => (
            <div key={post.id} className="board-card" style={{ '--card-accent': accent }}>
              <div className="board-card-head">
                <span className="board-card-icon">{iconFor(post.name, '🅿️')}</span>
                <span className="board-card-name">{post.name}</span>
                <span className="board-card-status" style={{ '--dot-color': accent }} title={active ? 'Занят' : 'Свободен'} />
              </div>

              <div className="board-card-body">
                <div className="board-ring" style={{ '--pct': loadPct }}>
                  <div className="board-ring-inner">{loadPct}%</div>
                </div>
                {active ? (
                  <div className="board-card-current">
                    <span className="board-card-current-label">Сейчас</span>
                    <span className="board-card-current-value">{active.car_model}{active.plate_number ? ` (${active.plate_number})` : ''}</span>
                    <span className="board-card-current-sub">{active.master_name || 'без мастера'} · до {dayjs(active.end_at).format('HH:mm')}</span>
                  </div>
                ) : (
                  <div className="board-card-current">
                    <span className="board-card-current-label">Сейчас</span>
                    <span className="board-card-idle">Свободен</span>
                  </div>
                )}
              </div>

              <div className="board-queue">
                <div className="board-queue-title">План работы</div>
                {queue.length === 0 ? (
                  <div className="board-queue-empty">Очередь пуста</div>
                ) : (
                  queue.map((s) => (
                    <div key={s.id} className="board-queue-item">
                      <span className="board-queue-dot" style={{ background: STATUS_COLORS[effectiveStatus(s, now)] }} />
                      <span className="board-queue-time">{dayjs(s.start_at).format('DD.MM HH:mm')}</span>
                      <span className="board-queue-name">{s.car_model}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
