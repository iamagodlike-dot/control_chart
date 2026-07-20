// Pure view-model for the master's «Мои машины» screen. No React, no Firestore —
// same style as receiving.js / parts.js, so the fiddly grouping/status logic can
// be unit-tested in isolation (masterWork.test.js, node --test).
//
// A master cares about one thing: which cars are assigned to ME, and for each —
// what work, by when, and is anything overdue. We take the Gantt-joined stages
// (each already carries its car's model / plate / order / deadline) plus the
// posts list (for the work-station name) and fold them into car-grouped cards of
// only THIS master's stages. No costing, no prices — the master never sees money.

// Метки и цвета статусов зеркалят STATUS_LABELS/STATUS_COLORS из Gantt.jsx.
// Держим копию здесь (а не импортируем из Gantt), чтобы модуль оставался без
// зависимостей от React/Firestore и его можно было гонять в node --test.
export const STAGE_STATUS = {
  planned:     { label: 'Запланировано', color: 'var(--status-planned)' },
  in_progress: { label: 'В работе',      color: 'var(--status-in-progress)' },
  done:        { label: 'Готово',        color: 'var(--status-done)' },
  delayed:     { label: 'Задержка',      color: 'var(--status-delayed)' },
  queued:      { label: 'Ожидается',     color: 'var(--status-queued)' },
};

const ms = (v) => (typeof v === 'number' ? v : (v ? new Date(v).getTime() : NaN));

// Как в Gantt.effectiveStatus: готовое — готово; не готово, но срок этапа уже
// прошёл — «задержка»; иначе как записано.
export function effectiveStageStatus(stage, nowMs) {
  if (!stage) return 'planned';
  if (stage.status === 'done') return 'done';
  const end = ms(stage.end_at);
  if (Number.isFinite(end) && end < nowMs) return 'delayed';
  return stage.status || 'planned';
}

// masterId — id записи в коллекции `masters` (у логина мастера лежит в
// users.masterId). stages — этапы, уже склеенные с полями машины (см. buildGantt
// в api.js). posts — [{id, name}] для названия поста (вида работы).
export function buildMasterWork(masterId, { stages = [], posts = [] } = {}, nowMs = Date.now()) {
  const postName = new Map((Array.isArray(posts) ? posts : []).map((p) => [p.id, p.name]));
  const mine = (Array.isArray(stages) ? stages : []).filter(
    (s) => s && masterId && s.master_id === masterId,
  );

  const byJob = new Map();
  for (const s of mine) {
    if (!byJob.has(s.job_id)) {
      byJob.set(s.job_id, {
        jobId: s.job_id,
        car: s.car_model || 'Без модели',
        plate: s.plate_number || '',
        orderNum: s.order_number || '',
        client: s.client_name || '',
        deadline: s.deadline || '',
        stages: [],
      });
    }
    const eff = effectiveStageStatus(s, nowMs);
    const meta = STAGE_STATUS[eff] || STAGE_STATUS.planned;
    byJob.get(s.job_id).stages.push({
      id: s.id,
      post: postName.get(s.post_id) || s.title || 'Работа',
      title: s.title || '',
      start_at: s.start_at || '',
      end_at: s.end_at || '',
      status: s.status || 'planned',
      effStatus: eff,
      overdue: eff === 'delayed',
      statusLabel: meta.label,
      statusColor: meta.color,
    });
  }

  const cards = [...byJob.values()].map((card) => {
    card.stages.sort((a, b) => (ms(a.start_at) || 0) - (ms(b.start_at) || 0));
    card.active = card.stages.some((s) => s.effStatus === 'in_progress');
    card.overdue = card.stages.some((s) => s.overdue);
    card.done = card.stages.length > 0 && card.stages.every((s) => s.status === 'done');
    // Ближайший срок этапа — по нему сортируем карточки внутри группы.
    const ends = card.stages.map((s) => ms(s.end_at)).filter(Number.isFinite);
    card.nextEnd = ends.length ? Math.min(...ends) : Infinity;
    return card;
  });

  // Порядок: сначала просроченные, потом «в работе», потом запланированные;
  // полностью выполненные машины уходят вниз. Внутри группы — по ближайшему сроку.
  const rank = (c) => (c.done ? 3 : c.overdue ? 0 : c.active ? 1 : 2);
  cards.sort((a, b) => (rank(a) - rank(b)) || (a.nextEnd - b.nextEnd));

  const counts = {
    cars: cards.length,
    active: cards.filter((c) => c.active).length,
    overdue: cards.filter((c) => c.overdue).length,
    done: cards.filter((c) => c.done).length,
  };
  return { cards, counts };
}
