import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import CarCard from './CarCard';
import DocumentsModal from './DocumentsModal';
import { jobOverallStatus } from './Gantt';
import { PHASE, DEFAULT_APPROVAL_STATUS } from '../phase';

// Self-contained «карточка автомобиля». Given only a jobId it loads the job (with
// its stages), posts and masters, wires EVERY edit handler (info + warehouse
// cells, route stages, документы, завершение, удаление) straight to the API, and
// renders the SAME <CarCard> used on the График board — plus its «Документы»
// modal on top. Because it owns all of its own data and mutations, any screen can
// open a car's full card by mounting <CarDetailModal jobId=… onClose=…> without
// depending on Gantt's internal state. This is what lets «Запчасти» open the card
// in place, without jumping to the График tab.
//
// The handler bodies mirror Gantt's inline CarCard wiring 1:1 (see Gantt.jsx). The
// only difference: finalize/remove close the card (the car leaves the live list),
// while info/stage edits keep it open and re-fetch so the card shows fresh data.
//
//   jobId:     Firestore job id to open.
//   onClose:   close the card.
//   onChanged: optional — called after any mutation so a host can refresh (screens
//              backed by a live subscription, like «Запчасти», don't need it).
//   now:       optional dayjs clock for status/deadline calc (defaults to now).
export default function CarDetailModal({ jobId, onClose, onChanged, now, isOwner = false }) {
  const [job, setJob] = useState(null);
  const [posts, setPosts] = useState([]);
  const [masters, setMasters] = useState([]);
  const [company, setCompany] = useState({});
  const [docsJob, setDocsJob] = useState(null);
  const [toast, setToast] = useState(null);

  const clock = now || dayjs();
  const changed = () => { if (onChanged) onChanged(); };
  const showToast = (m) => setToast(m);

  // Re-fetch the open job (with fresh stages) so the card reflects a just-saved
  // edit — the analogue of Gantt's refreshDetailJob.
  const refresh = async () => {
    const fresh = await api.jobs.get(jobId);
    if (fresh) fresh.job_id = jobId;
    setJob(fresh);
    return fresh;
  };

  // Load the job + the reference data the route editor needs, once per jobId.
  // The host remounts this modal per car (key={jobId}) so state starts clean.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [j, p, m] = await Promise.all([api.jobs.get(jobId), api.posts.list(), api.masters.list()]);
      if (!alive) return;
      if (j) j.job_id = jobId;
      setJob(j);
      setPosts(p);
      setMasters(m);
    })();
    api.settings.getCompany().then((c) => { if (alive) setCompany(c); }).catch(() => {});
    return () => { alive = false; };
  }, [jobId]);

  // Auto-dismiss the success toast (declarative, no ref writes in render).
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!job) return null; // still loading — the card appears once data is in

  return (
    <>
      <CarCard
        mode="edit"
        job={job}
        posts={posts}
        masters={masters}
        now={clock}
        isOwner={isOwner}
        onClose={onClose}
        onOpenDocs={async () => setDocsJob(await api.jobs.get(job.job_id))}
        onFinalize={async () => {
          const overall = jobOverallStatus(job, clock);
          if (overall !== 'done' && !window.confirm('Не все этапы завершены. Всё равно завершить заказ и убрать его в историю?')) return;
          // Warn before archiving a car that still has an unpaid счёт — otherwise
          // its debt lingers in Финансы with no car to open on the active screens.
          try {
            const invs = await api.orderDocuments.listByJob(job.job_id, 'invoice');
            const unpaid = invs.filter((i) => !i.paid);
            if (unpaid.length) {
              const sum = unpaid.reduce((s, i) => s + (Number(i.totals?.total) || 0), 0);
              if (!window.confirm(`По этой машине есть неоплаченный счёт${sum ? ` на ${sum.toLocaleString('ru-RU')} ₽` : ''}. Всё равно завершить заказ?`)) return;
            }
          } catch { /* если не удалось проверить счета — не блокируем завершение */ }
          await api.jobs.archive(job.job_id);
          await api.warehouse.freeJobCells(job);
          changed();
          onClose();
        }}
        onRemove={async () => {
          if (!window.confirm('Удалить эту машину без возможности восстановить?')) return;
          await api.warehouse.freeJobCells(job);
          await api.jobs.remove(job.job_id);
          changed();
          onClose();
        }}
        onSaveInfo={async (patch) => {
          await api.jobs.update(job.job_id, patch);
          const merged = { ...job, ...patch };
          const before = api.warehouse.cellIds(job);
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
          await refresh();
          changed();
        }}
        onAddStage={async (stageData) => {
          const created = await api.stages.create(job.job_id, stageData);
          await refresh();
          changed();
          return created;
        }}
        onUpdateStage={async (id, patch) => { await api.stages.update(id, patch); await refresh(); changed(); }}
        onRemoveStage={async (id) => { await api.stages.remove(id); await refresh(); changed(); }}
        onReturnToApproval={async () => {
          await api.jobs.update(job.job_id, {
            phase: PHASE.APPROVAL,
            approval_status: job.approval_status || DEFAULT_APPROVAL_STATUS,
          });
          changed();
          onClose();
        }}
      />

      {docsJob && (
        <DocumentsModal
          job={docsJob}
          company={company}
          onClose={() => setDocsJob(null)}
          onJobUpdated={async () => {
            // Документ обновил карточку («Обновить карточку машины») — подтягиваем
            // свежий job, чтобы ОТКРЫТАЯ под окном карточка сразу показала изменения
            // (иначе form/допродажи сидированы один раз, см. CarCard jobSyncSig).
            await refresh();
            setDocsJob(await api.jobs.get(docsJob.id));
          }}
        />
      )}

      {/* .gantt-toast is position:absolute/z-index:20 by default — pin it to the
          viewport above the card (z-index:50) so success messages are visible. */}
      {toast && <div className="gantt-toast" style={{ position: 'fixed', zIndex: 3000 }}>{toast}</div>}
    </>
  );
}
