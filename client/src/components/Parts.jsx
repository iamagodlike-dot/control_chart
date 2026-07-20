import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import PartsScreen from './PartsScreen';
import CarDetailModal from './CarDetailModal';
import SupplierInvoiceModal from './SupplierInvoiceModal';
import Icon from './Icon';
import { usePartsController } from '../usePartsController';
import { isRepair } from '../phase';

// «Запчасти» — data container. Parts live inside each job (job.parts[]) and paint
// inside job.paint. MULTI-USER SAFE: the list is a LIVE subscription (updates when
// anyone changes data) and every edit is written PER PART through a transaction
// (api.jobs.savePart/removePart), so two people editing the same car never lose
// each other's changes. All visuals + the spec life-cycle (§12.2/§13) live in
// <PartsScreen> / usePartsController, shared with the demo. Cells link to cars by
// plate (api.cells).
//
// Поставщики берём из справочника (управленец ведёт его в «Настройках»); имена
// подставляются как подсказки в поле «Поставщик». Пока справочник не загрузился
// (или вдруг пуст) — показываем базовый набор, чтобы автозаполнение не пропадало.
const FALLBACK_SUPPLIERS = ['Exist', 'Emex', 'Разборка', 'Химснаб'];

// Transaction-safe per-part operations (no whole-array overwrite → no clobbering).
const ops = {
  savePart: (jobId, part) => api.jobs.savePart(jobId, part),
  removePart: (jobId, partId) => api.jobs.removePart(jobId, partId),
  savePaint: (jobId, paint) => api.jobs.savePaint(jobId, paint),
};

export default function Parts({ role = 'partsman', profile = {} }) {
  const [remoteJobs, setRemoteJobs] = useState(null);
  const [cells, setCells] = useState({});
  const [loading, setLoading] = useState(true);
  // Car whose full card is open, right here on the «Запчасти» screen (no jump to
  // the График tab). null → no card open.
  const [openCarId, setOpenCarId] = useState(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false); // модалка «Выставить счёт»
  // Счёт поставщика выставляет запчастист (и управленец). Позиции «Требуется» — то,
  // из чего можно собрать счёт.
  const canInvoice = role === 'partsman' || role === 'owner';
  const needCount = useMemo(
    // пустой статус = «Требуется» (как на экране), иначе кнопка пряталась бы, когда
    // все нужные позиции без явного статуса (импорт Audatex / ручной ввод).
    () => (remoteJobs || []).reduce((a, j) => a + (j.parts || []).filter((p) => p && p.id && (p.status || 'need') === 'need').length, 0),
    [remoteJobs],
  );
  // Имена поставщиков из справочника — подсказки для поля «Поставщик».
  const [supplierNames, setSupplierNames] = useState(FALLBACK_SUPPLIERS);
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
          // Тип оплаты — БЕЗ него метка «страховая ↔ допродажа» не работает вообще:
          // jobShell подставит 'cash' → carInsurance всегда false → лампочка у позиций
          // не рендерится ни на одной машине (в demo/parts-demo.jsx поле передаётся,
          // поэтому там всё видно — это расхождение демо/прода и маскировало регрессию).
          payment_type: j.payment_type || 'cash',
          // Ячейки склада — по СВЯЗИ job↔ячейка (cell_ids), как во всей остальной
          // системе (receiving.js cellIdsOf, api.warehouse.syncParts/setJobCells).
          cell_ids: j.cell_ids || (j.cell_id ? [j.cell_id] : []),
          // Убытки — чтобы у машины с несколькими делами позицию можно было отнести
          // к нужному (селектор потока вместо бинарной лампочки). Плоские страховые
          // поля нужны claimsOf для ленивой сборки убытка №1 у старых машин.
          claims: j.claims || null,
          claim_number: j.claim_number || '',
          insurer_id: j.insurer_id || '',
          insurer_name: j.insurer_name || '',
          policy_type: j.policy_type || '',
          franchise: j.franchise ?? null,
          paint: j.paint || null,
          parts: j.parts || [],
        })));
        setLoading(false);
      },
      () => setLoading(false),
    );
    api.cells.list().then(setCells).catch(() => {});
    api.suppliers.list()
      .then((list) => { const names = list.map((s) => s.name).filter(Boolean); if (names.length) setSupplierNames(names); })
      .catch(() => {});
    return () => unsub();
  }, []);

  // Ячейки склада, как их ждёт buildPartsVM → { [cellId]: { orderNum, parts } }.
  // Группа сопоставляет их со СВОЕЙ машиной по job.cell_ids, поэтому фильтровать
  // по наличию плашки-госномера больше не нужно (и нельзя: у задвоенных машин
  // одинаковый гос.номер — каждая показывала бы ячейки чужой карточки).
  const cellsById = useMemo(() => {
    const out = {};
    for (const [id, c] of Object.entries(cells)) {
      if (c) out[id] = { orderNum: c.orderNum || '', parts: c.parts || [] };
    }
    return out;
  }, [cells]);

  const { vm, filter, search, handlers, prompts } = usePartsController({ remoteJobs, cells: cellsById, ops });

  if (loading && !remoteJobs) {
    return (
      <div style={{ background: 'var(--color-bg)', color: 'var(--color-text-muted)', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '.1em' }}>
        Загрузка запчастей…
      </div>
    );
  }

  return (
    <>
      <PartsScreen vm={vm} filter={filter} search={search} supplierNames={supplierNames} onOpenCar={setOpenCarId} {...handlers} {...prompts} />
      {canInvoice && needCount > 0 && (
        <button className="si-fab" onClick={() => setInvoiceOpen(true)} title="Собрать позиции «Требуется» в счёт поставщика">
          <Icon name="receipt" size={18} />Выставить счёт
        </button>
      )}
      {invoiceOpen && (
        <SupplierInvoiceModal
          jobs={remoteJobs || []}
          supplierNames={supplierNames}
          profileName={profile?.name || ''}
          onClose={() => setInvoiceOpen(false)}
        />
      )}
      {openCarId && <CarDetailModal key={openCarId} jobId={openCarId} onClose={() => setOpenCarId(null)} />}
    </>
  );
}
