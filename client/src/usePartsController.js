import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildPartsVM, normalizePart, partNeedsOrderInfo, partStatusMeta, psMeta, pkMeta, num } from './parts';
import { STREAM_INSURANCE } from './billing';

// Controller hook shared by the real screen (Parts.jsx, Firestore-backed) and
// the demo (in-memory). It owns the editable `jobs` state and encodes the spec
// life-cycle (§13 order guard, ordered→in→issued advance, ETA + analog prompts),
// producing { vm, handlers, prompts } for <PartsScreen>.
//
// MULTI-USER: `remoteJobs` is the live snapshot from Firestore (or a static seed
// in the demo). It is merged into local state so several people editing the same
// shop see each other's changes — but a part the local user edited in the last
// few seconds is kept (dirty-guard) so incoming snapshots never revert typing.
// Writes go through `ops` PER PART (transaction-safe) so concurrent edits to the
// same car never clobber each other. `ops` is omitted in the demo (local only).
//
//   remoteJobs: [{ id, car_model, plate_number, order_number, client_name, parts:[], paint:{} }] | null
//   cells:      { [cellId]: { orderNum, parts:[{qty}] } } (машина находит свои по cell_ids)
//   ops:        { savePart(jobId, part), removePart(jobId, partId), savePaint(jobId, paint) }

const todayStamp = () => new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
const intMin1 = (v) => Math.max(1, parseInt(String(v).replace(/\D/g, ''), 10) || 1);
const DIRTY_MS = 4000; // keep a locally-edited part/paint from being overwritten by a snapshot for this long

const jobShell = (rj) => ({
  id: rj.id,
  car_model: rj.car_model || 'Без модели',
  plate_number: rj.plate_number || '',
  order_number: rj.order_number || '',
  client_name: rj.client_name || '',
  discount: Number(rj.discount) || 0,
  payment_type: rj.payment_type || 'cash', // для метки «страховая ↔ допродажа» у позиций
  cell_ids: rj.cell_ids || (rj.cell_id ? [rj.cell_id] : []), // ячейки склада этой машины
  // Убытки машины (см. billing.js) + плоские поля, из которых claimsOf собирает
  // убыток №1 у машин, заведённых до появления нескольких дел.
  claims: rj.claims || null,
  claim_number: rj.claim_number || '',
  insurer_id: rj.insurer_id || '',
  insurer_name: rj.insurer_name || '',
  policy_type: rj.policy_type || '',
  franchise: rj.franchise ?? null,
});

