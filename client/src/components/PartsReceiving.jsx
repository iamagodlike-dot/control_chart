import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { buildReceiving } from '../receiving';
import ReceivingView from './ReceivingView';

// Container for the экспедитор «Приёмка» screen: subscribes to live jobs, folds
// them into the receiving view-model, and persists status changes. All markup
// lives in <ReceivingView> so the demo can render an identical, Firestore-free copy.
export default function PartsReceiving() {
  const [jobs, setJobs] = useState(null); // null → ещё грузим
  const [filter, setFilter] = useState('ordered');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    const unsub = api.jobs.subscribeActive((list) => setJobs(list), () => setJobs([]));
    return () => unsub();
  }, []);

  const { groups, counts } = useMemo(
    () => buildReceiving(jobs || [], filter),
    [jobs, filter],
  );

  // Change ONE part's status. Take the original part from live jobs so savePart
  // (merges by id) can't wipe its qty/cost/price — we only touch the status.
  async function onSetStatus(jobId, partId, status) {
    const job = (jobs || []).find((j) => j.id === jobId);
    const part = job?.parts?.find((p) => p.id === partId);
    if (!part) return;
    setBusy(partId);
    try { await api.jobs.savePart(jobId, { ...part, status }); }
    catch { /* правила/сеть — живой снапшот вернёт актуальное состояние */ }
    finally { setBusy(null); }
  }

  return (
    <ReceivingView
      loading={jobs === null}
      groups={groups}
      counts={counts}
      filter={filter}
      onFilter={setFilter}
      onSetStatus={onSetStatus}
      busy={busy}
    />
  );
}
