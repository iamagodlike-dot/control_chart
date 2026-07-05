import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import PartsScreen from './PartsScreen';
import { usePartsController } from '../usePartsController';

// «Запчасти» — data container. Parts live inside each job (job.parts[]) and paint
// inside job.paint. MULTI-USER SAFE: the list is a LIVE subscription (updates when
// anyone changes data) and every edit is written PER PART through a transaction
// (api.jobs.savePart/removePart), so two people editing the same car never lose
// each other's changes. All visuals + the spec life-cycle (§12.2/§13) live in
// <PartsScreen> / usePartsController, shared with the demo. Cells link to cars by
// plate (api.cells).
const SUPPLIERS = ['Exist', 'Emex', 'Разборка', 'Химснаб'];

// Transaction-safe per-part operations (no whole-array overwrite → no clobbering).
const ops = {
  savePart: (jobId, part) => api.jobs.savePart(jobId, part),
  removePart: (jobId, partId) => api.jobs.removePart(jobId, partId),
  savePaint: (jobId, paint) => api.jobs.savePaint(jobId, paint),
};

export default function Parts() {
  const [remoteJobs, setRemoteJobs] = useState(null);
  const [cells, setCells] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = api.jobs.subscribeActive(
      (docs) => {
        setRemoteJobs(docs.map((j) => ({
          id: j.id,
          car_model: j.car_model || 'Без модели',
          plate_number: j.plate_number || '',
          order_number: j.order_number || '',
          client_name: j.client_name || '',
          paint: j.paint || null,
          parts: j.parts || [],
        })));
        setLoading(false);
      },
      () => setLoading(false),
    );
    api.cells.list().then(setCells).catch(() => {});
    return () => unsub();
  }, []);

  // Warehouse links parts to cars by plate → { [cellId]: { plate, orderNum, parts } }.
  const cellsByPlate = useMemo(() => {
    const out = {};
    for (const [id, c] of Object.entries(cells)) {
      if (c && c.plate) out[id] = { plate: c.plate, orderNum: c.orderNum || '', parts: c.parts || [] };
    }
    return out;
  }, [cells]);

  const { vm, filter, search, handlers, prompts } = usePartsController({ remoteJobs, cells: cellsByPlate, ops });

  if (loading && !remoteJobs) {
    return (
      <div style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '.1em' }}>
        Загрузка запчастей…
      </div>
    );
  }

  return <PartsScreen vm={vm} filter={filter} search={search} supplierNames={SUPPLIERS} {...handlers} {...prompts} />;
}
