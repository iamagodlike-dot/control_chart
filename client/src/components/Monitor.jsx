import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { buildMonitor } from '../monitor';
import MonitorView from './MonitorView';
import CarDetailModal from './CarDetailModal';

// Контейнер экрана «Монитор»: живая подписка на все не-архивные машины
// (согласование + ремонт, с этапами), состояние фильтров/сортировки и открытие
// карточки машины по клику на строку. Вся классификация простоев — monitor.js,
// вся вёрстка — MonitorView.
export default function Monitor({ isOwner = false }) {
  const [jobs, setJobs] = useState(null); // null → ещё грузим
  const [stage, setStage] = useState('all');
  const [payer, setPayer] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('idle');
  const [openJobId, setOpenJobId] = useState(null);

  useEffect(() => {
    const unsub = api.subscribeMonitor(setJobs, () => setJobs([]));
    return () => unsub();
  }, []);

  const vm = useMemo(
    () => buildMonitor(jobs || [], { stage, payer, query, sort }),
    [jobs, stage, payer, query, sort],
  );

  return (
    <>
      <MonitorView
        loading={jobs === null}
        rows={vm.rows}
        counts={vm.counts}
        summary={vm.summary}
        stage={stage}
        onStage={setStage}
        payer={payer}
        onPayer={setPayer}
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        onOpen={setOpenJobId}
      />
      {/* key={openJobId} — карточка каждой машины стартует с чистым состоянием */}
      {openJobId && (
        <CarDetailModal
          key={openJobId}
          jobId={openJobId}
          onClose={() => setOpenJobId(null)}
          isOwner={isOwner}
        />
      )}
    </>
  );
}
