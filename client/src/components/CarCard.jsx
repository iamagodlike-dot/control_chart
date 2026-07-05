import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { parseAudatexPdf } from '../audatexParse';
import { PAYMENT_TYPES, isInsurance } from '../insurance';
import { STATUS_COLORS, STATUS_LABELS, effectiveStatus, jobOverallStatus, deadlineState, nextStatusAction } from './Gantt';
import { CellPickerModal } from './Warehouse';
import CostingModal from './CostingModal';
import Icon from './Icon';
import DateTimeField from './DateTimeField';

const FMT = 'YYYY-MM-DDTHH:mm';
const PREVIEW_HOUR_WIDTH = 16;
const fmtMoney = (n) => `${(Number(n) || 0).toLocaleString('ru-RU')} ₽`;

function toLocalInput(iso) {
  return iso ? dayjs(iso).format(FMT) : '';
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart.isBefore(bEnd) && bStart.isBefore(aEnd);
}

// Seed the editable stage rows from a saved job (edit mode) — kept as local
// datetime-input strings so the same row editor works for drafts and saved stages.
function seedStages(job) {
  if (!job?.stages?.length) return [];
  return [...job.stages]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || (a.start_at > b.start_at ? 1 : -1))
    .map((s) => ({
      id: s.id,
      seq: s.sequence ?? 0,
      post_id: s.post_id,
      master_id: s.master_id || '',
      status: s.status || 'planned',
      start_at: toLocalInput(s.start_at),
      end_at: toLocalInput(s.end_at),
    }));
}

// A fresh stage: continues after the previous one, on the next unused post.
function blankStage(posts, existing) {
  const last = existing[existing.length - 1];
  const start = last ? dayjs(last.end_at) : dayjs().add(1, 'hour').minute(0).second(0);
  const used = new Set(existing.map((s) => s.post_id));
  const nextPost = posts.find((p) => !used.has(p.id)) || posts[0];
  return {
    post_id: nextPost?.id || '',
    master_id: '',
    status: 'planned',
    start_at: start.format(FMT),
    end_at: start.add(4, 'hour').format(FMT),
  };
}

// Visual completion of a stage for the route progress bar: done = 100, planned = 0,
// in-progress/delayed = the elapsed share of the stage's own time window.
function progressOf(startAt, endAt, status, now) {
  if (status === 'done') return 100;
  if (status !== 'in_progress' && status !== 'delayed') return 0;
  const total = dayjs(endAt).diff(dayjs(startAt), 'minute');
  if (total <= 0) return status === 'delayed' ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(now.diff(dayjs(startAt), 'minute') / total * 100)));
}

/**
 * One screen for both adding a car (mode="create") and viewing/editing a car
 * (mode="edit"). Same layout, same route editor — the only differences are the
 * header, the footer actions and whether stage edits hit the API immediately.
 */
