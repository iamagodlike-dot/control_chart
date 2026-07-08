import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import PartsScreen from './PartsScreen';
import CarDetailModal from './CarDetailModal';
import { usePartsController } from '../usePartsController';
import { isRepair } from '../phase';

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
  // Car whose full card is open, right here on the «Запчасти» screen (no jump to
  // the График tab). null → no card open.
  const [openCarId, setOpenCarId] = useState(null);
  // Jobs we've already backfilled ids for this session — so the heal writes once,
  // not on every incoming snapshot (the write itself produces a new snapshot).
  const healed = useRef(new Set());

  useEffect(() => {
    const unsub = api.jobs.subscribeActive(
      (all) => {
        // Экран «Запчасти» — только машины в ремонте; на согласовании со страховой
        // запчасти пока не заказывают (ремонт до одобрения не начинаем).
        const docs = all.filter(isRepair);
        // Self-heal: cars imported before parts carried ids get stable ids now,
        // so delete/edit on this screen actually reaches the stored position.
        for (const j of docs) {
          const parts = j.parts || [];
          if (parts.length && parts.some((p) => !p.id) && !healed.current.has(j.id)) {
            healed.current.add(j.id);
            api.jobs.ensurePartIds(j.id).catch(() => healed.current.delete(j.id));
          }
        }
        setRemoteJobs(docs.map((j) => ({
          id: j.id,
          car_model: j.car_model || 'Без модели',
          plate_number: j.plate_number || '',
          order_number: j.order_number || '',
          client_name: j.client_name || '',
          discount: Number(j.discount) || 0,   // единая скидка заказа → в расчёт маржи запчастей
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

  return (
    <>
      <PartsScreen vm={vm} filter={filter} search={search} supplierNames={SUPPLIERS} onOpenCar={setOpenCarId} {...handlers} {...prompts} />
      {openCarId && <CarDetailModal key={openCarId} jobId={openCarId} onClose={() => setOpenCarId(null)} />}
    </>
  );
}
