import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { buildMasterEarnings } from '../salary';
import MyEarningsView from './MyEarningsView';

// Container for the master's «Мой заработок» screen. Reuses the SAME live gantt
// feed as «Мои машины» (api.subscribeGantt) — the master already reads jobs/stages
// through it, so this opens no new data surface. We take `jobs` (each with its
// costing.labor and stages) + `masters` (to find THIS master's pay setup) and fold
// them into per-car earnings via the pure builder. The screen shows only this
// master's own money — never the shop's margin.
// masterId comes from the signed-in user's access record (profile.masterId).
export default function MyEarnings({ masterId }) {
  const [data, setData] = useState(null); // null → ещё грузим; {jobs, masters}

  useEffect(() => {
    const unsub = api.subscribeGantt(
      ({ jobs, masters }) => setData({ jobs, masters }),
      () => setData({ jobs: [], masters: [] }),
    );
    return () => unsub();
  }, []);

  const master = useMemo(
    () => (data?.masters || []).find((m) => m.id === masterId) || (masterId ? { id: masterId } : null),
    [data, masterId],
  );
  const { isFixed, pay, cards, totals } = useMemo(
    () => buildMasterEarnings(master, data || {}),
    [master, data],
  );

  return (
    <MyEarningsView
      loading={data === null}
      hasMaster={!!masterId}
      isFixed={isFixed}
      pay={pay}
      cards={cards}
      totals={totals}
    />
  );
}
