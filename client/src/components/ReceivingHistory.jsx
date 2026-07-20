import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { buildReceivingHistory } from '../receivingHistory';
import ReceivingHistoryView from './ReceivingHistoryView';

// Container for the «История приёмки» screen. Loads every car (active + archived)
// in one query — listAllBrief carries parts + photos but no route stages, which is
// exactly what the receiving feed needs — folds them into the timeline, and owns
// the filter / search / refresh state. History is not time-critical, so this is a
// one-shot load with a manual refresh rather than a live subscription.
export default function ReceivingHistory() {
  const [jobs, setJobs] = useState(null); // null → ещё грузим
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    try {
      setJobs(await api.jobs.listAllBrief());
    } catch {
      setJobs([]); // сеть/правила — покажем пустую ленту, не падаем
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const { events, counts } = useMemo(
    () => buildReceivingHistory(jobs || [], { filter, query }),
    [jobs, filter, query],
  );

  return (
    <ReceivingHistoryView
      loading={jobs === null}
      events={events}
      counts={counts}
      filter={filter}
      onFilter={setFilter}
      query={query}
      onQuery={setQuery}
      onRefresh={() => load(true)}
      refreshing={refreshing}
    />
  );
}
