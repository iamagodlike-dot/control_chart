import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import CarDetailModal from './CarDetailModal';
import CarCard from './CarCard';
import DocumentsModal from './DocumentsModal';
import Icon from './Icon';
import { money } from '../orderDoc';
import {
  APPROVAL_STATUSES, APPROVAL_STATUS_BY_ID, APPROVAL_FLOW,
  DEFAULT_APPROVAL_STATUS, APPROVED_STATUS,
} from '../phase';

// Продажная сумма массива позиций (кол-во × цена) — приблизительная смета из
// импортированной калькуляции. На этапе согласования заказ-наряда ещё нет,
// поэтому берём услуги/запчасти прямо из машины.
function sumSale(arr) {
  return (arr || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
}

function pluralRu(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const MAIN_COLS = APPROVAL_STATUSES.filter((s) => !s.side);
const SIDE_COLS = APPROVAL_STATUSES.filter((s) => s.side);

export default function Approval({ isOwner = false }) {
  const [jobs, setJobs] = useState(null);   // null → ещё грузим
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [now, setNow] = useState(dayjs());
  const [createOpen, setCreateOpen] = useState(false);
  const [posts, setPosts] = useState([]);
  const [masters, setMasters] = useState([]);
  const [docsJob, setDocsJob] = useState(null);
  const [company, setCompany] = useState({});

  // «Сегодня» в состоянии (Date.now() в рендере запрещён правилом чистоты);
  // раз в минуту освежаем, чтобы счётчик дней в согласовании оставался живым.
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = api.jobs.subscribeApproval(
      (list) => setJobs(list),
      () => setJobs([]),
    );
    return () => unsub();
  }, []);

  // Списки постов/мастеров нужны форме заведения машины (маршрут). Грузим один раз.
  useEffect(() => {
    api.posts.list().then(setPosts).catch(() => {});
    api.masters.list().then(setMasters).catch(() => {});
    api.settings.getCompany().then(setCompany).catch(() => {});
  }, []);

  // Раскладываем машины по колонкам-статусам (пустой/неизвестный → «Осмотр»).
  const byStatus = useMemo(() => {
    const m = {};
    for (const s of APPROVAL_STATUSES) m[s.id] = [];
    for (const j of jobs || []) {
      const st = APPROVAL_STATUS_BY_ID[j.approval_status] ? j.approval_status : DEFAULT_APPROVAL_STATUS;
      m[st].push(j);
    }
    return m;
  }, [jobs]);

  async function run(job, fields, archive = false) {
    if (busyId) return;
    setBusyId(job.id);
    try {
      if (archive) await api.jobs.archive(job.id);
      else await api.jobs.update(job.id, fields);
    } catch {
      alert('Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.');
    } finally {
      setBusyId(null);
    }
  }

  const h = {
    busyId,
    now,
    open: (job) => setOpenId(job.id),
    openDocs: async (job) => setDocsJob(await api.jobs.get(job.id)),
    setStatus: (job, statusId) => run(job, { approval_status: statusId }),
    toRepair: (job) => run(job, { phase: 'repair', repair_since: Date.now() }),
    toArchive: (job) => run(job, null, true),
  };

  if (jobs === null) return <div style={S.center}>Загрузка…</div>;

  const total = jobs.length;
  const problems = byStatus.surcharge.length + byStatus.rejected.length;

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <div style={S.title}><Icon name="shield" size={18} />Согласование со страховой</div>
        <div style={S.headRight}>
          <span style={S.count}>{total ? `${total} ${pluralRu(total, 'машина', 'машины', 'машин')}` : 'нет машин'}</span>
          <button style={S.addBtn} onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={15} />Добавить автомобиль
          </button>
        </div>
      </div>

      {total === 0 ? (
        <div style={S.empty}>
          <Icon name="shield" size={40} />
          <div style={S.emptyTitle}>Пока нет машин на согласовании</div>
          <div style={S.emptyText}>
            Новые страховые машины появляются здесь, пока идёт согласование объёма ремонта.
            После одобрения нажмите «В работу» — и машина уйдёт на График.
          </div>
        </div>
      ) : (
        <>
          <div className="apr-board" style={S.board}>
            {MAIN_COLS.map((col) => (
              <Column key={col.id} col={col} jobs={byStatus[col.id]} h={h} />
            ))}
          </div>

          {problems > 0 && (
            <div style={S.sideZone}>
              <div style={S.sideZoneLabel}>Проблемные</div>
              <div style={S.sideBoard}>
                {SIDE_COLS.map((col) => (
                  <Column key={col.id} col={col} jobs={byStatus[col.id]} h={h} side />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {openId && <CarDetailModal key={openId} jobId={openId} isOwner={isOwner} onClose={() => setOpenId(null)} />}

      {docsJob && (
        <DocumentsModal job={docsJob} company={company} onClose={() => setDocsJob(null)} />
      )}

      {/* Заведение машины прямо с доски — по умолчанию тип «Страховая». */}
      {createOpen && (
        <CarCard
          mode="create"
          job={{ payment_type: 'insurance' }}
          posts={posts}
          masters={masters}
          now={now}
          onClose={() => setCreateOpen(false)}
          onCreate={async (payload, cellIds) => {
            const created = await api.jobs.create(payload);
            if (cellIds?.length) await api.warehouse.setJobCells(created, cellIds);
            setCreateOpen(false);
            // Дальше живая подписка сама покажет новую машину на доске.
          }}
        />
      )}
    </div>
  );
}

function Column({ col, jobs, h, side }) {
  return (
    <div className="apr-col" style={{ ...S.col, ...(side ? S.colSide : null) }}>
      <div style={{ ...S.colHead, borderTopColor: col.color }}>
        <span style={{ ...S.dot, background: col.color }} />
        <span style={S.colTitle}>{col.label}</span>
        <span style={S.colCount}>{jobs.length}</span>
      </div>
      <div style={S.colBody}>
        {jobs.length === 0
          ? <div style={S.colEmpty}>—</div>
          : jobs.map((j) => <Card key={j.id} job={j} h={h} />)}
      </div>
    </div>
  );
}

function Card({ job, h }) {
  const busy = h.busyId === job.id;
  const raw = job.approval_status;
  const status = APPROVAL_STATUS_BY_ID[raw] ? raw : DEFAULT_APPROVAL_STATUS;
  const flowIdx = APPROVAL_FLOW.indexOf(status);

  const subtotal = sumSale(job.services) + sumSale(job.parts);
  const discount = Number(job.discount) || 0;
  const estimate = Math.max(0, subtotal - discount);   // сумма уже со скидкой страховой (из Audatex)
  const since = Number(job.approval_since || job.created_at) || 0;
  const days = since ? h.now.diff(dayjs(since), 'day') : null;
  const dayColor = days >= 20 ? 'var(--color-danger-text)' : days >= 10 ? 'var(--color-warning)' : 'var(--text3)';

  return (
    <div
      style={{ ...S.card, opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}
      onClick={() => h.open(job)}
    >
      <div style={S.cardTop}>
        <span style={S.model}>{job.car_model || 'Без модели'}</span>
        {job.plate_number && <span style={S.plate}>{job.plate_number}</span>}
        <button
          style={S.docBtn}
          title="Документы: заказ-наряд, счёт, акт"
          onClick={(e) => { e.stopPropagation(); h.openDocs(job); }}
        >
          <Icon name="file" size={14} />
        </button>
      </div>
      {job.insurer_name && <div style={S.meta}><Icon name="shield" size={12} />{job.insurer_name}</div>}
      {estimate > 0 && (
        <div style={S.meta}>
          <Icon name="receipt" size={12} />{money(estimate)}
          {discount > 0 && <span style={S.discountNote}>−{money(discount)} скидка</span>}
        </div>
      )}
      {days !== null && (
        <div style={{ ...S.meta, color: dayColor }}>
          <Icon name="clock" size={12} />{days} {pluralRu(days, 'день', 'дня', 'дней')} в согласовании
        </div>
      )}

      <div style={S.actions}>
        {flowIdx >= 0 ? (
          <>
            <div style={S.row}>
              {flowIdx > 0 && <Btn kind="ghost" onClick={() => h.setStatus(job, APPROVAL_FLOW[flowIdx - 1])}>← Назад</Btn>}
              {status === APPROVED_STATUS
                ? <Btn kind="go" onClick={() => h.toRepair(job)}>В работу →</Btn>
                : <Btn kind="primary" onClick={() => h.setStatus(job, APPROVAL_FLOW[flowIdx + 1])}>Дальше →</Btn>}
            </div>
            <div style={S.rowLinks}>
              <Btn kind="link" onClick={() => h.setStatus(job, 'surcharge')}>Доплата</Btn>
              <Btn kind="linkDanger" onClick={() => h.setStatus(job, 'rejected')}>Отказ</Btn>
            </div>
          </>
        ) : status === 'surcharge' ? (
          <div style={S.row}>
            <Btn kind="ghost" onClick={() => h.setStatus(job, 'calc')}>← Вернуть в смету</Btn>
            <Btn kind="linkDanger" onClick={() => h.setStatus(job, 'rejected')}>Отказ</Btn>
          </div>
        ) : (
          <div style={S.row}>
            <Btn kind="ghost" onClick={() => h.setStatus(job, 'sent')}>← Вернуть</Btn>
            <Btn kind="linkDanger" onClick={() => h.toArchive(job)}>В архив</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

function Btn({ onClick, kind, children }) {
  return (
    <button
      style={{ ...S.btn, ...(S[`btn_${kind}`] || null) }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {children}
    </button>
  );
}

const S = {
  wrap: { padding: '18px 20px 40px', height: '100%', overflow: 'auto', background: 'var(--color-bg)', color: 'var(--color-text)', boxSizing: 'border-box' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' },
  headRight: { display: 'flex', alignItems: 'center', gap: 14 },
  addBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid transparent', background: 'var(--color-primary)', color: 'var(--color-on-primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  title: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700 },
  count: { fontSize: 13, color: 'var(--color-text-muted)' },
  empty: { maxWidth: 460, margin: '60px auto', textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: 600, color: 'var(--color-text)' },
  emptyText: { fontSize: 13, lineHeight: 1.5 },
  board: { display: 'flex', gap: 12, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 8 },
  col: { flex: '1 1 0', minWidth: 220, background: 'var(--bg2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column' },
  colSide: { flex: '0 1 300px', maxWidth: 340, background: 'color-mix(in srgb, var(--color-warning) 6%, var(--bg2))' },
  colHead: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: '3px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' },
  dot: { width: 8, height: 8, borderRadius: 2, flex: '0 0 auto' },
  colTitle: { fontSize: 13, fontWeight: 600, flex: 1 },
  colCount: { fontSize: 12, color: 'var(--color-text-muted)', background: 'var(--color-surface-alt)', borderRadius: 10, padding: '1px 8px', minWidth: 22, textAlign: 'center' },
  colBody: { padding: 10, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 60 },
  colEmpty: { textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: '14px 0' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 10, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 },
  cardTop: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  docBtn: { flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface-alt)', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0 },
  model: { fontWeight: 700, fontSize: 14 },
  plate: { fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: 'var(--color-text)', background: 'var(--color-surface-alt)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' },
  meta: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-muted)' },
  discountNote: { color: 'var(--color-success)', fontSize: 11, fontWeight: 600 },
  actions: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', gap: 6 },
  rowLinks: { display: 'flex', gap: 14, justifyContent: 'center' },
  btn: { flex: 1, padding: '7px 8px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface-alt)', color: 'var(--color-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btn_ghost: {},
  btn_primary: { background: 'var(--color-primary)', color: 'var(--color-on-primary)', border: '1px solid transparent' },
  btn_go: { background: 'var(--color-success)', color: '#04140d', border: '1px solid transparent' },
  btn_link: { flex: '0 0 auto', padding: '2px 4px', border: 'none', background: 'none', color: 'var(--color-warning)', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  btn_linkDanger: { flex: '0 0 auto', padding: '2px 4px', border: 'none', background: 'none', color: 'var(--color-danger-text)', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  sideZone: { marginTop: 22 },
  sideZoneLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', marginBottom: 8 },
  sideBoard: { display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' },
};