export function usePartsController({ remoteJobs, cells = {}, ops = {}, rentabTarget = 40 }) {
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [orderPrompt, setOrderPrompt] = useState(null);
  const [etaPrompt, setEtaPrompt] = useState(null);
  const [replPrompt, setReplPrompt] = useState(null);
  const [notePrompt, setNotePrompt] = useState(null); // окно комментария к позиции
  // «Замороженный» порядок строк. null → рендер сортирует канонически.
  // Заполняется лениво снимком текущего порядка при ПЕРВОЙ смене статуса; смена
  // фильтра/поиска сбрасывает его в null, а заход на вкладку/перезагрузка — через
  // размонтирование <Parts> (состояние стартует с null). flashId — только что
  // изменённая позиция, подсвечивается ~5 с.
  const [frozenOrder, setFrozenOrder] = useState(null);
  const [flashId, setFlashId] = useState(null);

  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; });
  const vmRef = useRef(null);      // текущий vm — читаем при заморозке (без stale-closure)
  const flashTimer = useRef(null);
  const timers = useRef({});
  const partDirty = useRef({});   // partId -> expiry ts (recent local edit)
  const paintDirty = useRef({});  // jobId  -> expiry ts
  const removedAt = useRef({});   // partId -> expiry ts (recently deleted locally)

  const now = () => Date.now();
  const markPart = (partId) => { partDirty.current[partId] = now() + DIRTY_MS; };
  const isPartDirty = (partId) => (partDirty.current[partId] || 0) > now();
  const clearPart = (partId) => { delete partDirty.current[partId]; };

  const findJob = (id) => jobsRef.current.find((j) => j.id === id);
  const findPart = (jobId, partId) => (findJob(jobId)?.parts || []).find((p) => p.id === partId);

  // ---- merge the live snapshot into local state (dirty-guarded) ------------
  useEffect(() => {
    if (!remoteJobs) return;
    setJobs((local) => remoteJobs.map((rj) => {
      const lj = local.find((j) => j.id === rj.id);
      const remoteParts = (rj.parts || []).map(normalizePart);
      let parts = remoteParts;
      if (lj) {
        const byId = new Map(remoteParts.map((p) => [p.id, p]));
        for (const lp of lj.parts) if (isPartDirty(lp.id)) byId.set(lp.id, lp); // keep my in-flight edits
        for (const id in removedAt.current) if (removedAt.current[id] > now()) byId.delete(id); // hide just-deleted
        parts = Array.from(byId.values());
      }
      const paint = (lj && (paintDirty.current[rj.id] || 0) > now()) ? lj.paint : (rj.paint || null);
      return { ...jobShell(rj), parts, paint };
    }).sort((a, b) => (a.car_model > b.car_model ? 1 : -1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteJobs]);

  // ---- persistence (per part / paint) --------------------------------------
  const schedulePartSave = useCallback((jobId, partId) => {
    if (!ops.savePart) return;
    const key = jobId + ':' + partId;
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      const part = findPart(jobId, partId);
      if (part) ops.savePart(jobId, part);
    }, 450);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops]);

  const schedulePaintSave = useCallback((jobId) => {
    if (!ops.savePaint) return;
    const key = 'paint:' + jobId;
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      const job = findJob(jobId);
      if (job) ops.savePaint(jobId, job.paint || null);
    }, 450);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops]);

  const patchPart = useCallback((jobId, partId, patch) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, parts: j.parts.map((p) => (p.id === partId ? { ...p, ...patch } : p)) } : j)));
    markPart(partId);
    schedulePartSave(jobId, partId);
  }, [schedulePartSave]);

  // ---- «замороженный» порядок + подсветка ----------------------------------
  // Снимок берём из текущего vm (то, что реально видно) ДО применения смены
  // статуса — так строка остаётся ровно на месте, без «прыжка». Идемпотентно:
  // повторные смены статуса снимок не трогают.
  const freeze = useCallback(() => {
    setFrozenOrder((cur) => {
      if (cur) return cur;
      const v = vmRef.current;
      if (!v || !v.groups) return cur;
      return {
        cars: v.groups.map((g) => g.carId),
        parts: Object.fromEntries(v.groups.map((g) => [g.carId, g.rows.map((r) => r.id)])),
      };
    });
  }, []);
  const flash = useCallback((partId) => {
    setFlashId(partId);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 5000);
  }, []);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  // Вызывать в начале любого изменения статуса: заморозить порядок и подсветить строку.
  const beforeStatusChange = useCallback((partId) => { freeze(); flash(partId); }, [freeze, flash]);
  const resetFreeze = useCallback(() => setFrozenOrder(null), []);

  // ---- part life-cycle (mirrors reference advancePartStatus/commitOrder) -----
  const commitOrder = useCallback((jobId, partId, prev) => {
    const p = findPart(jobId, partId) || {};
    beforeStatusChange(partId);
    patchPart(jobId, partId, { status: 'ordered', orderedAt: p.orderedAt || todayStamp() });
    if (!p.eta) setEtaPrompt({ jobId, partId, prev, draft: '' });
  }, [patchPart, beforeStatusChange]);

  const openOrderPrompt = useCallback((jobId, partId, prev) => {
    const p = findPart(jobId, partId) || {};
    setOrderPrompt({ jobId, partId, prev, showErr: false, draft: {
      name: p.name || '', kind: p.kind || 'new', article: p.code || '', replArticle: p.replArticle || '',
      supplier: p.supplier || '', cost: p.cost || '', price: p.price || '', qty: p.qty || 1, eta: p.eta || '',
      comment: p.comment || '',
    } });
  }, []);

  const quickOrder = useCallback((jobId, partId) => {
    const p = findPart(jobId, partId) || {};
    if (partNeedsOrderInfo(p)) openOrderPrompt(jobId, partId, p.status);
    else commitOrder(jobId, partId, p.status);
  }, [openOrderPrompt, commitOrder]);

  const onStatus = useCallback((jobId, partId, value) => {
    const p = findPart(jobId, partId) || {};
    if (value === 'ordered' && partNeedsOrderInfo(p)) { openOrderPrompt(jobId, partId, p.status); return; }
    if (value === 'ordered') { commitOrder(jobId, partId, p.status); return; }
    beforeStatusChange(partId);
    patchPart(jobId, partId, { status: value });
  }, [openOrderPrompt, commitOrder, patchPart, beforeStatusChange]);

  const onAdvance = useCallback((jobId, partId) => {
    const p = findPart(jobId, partId) || {};
    const cur = psMeta(p.status);
    if (cur.id === 'need') { quickOrder(jobId, partId); return; }
    const next = partStatusMeta.find((s) => s.pr === cur.pr + 1);
    if (next) { beforeStatusChange(partId); patchPart(jobId, partId, { status: next.id }); }
  }, [quickOrder, patchPart, beforeStatusChange]);

  // ---- order prompt --------------------------------------------------------
  const onOrderDraft = useCallback((field, value) => {
    setOrderPrompt((op) => {
      if (!op) return op;
      let v = value;
      if (field === 'cost' || field === 'price') v = parseInt(String(value).replace(/\D/g, ''), 10) || '';
      if (field === 'qty') v = intMin1(value);
      return { ...op, draft: { ...op.draft, [field]: v } };
    });
  }, []);
  const confirmOrder = useCallback(() => {
    if (!orderPrompt) return;
    const d = orderPrompt.draft;
    if (!(d.supplier && String(d.supplier).trim()) || !(num(d.cost) > 0)) { setOrderPrompt({ ...orderPrompt, showErr: true }); return; }
    const { jobId, partId, prev } = orderPrompt;
    beforeStatusChange(partId);
    patchPart(jobId, partId, {
      name: d.name, kind: d.kind, code: d.article, replArticle: d.replArticle, supplier: String(d.supplier).trim(),
      cost: num(d.cost), price: num(d.price) || 0, qty: intMin1(d.qty), eta: d.eta, status: 'ordered', orderedAt: todayStamp(),
      comment: (d.comment || '').trim(),
    });
    setOrderPrompt(null);
    if (!d.eta) setEtaPrompt({ jobId, partId, prev, draft: '' });
  }, [orderPrompt, patchPart, beforeStatusChange]);
  const cancelOrder = useCallback(() => setOrderPrompt(null), []);

  // ---- ETA prompt ----------------------------------------------------------
  const onEtaDraft = useCallback((value) => setEtaPrompt((ep) => (ep ? { ...ep, draft: value } : ep)), []);
  const confirmEta = useCallback(() => {
    if (!etaPrompt || !etaPrompt.draft.trim()) return;
    patchPart(etaPrompt.jobId, etaPrompt.partId, { eta: etaPrompt.draft.trim() });
    setEtaPrompt(null);
  }, [etaPrompt, patchPart]);
  const cancelEta = useCallback(() => {
    if (!etaPrompt) return;
    const p = findPart(etaPrompt.jobId, etaPrompt.partId) || {};
    patchPart(etaPrompt.jobId, etaPrompt.partId, { status: etaPrompt.prev, orderedAt: etaPrompt.prev === 'ordered' ? p.orderedAt : '' });
    setEtaPrompt(null);
  }, [etaPrompt, patchPart]);

  // ---- kind / analog prompt ------------------------------------------------
  const onKind = useCallback((jobId, partId, value) => {
    const p = findPart(jobId, partId) || {};
    const prevKind = p.kind || 'new';
    patchPart(jobId, partId, { kind: value });
    if (value === 'analog' || value === 'analog_orig') {
      setReplPrompt({ jobId, partId, prevKind, kind: value, draftOrig: p.code || '', draftRepl: p.replArticle || '' });
    }
  }, [patchPart]);
  const onOpenRepl = useCallback((jobId, partId) => {
    const p = findPart(jobId, partId) || {};
    const k = p.kind || 'analog';
    setReplPrompt({ jobId, partId, prevKind: k, kind: k, draftOrig: p.code || '', draftRepl: p.replArticle || '' });
  }, []);
  const onReplDraft = useCallback((field, value) => setReplPrompt((rp) => (rp ? { ...rp, [field]: value } : rp)), []);
  const confirmRepl = useCallback(() => {
    if (!replPrompt) return;
    patchPart(replPrompt.jobId, replPrompt.partId, { code: (replPrompt.draftOrig || '').trim(), replArticle: (replPrompt.draftRepl || '').trim() });
    setReplPrompt(null);
  }, [replPrompt, patchPart]);
  const cancelRepl = useCallback(() => {
    if (!replPrompt) return;
    patchPart(replPrompt.jobId, replPrompt.partId, { kind: replPrompt.prevKind });
    setReplPrompt(null);
  }, [replPrompt, patchPart]);

  // ---- comment / note prompt ----------------------------------------------
  // Свободная заметка к позиции (`part.comment`) — то же поле, что и на «Приёмке».
  // Открывается кнопкой-заметкой в строке; править можно в любой момент, не только
  // при заказе (в диалоге заказа есть отдельное поле «Комментарий»).
  const onOpenNote = useCallback((jobId, partId) => {
    const p = findPart(jobId, partId) || {};
    setNotePrompt({ jobId, partId, draft: p.comment || '' });
  }, []);
  const onNoteDraft = useCallback((value) => setNotePrompt((np) => (np ? { ...np, draft: value } : np)), []);
  const confirmNote = useCallback(() => {
    if (!notePrompt) return;
    patchPart(notePrompt.jobId, notePrompt.partId, { comment: (notePrompt.draft || '').trim() });
    setNotePrompt(null);
  }, [notePrompt, patchPart]);
  const cancelNote = useCallback(() => setNotePrompt(null), []);

  // ---- field edits ---------------------------------------------------------
  const onName = useCallback((j, id, v) => patchPart(j, id, { name: v }), [patchPart]);
  const onArticle = useCallback((j, id, v) => patchPart(j, id, { code: v }), [patchPart]);
  const onOrderedAt = useCallback((j, id, v) => patchPart(j, id, { orderedAt: v }), [patchPart]);
  const onEta = useCallback((j, id, v) => patchPart(j, id, { eta: v }), [patchPart]);
  const onQty = useCallback((j, id, v) => patchPart(j, id, { qty: intMin1(v) }), [patchPart]);
  const onSupplier = useCallback((j, id, v) => patchPart(j, id, { supplier: v }), [patchPart]);
  const onCost = useCallback((j, id, v) => patchPart(j, id, { cost: num(v) }), [patchPart]);
  // Перенос позиции между потоками биллинга: убыток №1 / убыток №2… / допродажа.
  // Пишется в part.payer (savePart мержит по id), влияет только на то, в чей документ
  // попадёт позиция (см. billing.itemsForStream).
  //
  // ОСТОРОЖНО: раньше здесь было `v === 'client' ? 'client' : 'insurance'` — то есть
  // ЛЮБОЙ убыток схлопывался в первый. С несколькими делами один клик молча уводил бы
  // позицию убытка №2 в убыток №1 (и в счёт не той страховой). Пишем ровно тот поток,
  // который выбрали, а неизвестное значение считаем убытком №1 — как раньше.
  // Перенос сохраняет id позиции (savePart мержит по нему), поэтому за ней едут
  // закупка, статус, история приёмки и фото — ничего не теряется.
  const onPayer = useCallback((j, id, v) => {
    const stream = v ? String(v) : STREAM_INSURANCE;
    patchPart(j, id, { payer: stream });
  }, [patchPart]);
  const onCopyArticle = useCallback((v) => { try { navigator.clipboard?.writeText(v || ''); } catch { /* clipboard unavailable */ } }, []);
  const onAdd = useCallback((jobId) => {
    const np = normalizePart({});
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, parts: [...j.parts, np] } : j)));
    markPart(np.id);
    if (ops.savePart) ops.savePart(jobId, np);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops]);
  const onRemove = useCallback((jobId, partId) => {
    if (!window.confirm('Удалить запчасть?')) return;
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, parts: j.parts.filter((p) => p.id !== partId) } : j)));
    removedAt.current[partId] = now() + DIRTY_MS;
    clearPart(partId);
    if (ops.removePart) ops.removePart(jobId, partId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops]);

  // ---- paint edits ---------------------------------------------------------
  const setPaint = useCallback((jobId, field, value) => {
    setJobs((prev) => prev.map((j) => {
      if (j.id !== jobId) return j;
      const paint = { ...(j.paint || { status: 'need', cost: 0 }), [field]: field === 'cost' ? num(value) : value };
      return { ...j, paint };
    }));
    paintDirty.current[jobId] = now() + DIRTY_MS;
    schedulePaintSave(jobId);
  }, [schedulePaintSave]);
  const onPaintCode = useCallback((j, v) => setPaint(j, 'code', v), [setPaint]);
  const onPaintType = useCallback((j, v) => setPaint(j, 'type', v), [setPaint]);
  const onPaintVolume = useCallback((j, v) => setPaint(j, 'volume', v), [setPaint]);
  const onPaintCost = useCallback((j, v) => setPaint(j, 'cost', v), [setPaint]);
  const onPaintStatus = useCallback((j, v) => setPaint(j, 'status', v), [setPaint]);
  // «Включить» окрасные работы у машины, у которой карточки краски ещё нет: создаём
  // пустой объект (status:'need') — он попадает в paintMap, и появляется блок с полями.
  const onAddPaint = useCallback((j) => setPaint(j, 'status', 'need'), [setPaint]);
  // Убрать окрасные работы: paint→null (savePaint пишет paint:null). Симметрично
  // onRemove у запчастей — с подтверждением, чтобы не снести данные случайно.
  const onRemovePaint = useCallback((jobId) => {
    if (!window.confirm('Убрать окрасные работы у этой машины?')) return;
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, paint: null } : j)));
    paintDirty.current[jobId] = now() + DIRTY_MS;
    schedulePaintSave(jobId);
  }, [schedulePaintSave]);

  // Смена фильтра/поиска сбрасывает заморозку → рендер снова сортирует канонически.
  const onFilter = useCallback((id) => { resetFreeze(); setFilter((f) => (f === id ? 'all' : id)); }, [resetFreeze]);
  const onSearch = useCallback((v) => { resetFreeze(); setSearch(v); }, [resetFreeze]);
  const onClearFilter = useCallback(() => { resetFreeze(); setFilter('all'); setSearch(''); }, [resetFreeze]);

  // ---- view model ----------------------------------------------------------
  // ВНИМАНИЕ: это WHITELIST — поле, не перечисленное здесь, до buildPartsVM НЕ доедет
  // и экран молча недосчитается (так уже терялись payment_type → лампочка плательщика
  // и cell_ids → ячейки склада). Добавляя поле машины на этот экран, проведи его через
  // ВСЕ три слоя: Parts.jsx (маппинг remoteJobs) → jobShell → этот cars-маппинг.
  const cars = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, {
    model: j.car_model, plate: j.plate_number, num: j.order_number, client: j.client_name || '—',
    discount: j.discount || 0, payment_type: j.payment_type, cell_ids: j.cell_ids || [],
    // Поля, из которых claimsOf(car) достаёт убытки: либо готовый claims[], либо
    // плоские (= убыток №1) у машин, заведённых до появления нескольких дел.
    claims: j.claims || null,
    claim_number: j.claim_number || '', insurer_id: j.insurer_id || '',
    insurer_name: j.insurer_name || '', policy_type: j.policy_type || '', franchise: j.franchise ?? null,
  }])), [jobs]);
  const paintMap = useMemo(() => Object.fromEntries(jobs.filter((j) => j.paint).map((j) => [j.id, j.paint])), [jobs]);
  const partsFlat = useMemo(() => jobs.flatMap((j) => (j.parts || []).map((p) => ({ ...p, carId: j.id }))), [jobs]);
  const vm = useMemo(() => buildPartsVM({ parts: partsFlat, cars, paint: paintMap, cells, filter, search, rentabTarget, frozenOrder, flashId }), [partsFlat, cars, paintMap, cells, filter, search, rentabTarget, frozenOrder, flashId]);
  useEffect(() => { vmRef.current = vm; }, [vm]);

  // ---- prompt view models (read from `jobs` state) -------------------------
  const carLabel = (jobId) => { const c = cars[jobId] || {}; return (c.model || '') + (c.plate ? ' · ' + c.plate : ''); };
  const partOf = (jobId, partId) => (jobs.find((j) => j.id === jobId)?.parts || []).find((p) => p.id === partId) || {};
  const prompts = {
    orderPrompt: orderPrompt && { name: partOf(orderPrompt.jobId, orderPrompt.partId).name || 'Запчасть', car: carLabel(orderPrompt.jobId), draft: orderPrompt.draft, showErr: orderPrompt.showErr },
    etaPrompt: etaPrompt && { name: partOf(etaPrompt.jobId, etaPrompt.partId).name || 'Запчасть', car: carLabel(etaPrompt.jobId), orderedAt: partOf(etaPrompt.jobId, etaPrompt.partId).orderedAt || todayStamp(), draft: etaPrompt.draft },
    replPrompt: replPrompt && { name: partOf(replPrompt.jobId, replPrompt.partId).name || 'Запчасть', car: carLabel(replPrompt.jobId), kind: replPrompt.kind, kindLabel: pkMeta(replPrompt.kind).label, draftOrig: replPrompt.draftOrig, draftRepl: replPrompt.draftRepl },
    notePrompt: notePrompt && { name: partOf(notePrompt.jobId, notePrompt.partId).name || 'Запчасть', car: carLabel(notePrompt.jobId), draft: notePrompt.draft },
  };

  return {
    vm, filter, search,
    handlers: {
      onSearch, onFilter, onClearFilter,
      onStatus, onAdvance, onName, onArticle, onCopyArticle, onKind, onOpenRepl,
      onOrderedAt, onEta, onQty, onSupplier, onCost, onPayer, onRemove, onAdd,
      onPaintCode, onPaintType, onPaintVolume, onPaintCost, onPaintStatus, onAddPaint, onRemovePaint,
      onOrderDraft, confirmOrder, cancelOrder,
      onEtaDraft, confirmEta, cancelEta,
      onReplDraft, confirmRepl, cancelRepl,
      onOpenNote, onNoteDraft, confirmNote, cancelNote,
    },
    prompts,
  };
}