export default function CarCard({
  mode, job, posts, masters, now, onClose,
  onCreate,                                   // create
  onSaveInfo, onAddStage, onUpdateStage, onRemoveStage, onOpenDocs, onFinalize, onRemove, // edit
}) {
  const isEdit = mode === 'edit';

  const [form, setForm] = useState(() => ({
    car_model: job?.car_model || '',
    plate_number: job?.plate_number || '',
    vin: job?.vin || '',
    mileage: job?.mileage || '',
    color: job?.color || '',
    client_name: job?.client_name || '',
    client_phone: job?.client_phone || '',
    order_number: job?.order_number || '',
    cell_ids: job?.cell_ids || (job?.cell_id ? [job.cell_id] : []),
    expected_at: toLocalInput(job?.expected_at),
    deadline: toLocalInput(job?.deadline),
    notes: job?.notes || '',
    payment_type: job?.payment_type || 'cash',
    insurer_id: job?.insurer_id || '',
    insurer_name: job?.insurer_name || '',
    claim_number: job?.claim_number || '',
    policy_number: job?.policy_number || '',
  }));
  const [stages, setStages] = useState(() => seedStages(job));
  const [editIdx, setEditIdx] = useState(null);
  const [dirtyInfo, setDirtyInfo] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [busyStage, setBusyStage] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [costingOpen, setCostingOpen] = useState(false);
  const [localCosting, setLocalCosting] = useState(job?.costing || null);
  const [existingStages, setExistingStages] = useState([]);
  const [insurers, setInsurers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payBusy, setPayBusy] = useState(false);
  // Audatex import (create mode): parsed услуги/запчасти/скидка carried onto the
  // new job so the заказ-наряд and warehouse cell auto-fill from one import.
  const [imported, setImported] = useState(null);
  const [importedOpen, setImportedOpen] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [extractInfo, setExtractInfo] = useState('');
  const [extractError, setExtractError] = useState('');

  // Other cars' stages, for the mini-gantt conflict preview.
  useEffect(() => {
    let alive = true;
    api.gantt()
      .then((g) => { if (alive) setExistingStages(g.stages.filter((s) => s.job_id !== job?.job_id)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [job?.job_id]);

  // Insurer directory for the "Страховая" picker.
  useEffect(() => {
    let alive = true;
    api.insurers.list().then((list) => { if (alive) setInsurers(list); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // This car's invoices (edit mode) for the payment banner.
  useEffect(() => {
    const id = job?.id || job?.job_id;
    if (!isEdit || !id) return undefined;
    let alive = true;
    api.orderDocuments.listByJob(id, 'invoice').then((list) => { if (alive) setInvoices(list); }).catch(() => {});
    return () => { alive = false; };
  }, [isEdit, job?.id, job?.job_id]);

  // Re-seed local rows when the saved stages change underneath us — e.g. a status
  // advanced on the график or via the undo toast (Gantt refreshes the job prop but
  // React keeps this same instance). Skipped while a row is open for editing so
  // unsaved inline edits aren't clobbered; unsaved draft rows (no id) are kept.
  const stagesSig = (job?.stages || [])
    .map((s) => `${s.id}:${s.status}:${s.start_at}:${s.end_at}:${s.post_id}:${s.master_id ?? ''}:${s.sequence ?? ''}`)
    .join('|');
  useEffect(() => {
    if (!isEdit || editIdx !== null) return;
    setStages((prev) => [...seedStages(job), ...prev.filter((s) => !s.id)]); // eslint-disable-line react-hooks/set-state-in-effect
  }, [stagesSig, editIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  function patchForm(patch) {
    setForm((f) => ({ ...f, ...patch }));
    setDirtyInfo(true);
  }

  // Store both the insurer id (for the picker) and its name (denormalised, so
  // documents/history keep the label even if the directory entry is renamed).
  function selectInsurer(id) {
    if (!id) { patchForm({ insurer_id: '', insurer_name: '' }); return; }
    const match = insurers.find((x) => x.id === id);
    patchForm({ insurer_id: id, insurer_name: match ? match.name : form.insurer_name });
  }

  // Read a car's data straight from an Audatex calculation PDF. Fills only empty
  // identity fields (never overwrites what's typed), drops VIN/пробег into the
  // notes, and carries the услуги/запчасти/скидка onto the job for the заказ-наряд.
  async function handleAudatexUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setExtracting(true);
    setExtractError('');
    setExtractInfo('');
    try {
      const data = await parseAudatexPdf(file);
      const v = data.vehicle || {};
      if (!data.services.length && !data.parts.length && !v.car_model && !v.vin) {
        setExtractError('Не нашли данных в этом PDF — проверьте, что это калькуляция Audatex.');
        return;
      }
      setForm((f) => {
        const next = { ...f };
        if (!next.car_model && v.car_model) next.car_model = v.car_model;
        if (!next.plate_number && v.plate) next.plate_number = v.plate;
        if (!next.order_number && data.meta?.number) next.order_number = data.meta.number;
        if (!next.claim_number && data.meta?.number) next.claim_number = data.meta.number;
        if (!next.vin && v.vin) next.vin = v.vin;
        if (!next.mileage && v.mileage) next.mileage = String(v.mileage);
        return next;
      });
      setDirtyInfo(true);
      setImported({
        services: data.services.map((x) => ({ name: x.name || '', qty: Number(x.qty) || 1, price: Number(x.price) || 0 })),
        parts: data.parts.map((p) => ({ code: p.code || '', name: p.name || '', qty: Number(p.qty) || 1, unit: p.unit || 'шт.', price: Number(p.price) || 0 })),
        discount: Number(data.meta?.discount) || 0,
      });
      const bits = [];
      if (v.car_model) bits.push(v.car_model);
      bits.push(`работ: ${data.services.length}`);
      bits.push(`запчастей: ${data.parts.length}`);
      if (Number(data.meta?.discount) > 0) bits.push(`скидка: ${Number(data.meta.discount).toLocaleString('ru-RU')} ₽`);
      if (data.meta?.repair_total > 0) bits.push(`итог: ${Number(data.meta.repair_total).toLocaleString('ru-RU')} ₽`);
      setExtractInfo(`Распознано — ${bits.join(' · ')}`);
    } catch (err) {
      console.error('Ошибка импорта Audatex:', err);
      const detail = err?.message ? ` (${err.message})` : '';
      setExtractError(`Не удалось прочитать файл${detail}. Проверьте, что это PDF из Audatex.`);
    } finally {
      setExtracting(false);
    }
  }
  function patchStageRow(i, patch) {
    setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function rowIsValid(s) {
    return !!(s && s.post_id && s.start_at && s.end_at);
  }
  // Next free sequence number, so new stages never collide with existing ones.
  function nextSequence() {
    return Math.max(-1, ...stages.map((r) => (typeof r.seq === 'number' ? r.seq : -1))) + 1;
  }

  // Persist the row at index i. Returns true if it was committed (or is a valid
  // create-mode draft), false if it was skipped as incomplete.
  async function commitStage(i) {
    const s = stages[i];
    if (!rowIsValid(s)) return false;
    if (!isEdit) { setEditIdx(null); return true; }        // create: saved together on submit
    const seq = typeof s.seq === 'number' ? s.seq : nextSequence();
    const apiData = {
      post_id: s.post_id,
      master_id: s.master_id || null,
      status: s.status || 'planned',
      sequence: seq,                                        // keep a stage's own sequence; never renumber by index
      start_at: dayjs(s.start_at).toISOString(),
      end_at: dayjs(s.end_at).toISOString(),
    };
    setBusyStage(true);
    try {
      if (s.id) {
        await onUpdateStage(s.id, apiData);
      } else {
        const created = await onAddStage(apiData);
        patchStageRow(i, { id: created?.id, seq });
      }
      setEditIdx(null);
      return true;
    } catch {
      // Never let a failed save throw — it would block closing/navigating the card.
      alert('Не удалось сохранить этап маршрута. Проверьте соединение и попробуйте ещё раз.');
      return false;
    } finally {
      setBusyStage(false);
    }
  }

  // Commit whatever row is open before moving focus, so inline edits are never
  // left unsaved-but-shown-as-saved. Incomplete drafts are kept, not persisted.
  async function flushOpenRow() {
    if (!isEdit || editIdx === null) return true;
    if (!rowIsValid(stages[editIdx])) return true;
    return commitStage(editIdx);
  }

  async function addStageRow() {
    if (!(await flushOpenRow())) return;
    setStages((prev) => {
      const next = [...prev, blankStage(posts, prev)];
      setEditIdx(next.length - 1);
      return next;
    });
  }

  async function openStage(j) {
    if (editIdx === j) return;
    if (!(await flushOpenRow())) return;
    setEditIdx(j);
  }

  async function removeStageRow(i) {
    const s = stages[i];
    if (isEdit && s.id) {
      setBusyStage(true);
      try { await onRemoveStage(s.id); } finally { setBusyStage(false); }
    }
    setStages((prev) => prev.filter((_, idx) => idx !== i));
    setEditIdx(null);
  }

  // One-tap status advance from a route row (edit mode). Same rules as the график:
  // confirm before «Готово», keep only one «В работе» per car (auto-close previous).
  // Updates the row locally and persists live; no undo toast here (the card has no
  // toast) — the график carries the richer flow.
  async function advanceRow(i) {
    const row = stages[i];
    const action = nextStatusAction({ status: row.status, start_at: row.start_at, end_at: row.end_at }, now);
    if (!action) return;
    if (action.next === 'done' && !window.confirm('Отметить этап «Готово»?')) return;
    const patches = [{ i, status: action.next }];
    if (action.next === 'in_progress') {
      stages.forEach((s, j) => { if (j !== i && s.status === 'in_progress') patches.push({ i: j, status: 'done' }); });
    }
    setStages((prev) => prev.map((s, j) => {
      const p = patches.find((x) => x.i === j);
      return p ? { ...s, status: p.status } : s;
    }));
    if (isEdit) {
      for (const p of patches) {
        const s = stages[p.i];
        if (s.id) { try { await onUpdateStage(s.id, { status: p.status }); } catch { /* график покажет актуальное */ } }
      }
    }
  }

  async function closeCard() {
    await flushOpenRow();
    onClose();
  }
  async function openDocs() { await flushOpenRow(); onOpenDocs(); }
  async function openCosting() { await flushOpenRow(); setCostingOpen(true); }
  async function finalize() { await flushOpenRow(); onFinalize(); }

  async function saveInfo() {
    // Changing the payer after documents were issued: the счёт/акт/заказ-наряд froze
    // the old payer and won't auto-update, while Финансы re-attribute by the live
    // field — warn so the two don't silently disagree.
    const payerChanged = isEdit && (
      form.payment_type !== (job.payment_type || 'cash') ||
      (form.insurer_name || '') !== (job.insurer_name || '')
    );
    if (payerChanged) {
      try {
        const id = job?.id || job?.job_id;
        const docs = id ? await api.orderDocuments.listByJob(id) : [];
        if (docs.length && !window.confirm('По машине уже выпущены документы (счёт/акт/заказ-наряд) с прежним плательщиком — они не изменятся сами. Сохранить новый тип оплаты? Документы при необходимости переоформите в «Документы».')) return;
      } catch { /* не удалось проверить документы — не блокируем сохранение */ }
    }
    setSavingInfo(true);
    try {
      await onSaveInfo({
        ...form,
        expected_at: form.expected_at ? dayjs(form.expected_at).toISOString() : null,
        deadline: form.deadline ? dayjs(form.deadline).toISOString() : null,
      });
      setDirtyInfo(false);
    } finally {
      setSavingInfo(false);
    }
  }

  async function submitCreate() {
    if (!form.car_model.trim()) { alert('Укажите марку и модель автомобиля'); return; }
    setSavingInfo(true);
    try {
      const payload = {
        car_model: form.car_model,
        plate_number: form.plate_number,
        vin: form.vin,
        mileage: form.mileage || null,
        color: form.color || null,
        client_name: form.client_name,
        client_phone: form.client_phone,
        order_number: form.order_number,
        notes: form.notes,
        payment_type: form.payment_type,
        insurer_id: form.insurer_id,
        insurer_name: form.insurer_name,
        claim_number: form.claim_number,
        policy_number: form.policy_number,
        expected_at: form.expected_at ? dayjs(form.expected_at).toISOString() : null,
        deadline: form.deadline ? dayjs(form.deadline).toISOString() : null,
        // From an Audatex import — carried onto the job so the заказ-наряд + warehouse cell auto-fill.
        ...(imported && (imported.services.length || imported.parts.length)
          ? { services: imported.services, parts: imported.parts, discount: imported.discount || undefined }
          : {}),
        stages: stages
          .filter((s) => s.post_id && s.start_at && s.end_at)
          .map((s, i) => ({
            post_id: s.post_id,
            master_id: s.master_id || null,
            sequence: i,
            status: s.status || 'planned',
            start_at: dayjs(s.start_at).toISOString(),
            end_at: dayjs(s.end_at).toISOString(),
          })),
      };
      await onCreate(payload, form.cell_ids);
    } finally {
      setSavingInfo(false);
    }
  }

  const overall = isEdit ? jobOverallStatus(job, now) : null;
  const dlState = isEdit ? deadlineState(job, now) : null;
  const routeSet = stages.filter((s) => s.post_id && s.start_at && s.end_at);
  const svcSum = (imported?.services || []).reduce((a, s) => a + (Number(s.price) || 0) * (Number(s.qty) || 1), 0);
  const partsSum = (imported?.parts || []).reduce((a, p) => a + (Number(p.price) || 0) * (Number(p.qty) || 1), 0);

  // Payment status across this car's invoices.
  const invAmount = invoices.reduce((s, i) => s + (Number(i.totals?.total) || 0), 0);
  const hasInvoice = invoices.length > 0;
  const allPaid = hasInvoice && invoices.every((i) => i.paid);
  async function togglePaid() {
    const id = job?.id || job?.job_id;
    if (!hasInvoice || !id) return;
    const makePaid = !allPaid;
    setPayBusy(true);
    try { await Promise.all(invoices.map((i) => api.orderDocuments.setPaid(i.id, makePaid))); } catch { alert('Не удалось сохранить отметку оплаты. Проверьте соединение и попробуйте ещё раз.'); }
    try { setInvoices(await api.orderDocuments.listByJob(id, 'invoice')); } catch { /* ignore */ }
    setPayBusy(false);
  }

  // Stable object for the costing modal: without memoization a fresh literal
  // would be created on every CarCard render (clock tick / live Firestore push),
  // needlessly re-rendering the open modal.
  const costingJob = useMemo(() => ({ ...job, costing: localCosting }), [job, localCosting]);

  // Does the route overshoot the deadline? (shown live in both modes)
  const deadlineWarn = useMemo(() => {
    if (!form.deadline || !routeSet.length) return null;
    const ends = routeSet.map((s) => dayjs(s.end_at));
    const lastEnd = ends.reduce((m, d) => (d.isAfter(m) ? d : m), ends[0]);
    return lastEnd.isAfter(dayjs(form.deadline)) ? lastEnd : null;
  }, [form.deadline, routeSet]);

  // Read-only summaries + a derived event journal (edit mode). Works/parts are the
  // ones saved on the job; the journal is synthesised from the route (we don't store
  // per-event timestamps) so its times are the stages' scheduled ones.
  const works = isEdit ? (job?.services || []) : [];
  const jobParts = isEdit ? (job?.parts || []) : [];
  const worksSum = works.reduce((a, s) => a + (Number(s.price) || 0) * (Number(s.qty) || 1), 0);
  const journal = useMemo(() => {
    if (!isEdit) return [];
    const ev = [];
    if (job?.created_at) ev.push({ t: job.created_at, text: 'Заказ-наряд создан', color: 'var(--color-primary)' });
    [...(job?.stages || [])]
      .sort((a, b) => (a.start_at > b.start_at ? 1 : -1))
      .forEach((s, i) => {
        const post = posts.find((p) => p.id === s.post_id);
        const nm = post?.name || `Этап ${i + 1}`;
        if (s.status === 'done') ev.push({ t: s.end_at, text: `${nm} — этап завершён`, color: STATUS_COLORS.done });
        else if (s.status === 'in_progress') ev.push({ t: s.start_at, text: `${nm} — в работе`, color: STATUS_COLORS.in_progress });
        else ev.push({ t: s.start_at, text: `${nm} — запланирован`, color: STATUS_COLORS.planned, planned: true });
      });
    return ev.sort((a, b) => dayjs(a.t).valueOf() - dayjs(b.t).valueOf());
  }, [isEdit, job, posts]);

  return (
    <div className="modal-backdrop cc-backdrop" onClick={closeCard}>
      <div
        className="modal cc-modal"
        style={{ '--sc': isEdit ? STATUS_COLORS[overall] : 'var(--color-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cc-header">
          <div className="cc-header-main">
            <div className="cc-header-text">
              <div className="cc-doc-label">{isEdit ? (job.order_number ? `Заказ-наряд №${job.order_number}` : 'Заказ-наряд') : 'Новый заказ'}</div>
              <h3 className="cc-title">{isEdit ? (job.car_model || 'Без модели') : 'Новый автомобиль'}</h3>
              <div className="cc-header-meta">
                {isEdit ? (
                  <>
                    {job.plate_number && <span className="cc-plate">{job.plate_number}</span>}
                    {job.client_name && <span className="cc-header-client">{job.client_name}</span>}
                    {job.client_phone && <span className="cc-header-phone">{job.client_phone}</span>}
                    {isInsurance(form) && form.insurer_name && <span className="cc-insurer-chip"><Icon name="shield" size={12} /> {form.insurer_name}</span>}
                  </>
                ) : (
                  <span className="cc-header-sub">Заполните данные — машина появится в графике</span>
                )}
              </div>
            </div>
          </div>
          <div className="cc-header-right">
            {isEdit && <span className="cc-status-pill" style={{ '--badge-color': STATUS_COLORS[overall] }}>{STATUS_LABELS[overall]}</span>}
            <button className="cc-close" onClick={closeCard} aria-label="Закрыть"><Icon name="x" size={18} strokeWidth={2} /></button>
          </div>
        </div>

        <div className="cc-body">
          {isEdit && (
            <div className="cc-spec">
              <SpecItem label="VIN" value={form.vin} />
              <SpecItem label="Пробег" value={form.mileage ? `${form.mileage} км` : ''} />
              <SpecItem label="Цвет" value={form.color} />
              <div className="cc-spec-item">
                <span className="cc-spec-label">Дедлайн</span>
                <span className={`cc-spec-value${!form.deadline ? ' is-empty' : (dlState === 'missed' || dlState === 'at-risk') ? ' is-risk' : ''}`}>
                  {form.deadline ? dayjs(form.deadline).format('DD.MM.YY HH:mm') : '—'}
                </span>
              </div>
            </div>
          )}
          {isEdit && hasInvoice && (
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '12px 16px', borderRadius: 10, marginBottom: 4,
                background: `color-mix(in srgb, var(${allPaid ? '--color-success' : '--color-danger'}) 14%, transparent)`,
                border: `1px solid var(${allPaid ? '--color-success' : '--color-danger'})`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <span className="cc-pay-shield" style={{ background: `color-mix(in srgb, var(${allPaid ? '--color-success' : '--color-danger'}) 16%, transparent)`, color: `var(${allPaid ? '--color-success' : '--color-danger'})` }}><Icon name="shield" size={18} /></span>
                <div>
                  <div style={{ fontSize: 12, color: `var(${allPaid ? '--color-success' : '--color-danger'})` }}>
                    {allPaid ? 'Счёт оплачен' : 'Счёт не оплачен'}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: `var(${allPaid ? '--color-success' : '--color-danger'})` }}>
                    {allPaid ? 'Оплачено' : 'Не оплачено'} · {fmtMoney(invAmount)}
                  </div>
                </div>
              </div>
              <button className={allPaid ? '' : 'primary'} disabled={payBusy} onClick={togglePaid} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {payBusy ? '…' : (allPaid ? 'Отменить оплату' : <><Icon name="check" size={14} strokeWidth={2} />Отметить оплату</>)}
              </button>
            </div>
          )}
          {isEdit && !hasInvoice && (
            <div className="cc-hint" style={{ marginBottom: 4 }}>Счёт ещё не выставлен — оформите его в «Документы».</div>
          )}
          {!isEdit && (
            <div className="cc-audatex">
              <div className="cc-audatex-row">
                <label className={`audatex-upload-btn${extracting ? ' is-busy' : ''}`}>
                  {extracting ? 'Распознаём…' : <><Icon name="file" size={14} /> Импорт из Audatex (PDF)</>}
                  <input type="file" accept="application/pdf" onChange={handleAudatexUpload} disabled={extracting} hidden />
                </label>
                <span className="cc-audatex-hint">Подгрузит марку, гос. номер, VIN, пробег, № дела и смету в заказ-наряд</span>
              </div>
              {extractInfo && <div className="cc-audatex-ok"><Icon name="check" size={13} strokeWidth={2} /> {extractInfo}</div>}
              {extractError && <div className="cc-audatex-err">{extractError}</div>}
            </div>
          )}

          <section className="cc-section">
            <div className="cc-section-head"><span className="cc-section-icon">🚘</span>Автомобиль и клиент</div>
            <div className="cc-grid">
              <label className="cc-field full">
                <span>Марка и модель <b className="cc-req">*</b></span>
                <input placeholder="напр. Geely Atlas" value={form.car_model} onChange={(e) => patchForm({ car_model: e.target.value })} />
              </label>
              <label className="cc-field">
                <span>Гос. номер</span>
                <input placeholder="А123ВС 96" value={form.plate_number} onChange={(e) => patchForm({ plate_number: e.target.value })} />
              </label>
              <label className="cc-field">
                <span>№ заказ-наряда</span>
                <input placeholder="напр. 1506/1" value={form.order_number} onChange={(e) => patchForm({ order_number: e.target.value })} />
              </label>
              <label className="cc-field full">
                <span>VIN</span>
                <input placeholder="напр. LB37622Z0NX012345" value={form.vin} onChange={(e) => patchForm({ vin: e.target.value })} />
              </label>
              <label className="cc-field">
                <span>Пробег, км</span>
                <input placeholder="напр. 84000" value={form.mileage} onChange={(e) => patchForm({ mileage: e.target.value })} />
              </label>
              <label className="cc-field">
                <span>Цвет</span>
                <input placeholder="напр. чёрный / 1G3" value={form.color} onChange={(e) => patchForm({ color: e.target.value })} />
              </label>
              <label className="cc-field">
                <span>Клиент</span>
                <input placeholder="Имя клиента" value={form.client_name} onChange={(e) => patchForm({ client_name: e.target.value })} />
              </label>
              <label className="cc-field">
                <span>Телефон</span>
                <input placeholder="+7 …" value={form.client_phone} onChange={(e) => patchForm({ client_phone: e.target.value })} />
              </label>
            </div>
          </section>

          <section className="cc-section">
            <div className="cc-section-head"><span className="cc-section-icon">⏱️</span>Сроки и хранение</div>
            <div className="cc-grid">
              <label className="cc-field">
                <span>Дата заезда <i>(если ещё не приехала)</i></span>
                <DateTimeField value={form.expected_at} onChange={(v) => patchForm({ expected_at: v })} />
              </label>
              <label className="cc-field">
                <span>Дедлайн <i>(выдать клиенту до)</i></span>
                <DateTimeField value={form.deadline} onChange={(v) => patchForm({ deadline: v })} />
              </label>
              <div className="cc-field full">
                <span>Ячейки склада</span>
                <button type="button" className="cc-cell-btn" onClick={() => setPickerOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="box" size={14} />{form.cell_ids.length ? `${form.cell_ids.join(', ')} — изменить` : 'Выбрать ячейки'}
                </button>
              </div>
            </div>
            {isEdit && !form.cell_ids.length && job.storage_location && (
              <div className="cc-hint">Старое место (текст): «{job.storage_location}» — выберите ячейку, чтобы связать со складом</div>
            )}
            {isEdit && job.deadline && dlState && (
              <div className={`cc-deadline is-${dlState}`}>
                {dlState === 'missed' && <><Icon name="warning" size={13} /> Дедлайн просрочен</>}
                {dlState === 'at-risk' && <><Icon name="warning" size={13} /> Маршрут не укладывается в дедлайн</>}
                {dlState === 'ok' && <><Icon name="check" size={13} strokeWidth={2} /> Укладывается в дедлайн</>}
              </div>
            )}
            {!isEdit && deadlineWarn && (
              <div className="deadline-warning"><Icon name="warning" size={13} /> Последний этап заканчивается {deadlineWarn.format('DD.MM HH:mm')} — позже дедлайна {dayjs(form.deadline).format('DD.MM HH:mm')}</div>
            )}
          </section>

          <section className="cc-section">
            <div className="cc-section-head"><span className="cc-section-icon">💳</span>Оплата и страховая</div>
            <div className="cc-grid">
              <label className="cc-field">
                <span>Тип оплаты</span>
                <select value={form.payment_type} onChange={(e) => patchForm({ payment_type: e.target.value })}>
                  {PAYMENT_TYPES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              {form.payment_type === 'insurance' && (
                <label className="cc-field">
                  <span>Страховая компания</span>
                  <select value={form.insurer_id} onChange={(e) => selectInsurer(e.target.value)}>
                    <option value="">— выберите —</option>
                    {form.insurer_id && form.insurer_name && !insurers.some((x) => x.id === form.insurer_id) && (
                      <option value={form.insurer_id}>{form.insurer_name} (нет в справочнике)</option>
                    )}
                    {insurers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
              )}
              {form.payment_type === 'insurance' && (
                <label className="cc-field">
                  <span>№ убытка (дела)</span>
                  <input placeholder="напр. PVU-1234567" value={form.claim_number} onChange={(e) => patchForm({ claim_number: e.target.value })} />
                </label>
              )}
              {form.payment_type === 'insurance' && (
                <label className="cc-field">
                  <span>№ полиса (ОСАГО/КАСКО)</span>
                  <input placeholder="серия и номер" value={form.policy_number} onChange={(e) => patchForm({ policy_number: e.target.value })} />
                </label>
              )}
            </div>
            {form.payment_type === 'insurance' && !insurers.length && (
              <div className="cc-hint">Справочник страховых пуст — добавьте их в разделе «Посты и мастера».</div>
            )}
          </section>

          <section className="cc-section">
            <div className="cc-section-head"><span className="cc-section-icon">📝</span>Примечания</div>
            <textarea className="cc-notes" placeholder="Комментарии по работе, договорённости с клиентом…" value={form.notes} onChange={(e) => patchForm({ notes: e.target.value })} />
          </section>

          {!isEdit && imported && (imported.services.length > 0 || imported.parts.length > 0) && (
            <section className="cc-section">
              <button type="button" className="cc-imported-head" onClick={() => setImportedOpen((o) => !o)}>
                <span className="cc-section-icon">🧾</span>Распознанные позиции
                <span className="cc-imported-count">работ {imported.services.length} · запчастей {imported.parts.length}</span>
                <span className="cc-imported-chevron"><Icon name={importedOpen ? 'chevron-down' : 'chevron-right'} size={13} /></span>
              </button>
              {importedOpen && (
                <div className="cc-imported-body">
                  {imported.services.length > 0 && (
                    <div className="cc-imported-group">
                      <div className="cc-imported-sub"><span>Работы</span><span>{svcSum.toLocaleString('ru-RU')} ₽</span></div>
                      <div className="cc-imported-list">
                        {imported.services.map((s, i) => (
                          <div className="cc-imported-row" key={`svc-${i}`}>
                            <span className="cc-imported-name">{s.name || '—'}</span>
                            {s.qty > 1 && <span className="cc-imported-qty">{s.qty} ×</span>}
                            <span className="cc-imported-price">{Number(s.price).toLocaleString('ru-RU')} ₽</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {imported.parts.length > 0 && (
                    <div className="cc-imported-group">
                      <div className="cc-imported-sub"><span>Запчасти</span><span>{partsSum.toLocaleString('ru-RU')} ₽</span></div>
                      <div className="cc-imported-list">
                        {imported.parts.map((p, i) => (
                          <div className="cc-imported-row" key={`part-${i}`}>
                            <span className="cc-imported-name">{p.name || '—'}{p.code ? ` · ${p.code}` : ''}</span>
                            <span className="cc-imported-qty">{p.qty} {p.unit || 'шт.'}</span>
                            <span className="cc-imported-price">{Number(p.price).toLocaleString('ru-RU')} ₽</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="cc-imported-foot">
                    {imported.discount > 0 ? <span>Скидка Audatex: {imported.discount.toLocaleString('ru-RU')} ₽</span> : <span />}
                    <span className="cc-imported-note">итоговый расчёт с НДС — в заказ-наряде</span>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="cc-section">
            <div className="cc-section-head">
              <span className="cc-section-icon">🛠️</span>Маршрут по постам
              <span className="cc-section-hint">необязательно — можно запланировать позже</span>
            </div>

            {stages.length === 0 && (
              <div className="cc-route-empty">Маршрут не задан — машина встанет в список как ожидаемая</div>
            )}

            <div className="cc-route">
              {stages.map((s, i) => {
                const post = posts.find((p) => p.id === s.post_id);
                const master = masters.find((m) => m.id === s.master_id);
                const status = effectiveStatus({ start_at: s.start_at, end_at: s.end_at, status: s.status }, now);
                const pct = progressOf(s.start_at, s.end_at, status, now);
                const expanded = editIdx === i;
                return (
                  <div key={s.id || `draft-${i}`} className={`cc-stage${expanded ? ' is-editing' : ''}`}>
                    <div className="cc-stage-num" style={{ background: STATUS_COLORS[status] }}>{i + 1}</div>
                    {expanded ? (
                      <div className="cc-stage-edit">
                        <div className="cc-stage-edit-grid">
                          <label className="cc-field">
                            <span>Пост</span>
                            <select value={s.post_id} onChange={(e) => patchStageRow(i, { post_id: e.target.value })}>
                              {posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </label>
                          <label className="cc-field">
                            <span>Мастер</span>
                            <select value={s.master_id} onChange={(e) => patchStageRow(i, { master_id: e.target.value })}>
                              <option value="">— не назначен —</option>
                              {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                          </label>
                          <label className="cc-field">
                            <span>Начало</span>
                            <DateTimeField value={s.start_at} onChange={(v) => patchStageRow(i, { start_at: v })} />
                          </label>
                          <label className="cc-field">
                            <span>Конец</span>
                            <DateTimeField value={s.end_at} onChange={(v) => patchStageRow(i, { end_at: v })} />
                          </label>
                          {isEdit && (
                            <label className="cc-field">
                              <span>Статус</span>
                              <select value={s.status} onChange={(e) => patchStageRow(i, { status: e.target.value })}>
                                {Object.entries(STATUS_LABELS).filter(([k]) => k !== 'queued').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                              </select>
                            </label>
                          )}
                        </div>
                        <div className="cc-stage-edit-actions">
                          <button className="danger small" disabled={busyStage} onClick={() => removeStageRow(i)}>Удалить</button>
                          <button className="primary small" disabled={busyStage} onClick={() => commitStage(i)}>{busyStage ? '…' : 'Готово'}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="cc-stage-view" onClick={() => openStage(i)}>
                        <div className="cc-stage-info">
                          <div className="cc-stage-title">{post?.name || 'Пост не выбран'}</div>
                          <div className="cc-stage-sub">
                            {dayjs(s.start_at).format('DD.MM HH:mm')} — {dayjs(s.end_at).format('DD.MM HH:mm')}{master ? ` · ${master.name}` : ''}
                          </div>
                          <div className="cc-stage-progress">
                            <div className="cc-stage-progress-bar"><i style={{ width: `${pct}%`, background: STATUS_COLORS[status] }} /></div>
                            <span className="cc-stage-pct">{pct}%</span>
                          </div>
                        </div>
                        <span className="job-status-badge" style={{ '--badge-color': STATUS_COLORS[status] }}>{STATUS_LABELS[status]}</span>
                        {(() => {
                          const act = nextStatusAction(s, now);
                          if (!act) return null;
                          return (
                            <button
                              className={`cc-advance${act.due ? ' is-due' : ''}`}
                              title={`${act.label} этап`}
                              onClick={(e) => { e.stopPropagation(); advanceRow(i); }}
                            >
                              {act.icon} {act.label}
                            </button>
                          );
                        })()}
                        <span className="cc-stage-edit-hint">изменить</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button className="cc-add-stage" onClick={addStageRow}>+ Добавить этап маршрута</button>

            {routeSet.length > 0 && (
              <>
                <div className="cc-section-subhead">Где это встанет в графике</div>
                <RoutePreview posts={posts} draftStages={stages} existingStages={existingStages} deadline={form.deadline} highlightSaved={isEdit} />
              </>
            )}
          </section>

          {isEdit && works.length > 0 && (
            <section className="cc-section">
              <div className="cc-section-head"><span className="cc-section-icon" />Работы<span className="cc-section-hint">{works.length} поз.</span></div>
              <div className="cc-sum-list">
                {works.map((s, i) => (
                  <div className="cc-sum-row" key={`w-${i}`}>
                    <span className="cc-sum-ico"><Icon name="wrench" size={15} /></span>
                    <span className="cc-sum-name">{s.name || '—'}</span>
                    {Number(s.qty) > 1 && <span className="cc-sum-qty">{s.qty} ×</span>}
                    <span className="cc-sum-val">{fmtMoney((Number(s.price) || 0) * (Number(s.qty) || 1))}</span>
                  </div>
                ))}
              </div>
              <div className="cc-sum-total"><span>Итого работ</span><b>{fmtMoney(worksSum)}</b></div>
            </section>
          )}

          {isEdit && (jobParts.length > 0 || invoices.length > 0) && (
            <section className="cc-section">
              <div className="cc-section-head"><span className="cc-section-icon" />Запчасти и документы</div>
              <div className="cc-2col">
                <div>
                  <div className="cc-section-subhead">Запчасти</div>
                  {jobParts.length ? (
                    <div className="cc-sum-list">
                      {jobParts.map((p, i) => (
                        <div className="cc-sum-row" key={`p-${i}`}>
                          <span className="cc-sum-ico"><Icon name="box" size={15} /></span>
                          <span className="cc-sum-name">{p.name || '—'}{p.code ? ` · ${p.code}` : ''}</span>
                          <span className="cc-sum-qty">{p.qty ?? 1} шт.</span>
                        </div>
                      ))}
                    </div>
                  ) : <div className="cc-hint" style={{ marginTop: 0 }}>Не указаны</div>}
                </div>
                <div>
                  <div className="cc-section-subhead">Документы</div>
                  {invoices.length ? (
                    <div className="cc-sum-list">
                      {invoices.map((inv) => (
                        <div className="cc-sum-row" key={inv.id} style={{ cursor: 'pointer' }} onClick={openDocs}>
                          <span className="cc-sum-ico"><Icon name="file" size={15} /></span>
                          <span className="cc-sum-name">Счёт{inv.number ? ` №${inv.number}` : ''}</span>
                          <span className="cc-doc-pill" style={{ background: `color-mix(in srgb, var(${inv.paid ? '--color-success' : '--color-warning'}) 16%, transparent)`, color: `var(${inv.paid ? '--color-success' : '--color-warning'})` }}>{inv.paid ? 'Оплачен' : 'Не оплачен'}</span>
                        </div>
                      ))}
                    </div>
                  ) : <div className="cc-hint" style={{ marginTop: 0 }}>Счёт не выставлен</div>}
                </div>
              </div>
            </section>
          )}

          {isEdit && journal.length > 0 && (
            <section className="cc-section">
              <div className="cc-section-head"><span className="cc-section-icon" />Журнал</div>
              <div className="cc-journal">
                {journal.map((e, i) => (
                  <div className="cc-journal-item" key={`j-${i}`}>
                    <span className="cc-journal-dot" style={{ background: e.color }} />
                    <div className="cc-journal-body">
                      <span className="cc-journal-time">{dayjs(e.t).format('DD.MM.YY HH:mm')}{e.planned ? ' · план' : ''}</span>
                      <span className="cc-journal-text">{e.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="cc-footer">
          {isEdit ? (
            <>
              <button className="danger cc-btn-ico" onClick={onRemove}><Icon name="trash" size={15} />Удалить</button>
              <div className="cc-footer-actions">
                <button className="cc-btn-ico" onClick={openDocs}><Icon name="file" size={15} />Документы</button>
                <button className="cc-btn-ico" onClick={openCosting}><Icon name="wallet" size={15} />Себестоимость</button>
                {routeSet.length > 0 && <button className="cc-btn-ico" onClick={finalize}><Icon name="check" size={15} strokeWidth={2} />Завершить</button>}
                <button className="primary" disabled={savingInfo || !dirtyInfo} onClick={saveInfo}>
                  {savingInfo ? 'Сохраняем…' : dirtyInfo ? 'Сохранить' : 'Сохранено'}
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="cc-footer-hint">
                {routeSet.length ? <><Icon name="check" size={13} strokeWidth={2} /> Маршрут задан — встанет в график</> : 'Без маршрута — попадёт в список ожидания'}
              </span>
              <div className="cc-footer-actions">
                <button onClick={onClose}>Отмена</button>
                <button className="primary" disabled={savingInfo} onClick={submitCreate}>{savingInfo ? 'Добавляем…' : 'Добавить автомобиль'}</button>
              </div>
            </>
          )}
        </div>
      </div>

      {pickerOpen && (
        <CellPickerModal
          currentCellIds={form.cell_ids}
          onSave={(ids) => patchForm({ cell_ids: ids })}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {costingOpen && (
        <CostingModal
          job={costingJob}
          onSaved={(c) => setLocalCosting(c)}
          onClose={() => setCostingOpen(false)}
        />
      )}
    </div>
  );
}

// Mini-gantt showing where the draft/edited route lands vs. cars already on the
// posts, so time conflicts are visible before saving.
function RoutePreview({ posts, draftStages, existingStages, deadline, highlightSaved }) {
  const validDraft = draftStages.filter((s) => s.post_id && s.start_at && s.end_at);

  const usedPostIds = useMemo(() => {
    const seen = new Set();
    const ordered = [];
    for (const s of validDraft) {
      if (!seen.has(s.post_id)) { seen.add(s.post_id); ordered.push(s.post_id); }
    }
    return ordered;
  }, [validDraft]);

  if (usedPostIds.length === 0) {
    return <div className="route-preview"><div className="route-preview-empty">Заполните пост и время этапа, чтобы увидеть превью на графике</div></div>;
  }

  const starts = validDraft.map((s) => dayjs(s.start_at));
  const ends = validDraft.map((s) => dayjs(s.end_at));
  if (deadline) ends.push(dayjs(deadline));
  const rangeStart = starts.reduce((min, d) => (d.isBefore(min) ? d : min), starts[0]).subtract(1, 'hour').startOf('hour');
  const rangeEnd = ends.reduce((max, d) => (d.isAfter(max) ? d : max), ends[0]).add(1, 'hour').endOf('hour');
  const totalHours = Math.max(rangeEnd.diff(rangeStart, 'hour'), 1);
  const totalWidth = totalHours * PREVIEW_HOUR_WIDTH;
  const now = dayjs();

  const toX = (date) => dayjs(date).diff(rangeStart, 'minute') / 60 * PREVIEW_HOUR_WIDTH;

  const dayTicks = [];
  let cursor = rangeStart.startOf('day');
  while (cursor.isBefore(rangeEnd)) {
    if (cursor.isAfter(rangeStart)) dayTicks.push(cursor);
    cursor = cursor.add(1, 'day');
  }

  const rowsByPost = usedPostIds.map((postId) => {
    const post = posts.find((p) => p.id === postId);
    const existing = existingStages.filter((s) => s.post_id === postId);
    const draft = validDraft.filter((s) => s.post_id === postId);
    return { postId, name: post?.name || `Пост #${postId}`, existing, draft };
  });

  return (
    <div className="route-preview">
      <div className="route-preview-scroll">
        <div style={{ width: 150 + totalWidth, position: 'relative' }}>
          <div className="route-preview-ticks" style={{ width: 150 + totalWidth }}>
            <div style={{ width: 150, flexShrink: 0 }} />
            <div style={{ position: 'relative', width: totalWidth }}>
              {dayTicks.map((d) => (
                <div key={d.format()} className="route-preview-tick" style={{ left: toX(d) }}>{d.format('DD.MM')}</div>
              ))}
              {now.isAfter(rangeStart) && now.isBefore(rangeEnd) && (
                <div className="route-preview-now" style={{ left: toX(now) }} />
              )}
            </div>
          </div>

          {deadline && dayjs(deadline).isAfter(rangeStart) && dayjs(deadline).isBefore(rangeEnd) && (
            <div className="route-preview-deadline" style={{ left: 150 + toX(deadline), height: 22 + rowsByPost.length * 41 }}>
              <span className="route-preview-deadline-label">дедлайн</span>
            </div>
          )}

          {rowsByPost.map((row) => (
            <div className="route-preview-row" key={row.postId}>
              <div className="route-preview-label">{row.name}</div>
              <div className="route-preview-track" style={{ width: totalWidth }}>
                {row.existing.map((s) => (
                  <div
                    key={s.id}
                    className="route-preview-block"
                    style={{ left: toX(s.start_at), width: Math.max(toX(s.end_at) - toX(s.start_at), 8) }}
                    title={`${s.car_model} (занято)`}
                  >
                    {s.car_model}
                  </div>
                ))}
                {row.draft.map((s, i) => {
                  const conflict = row.existing.some((e) => e.status !== 'done' && overlaps(dayjs(s.start_at), dayjs(s.end_at), dayjs(e.start_at), dayjs(e.end_at)));
                  return (
                    <div
                      key={`draft-${i}`}
                      className={`route-preview-block is-draft${conflict ? ' has-conflict' : ''}`}
                      style={{ left: toX(s.start_at), width: Math.max(toX(s.end_at) - toX(s.start_at), 8) }}
                      title={conflict ? 'Пересекается с существующей записью на этом посту' : (highlightSaved ? 'Этап этой машины' : 'Новый этап')}
                    >
                      {highlightSaved ? 'эта' : 'новый'}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="route-preview-hint">Серые блоки — занято другими машинами, синие — этапы этого заказа, красные — конфликт по времени</div>
    </div>
  );
}

// One cell of the header spec-strip (VIN · Пробег · Цвет · Дедлайн).
function SpecItem({ label, value }) {
  return (
    <div className="cc-spec-item">
      <span className="cc-spec-label">{label}</span>
      <span className={`cc-spec-value${value ? '' : ' is-empty'}`}>{value || '—'}</span>
    </div>
  );
}
