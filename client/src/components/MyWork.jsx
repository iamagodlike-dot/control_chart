import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { buildMasterWork } from '../masterWork';
import MyWorkView from './MyWorkView';

// Container for the master's «Мои машины» screen. Reuses the live Gantt feed
// (api.subscribeGantt) — the master already reads posts/stages/jobs through the
// График, so this opens no new data surface — then keeps only the joined `stages`
// + `posts` and folds THIS master's stages into car cards via the pure builder.
// masterId comes from the signed-in user's access record (profile.masterId).
export default function MyWork({ masterId }) {
  const [data, setData] = useState(null); // null → ещё грузим; {stages, posts}

  useEffect(() => {
    const unsub = api.subscribeGantt(
      ({ stages, posts }) => setData({ stages, posts }),
      () => setData({ stages: [], posts: [] }),
    );
    return () => unsub();
  }, []);

  const { cards, counts } = useMemo(
    () => buildMasterWork(masterId, data || {}, Date.now()),
    [masterId, data],
  );

  return (
    <MyWorkView
      loading={data === null}
      hasMaster={!!masterId}
      cards={cards}
      counts={counts}
    />
  );
}
