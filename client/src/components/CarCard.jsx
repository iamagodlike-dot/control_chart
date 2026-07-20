import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { auth } from '../firebase';
import { uploadPhoto, deletePhotoFile } from '../photos';
import { parseAudatexPdf } from '../audatexParse';
import { PAYMENT_TYPES, POLICY_TYPES, isInsurance, OSAGO_MAX_REPAIR_WORKDAYS, OSAGO_PENALTY_PER_DAY, workdaysBetween, addWorkdays } from '../insurance';
import { genPartId, partStatusMeta, psMeta } from '../parts';
import {
  STREAM_INSURANCE, STREAM_CLIENT, STREAM_ALL,
  claimsOf, streamsOf, itemsForStream, defaultStream, claimLabel, streamOf,
} from '../billing';
import { PHASE, DEFAULT_APPROVAL_STATUS, isRepair } from '../phase';
import { STATUS_COLORS, STATUS_LABELS, effectiveStatus, jobOverallStatus, deadlineState, nextStatusAction } from './Gantt';
import { CellPickerModal } from './Warehouse';
import CostingModal from './CostingModal';
import MasterPayModal from './MasterPayModal';
import Icon from './Icon';
import DateTimeField from './DateTimeField';
import PhotoViewer from './PhotoViewer';

const FMT = 'YYYY-MM-DDTHH:mm';
const PREVIEW_HOUR_WIDTH = 16;
const fmtMoney = (n) => `${(Number(n) || 0).toLocaleString('ru-RU')} ₽`;

// Детали «под оригинал» (Б/У или аналог, ставящиеся вместо оригинала) требуют
// отдельного внимания — их надо подготовить к должному (товарному) виду перед
// установкой. Карточка авто подсвечивает такие детали (см. origPrepParts ниже).
const ORIG_PREP_KINDS = { used_orig: 'Б/У под ориг.', analog_orig: 'Аналог под ориг.' };
// Ярлык вида запчасти для списка в карточке (кроме «Новое» — его не помечаем).
const KIND_BADGES = { used: 'Б/У', used_orig: 'Б/У под ориг.', analog: 'Замена', analog_orig: 'Аналог под ориг.' };

// Разделы карточки — второй ряд вкладок (под вкладками убытков). Группируют секции
// тела, чтобы всё не сыпалось одним длинным скроллом. Шапка и футер закреплены и
// видны на всех разделах; полоса вкладок убытков (cc-claims) — отдельный ВЕРХНИЙ
// ряд (сначала выбираешь дело, потом раздел). В create разделов меньше: фото и
// журнал требуют сохранённой машины, поэтому их там нет.
const TABS_EDIT = [
  { id: 'overview', label: 'Обзор' },
  { id: 'works', label: 'Работы и запчасти' },
  { id: 'route', label: 'Маршрут' },
  { id: 'money', label: 'Деньги и страховая' },
  { id: 'photos', label: 'Фото' },
  { id: 'journal', label: 'Журнал' },
];
const TABS_CREATE = [
  { id: 'overview', label: 'Обзор' },
  { id: 'works', label: 'Работы и запчасти' },
  { id: 'route', label: 'Маршрут' },
  { id: 'money', label: 'Оплата' },
];

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

// Seed the editable «info» form from the job. Extracted so the initial mount AND
// the live re-sync effect (see below) produce an identical shape — an external
// update to the car (e.g. «Обновить карточку машины» из документа, or another
// device) then flows into the открытую карточку without a reopen.
function formFromJob(job) {
  return {
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
    policy_type: job?.policy_type || '',
    franchise: job?.franchise || '',
  };
}
// Клиентские допродажи (payer:'client') — редактируемая копия для карточки.
function clientServicesFromJob(job) {
  return (job?.services || []).filter((s) => s.payer === 'client')
    .map((s) => ({ id: s.id || genPartId(), name: s.name || '', qty: s.qty ?? 1, price: s.price ?? 0 }));
}
function clientPartsFromJob(job) {
  return (job?.parts || []).filter((p) => p.payer === 'client')
    .map((p) => ({ id: p.id || genPartId(), code: p.code || '', name: p.name || '', qty: p.qty ?? 1, unit: p.unit || 'шт.', price: p.price ?? 0 }));
}

/**
 * One screen for both adding a car (mode="create") and viewing/editing a car
 * (mode="edit"). Same layout, same route editor — the only differences are the
 * header, the footer actions and whether stage edits hit the API immediately.
 */
export default function CarCard({
  mode, job, posts, masters, now, onClose, isOwner = false,
  onCreate,                                   // create
  onSaveInfo, onAddStage, onUpdateStage, onRemoveStage, onOpenDocs, onFinalize, onRemove, onReturnToApproval, // edit
}) {
  const isEdit = mode === 'edit';
  const tabs = isEdit ? TABS_EDIT : TABS_CREATE;
  const [activeTab, setActiveTab] = useState('overview');
  // «Обзор» — это сводка (чтение). Формы карточки открываются кнопкой «Редактировать».
  const [ovEdit, setOvEdit] = useState(false);

  const [form, setForm] = useState(() => formFromJob(job));
  const [stages, setStages] = useState(() => seedStages(job));
  const [editIdx, setEditIdx] = useState(null);
  const [dirtyInfo, setDirtyInfo] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [busyStage, setBusyStage] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [costingOpen, setCostingOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
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

  // Допродажи клиента: доп. работы/запчасти, которые клиент оплачивает сам (отдельным
  // документом от того, что уходит в страховую). Живут в тех же job.services/job.parts,
  // что и страховые позиции, но помечены payer:'client'. Здесь — редактируемая копия
  // ТОЛЬКО клиентских позиций; страховые остаются как есть. Сидируется один раз.
  const [extraServices, setExtraServices] = useState(() => clientServicesFromJob(job));
  const [extraParts, setExtraParts] = useState(() => clientPartsFromJob(job));

  // ===== Убытки (страховые дела) =====
  // По одной машине страховая может завести несколько дел. Вкладка = поток биллинга:
  // «Убыток 1» | «Убыток 2» | «Допродажи клиента» (допродажи — ТАКАЯ ЖЕ вкладка, а не
  // секция вне вкладок: полоса вкладок означает «всё ниже относится к активной», и
  // секция, которая этому не подчиняется, — ловушка для приёмщика).
  // Поля активного дела (страховая/№ убытка/полис/франшиза) живут в том же `form` —
  // при переключении вкладки пере-сидируются из выбранного убытка.
  const [activeStreamRaw, setActiveStream] = useState(() => defaultStream(job));
  const [claimBusy, setClaimBusy] = useState(false);
  // Убытки держим в ЛОКАЛЬНОМ состоянии (как stages/photos/extraParts): `job` в
  // карточке НЕ живой — Gantt хранит detailJob отдельным useState и обновляет его
  // вручную через refreshDetailJob. Без локальной копии заведённый убыток не появился
  // бы на экране до переоткрытия карточки. Пере-сидируется из job при внешней правке
  // (см. jobSyncSig) и обновляется возвратом api.jobs.addClaim/removeClaim.
  const [claims, setClaims] = useState(() => claimsOf(job || {}));
  const isInsCarForm = isInsurance(form);
  const streams = useMemo(
    () => streamsOf({ payment_type: form.payment_type, claims }),
    [form.payment_type, claims],
  );
  // Активный поток ВЫЧИСЛЯЕМ при рендере, а не синхронизируем эффектом: выбранная
  // вкладка может перестать существовать (машину перевели из страховой в наличные;
  // убыток удалили с другого устройства), и эффект чинил бы это лишним рендером —
  // с мигающей пустотой в кадре между ними.
  const activeStream = !isInsCarForm
    ? STREAM_ALL
    : (activeStreamRaw === STREAM_ALL || (activeStreamRaw !== STREAM_CLIENT && !claims.some((c) => c.id === activeStreamRaw))
      ? STREAM_INSURANCE
      : activeStreamRaw);
  // Активная вкладка = допродажи? Тогда страховой блок и списки дела не показываем.
  const onExtrasTab = isInsCarForm && activeStream === STREAM_CLIENT;
  const activeClaimIdx = claims.findIndex((c) => c.id === activeStream);
  const activeClaim = onExtrasTab ? null : (claims[activeClaimIdx] || claims[0] || null);

  function addExtraService() { setExtraServices((a) => [...a, { id: genPartId(), name: '', qty: 1, price: 0 }]); setDirtyInfo(true); }
  function updateExtraService(id, f) { setExtraServices((a) => a.map((s) => (s.id === id ? { ...s, ...f } : s))); setDirtyInfo(true); }
  function removeExtraService(id) { setExtraServices((a) => a.filter((s) => s.id !== id)); setDirtyInfo(true); }
  function addExtraPart() { setExtraParts((a) => [...a, { id: genPartId(), code: '', name: '', qty: 1, unit: 'шт.', price: 0 }]); setDirtyInfo(true); }
  function updateExtraPart(id, f) { setExtraParts((a) => a.map((p) => (p.id === id ? { ...p, ...f } : p))); setDirtyInfo(true); }
  function removeExtraPart(id) { setExtraParts((a) => a.filter((p) => p.id !== id)); setDirtyInfo(true); }
  const extraServicesSum = extraServices.reduce((a, s) => a + (Number(s.price) || 0) * (Number(s.qty) || 1), 0);
  const extraPartsSum = extraParts.reduce((a, p) => a + (Number(p.price) || 0) * (Number(p.qty) || 1), 0);

  // Запчасти НОВОЙ машины (режим создания): редактируемая таблица. Пополняется из
  // импорта Audatex (см. handleAudatexUpload) и/или вручную, редактируется до
  // сохранения. При «Добавить автомобиль» уходит в job.parts — оттуда попадает на
  // экран «Запчасти» для закупки. У каждой позиции стабильный id (genPartId), как
  // того требует экран «Запчасти» (иначе правка/удаление там молча ломаются).
  const [createParts, setCreateParts] = useState([]);
  // Audatex распознал лакокрасочные материалы → у новой машины сразу заводим блок
  // «Подготовка краски» (внутренний учёт себестоимости краски). См. импорт ниже.
  const [createPaint, setCreatePaint] = useState(false);
  function addCreatePart() { setCreateParts((a) => [...a, { id: genPartId(), code: '', name: '', qty: 1, unit: 'шт.', price: 0 }]); setDirtyInfo(true); }
  function updateCreatePart(id, f) { setCreateParts((a) => a.map((p) => (p.id === id ? { ...p, ...f } : p))); setDirtyInfo(true); }
  function removeCreatePart(id) { setCreateParts((a) => a.filter((p) => p.id !== id)); setDirtyInfo(true); }

  // Услуги НОВОЙ машины (режим создания): ручной ввод работ, симметрично запчастям.
  // Импорт Audatex наполняет отдельный блок «Распознанные работы» выше; здесь —
  // работы, добавленные руками. При «Добавить автомобиль» обе группы уходят в
  // job.services (см. submitCreate). id держим только для React-ключей.
  const [createServices, setCreateServices] = useState([]);
  function addCreateService() { setCreateServices((a) => [...a, { id: genPartId(), name: '', qty: 1, price: 0 }]); setDirtyInfo(true); }
  function updateCreateService(id, f) { setCreateServices((a) => a.map((s) => (s.id === id ? { ...s, ...f } : s))); setDirtyInfo(true); }
  function removeCreateService(id) { setCreateServices((a) => a.filter((s) => s.id !== id)); setDirtyInfo(true); }

  // Photos of the car (edit mode only — need a saved job id to attach files to).
  // Split into two zones by `category`: 'before' (до ремонта) / 'after' (после).
  const [photos, setPhotos] = useState(() => job?.photos || []);
  const [uploadingCat, setUploadingCat] = useState(null); // 'before' | 'after' | null
  const [photoErr, setPhotoErr] = useState('');
  const [photoErrCat, setPhotoErrCat] = useState(null); // под какой зоной показать ошибку
  const [photoProgress, setPhotoProgress] = useState(0); // 0..100 during upload
  const [viewer, setViewer] = useState(null); // фото, открытое на весь экран (объект), или null

  // Фото приёмки запчастей (category:'receiving' + partId) — отдельная галерея на
  // карточке: управленец видит, что реально привезли, по каждой позиции. Читаем из
  // того же `photos`-стейта, что и зоны «до/после», чтобы удаление было согласованным.
  const partNameById = useMemo(() => {
    const m = {};
    for (const p of (job?.parts || [])) m[p.id] = p.name || '—';
    return m;
  }, [job?.parts]);
  const receivingByPart = useMemo(() => {
    const groups = {};
    for (const p of photos) {
      if ((p.category || '') !== 'receiving') continue;
      const key = p.partId || '_none';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return groups;
  }, [photos]);

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

  // Live re-sync of the info form + допродажи when the job changes underneath us
  // (an external update — «Обновить карточку машины» из документа, правка с другого
  // устройства, синхронизация запчастей). Без этого form/extraServices/extraParts
  // сидируются один раз и открытая карточка не показывает изменений («не вижу
  // изменений в карточке авто»). Пропускаем, пока есть НЕсохранённые правки
  // (dirtyInfo) — любое ручное изменение выставляет dirtyInfo, поэтому черновые
  // строки допродаж не затираются; при dirtyInfo=false несохранённого нет.
  const jobSyncSig = JSON.stringify([
    job?.car_model, job?.plate_number, job?.vin, job?.mileage, job?.color,
    job?.client_name, job?.client_phone, job?.order_number, job?.cell_ids, job?.cell_id,
    job?.expected_at, job?.deadline, job?.notes, job?.payment_type,
    job?.insurer_id, job?.insurer_name, job?.claim_number, job?.policy_type, job?.franchise,
    // 'claims' ОБЯЗАТЕЛЕН в подписи: без него карточка не увидит правку убытка с
    // другого устройства — ровно тот баг «не вижу изменений в карточке авто».
    job?.claims,
    job?.services, job?.parts,
  ]);
  useEffect(() => {
    if (!isEdit || dirtyInfo) return;
    setForm(formFromJob(job)); // eslint-disable-line react-hooks/set-state-in-effect
    setExtraServices(clientServicesFromJob(job));
    setExtraParts(clientPartsFromJob(job));
    // Убытки — из job; поля формы для АКТИВНОЙ вкладки пере-сидируем из её дела,
    // иначе formFromJob (он читает плоские поля = убыток №1) показал бы реквизиты
    // первого дела, пока открыта вкладка второго.
    const next = claimsOf(job || {});
    setClaims(next);
    const cur = next.find((c) => c.id === activeStream);
    if (cur) {
      setForm((f) => ({
        ...f,
        insurer_id: cur.insurer_id || '', insurer_name: cur.insurer_name || '',
        claim_number: cur.claim_number || '', policy_type: cur.policy_type || '',
        franchise: cur.franchise ?? '',
      }));
    }
  }, [jobSyncSig]); // eslint-disable-line react-hooks/exhaustive-deps

  function patchForm(patch) {
    setForm((f) => ({ ...f, ...patch }));
    setDirtyInfo(true);
  }

  // Переключение вкладки убытка. Правки СНАЧАЛА сохраняем — тем же приёмом, что и
  // flushOpenRow для этапов маршрута. Иначе несохранённые реквизиты одного дела
  // «перетекли» бы в другое: эффект jobSyncSig пере-сидирует форму только при
  // !dirtyInfo, а любой patchForm ставит dirtyInfo=true.
  // Трюк с key/remount (как в DocumentsModal) здесь НЕ подходит: карточка держит фото
  // и маршрут — remount их убьёт.
  async function switchStream(id) {
    if (id === activeStream || claimBusy) return;
    if (isEdit && dirtyInfo) {
      if (!window.confirm('Есть несохранённые правки по этому убытку. Сохранить и переключиться?')) return;
      await saveInfo();
    }
    setActiveStream(id);
    // Пере-сидируем поля дела из выбранного убытка. Для допродаж страховой блок не
    // показывается вовсе, поэтому там сидировать нечего.
    if (id !== STREAM_CLIENT) {
      const c = claims.find((x) => x.id === id) || {};
      setForm((f) => ({
        ...f,
        insurer_id: c.insurer_id || '',
        insurer_name: c.insurer_name || '',
        claim_number: c.claim_number || '',
        policy_type: c.policy_type || '',
        franchise: c.franchise ?? '',
      }));
    }
    setDirtyInfo(false);
  }

  // «+ Ещё убыток»: страховая завела по этой машине второе дело. Новое дело получает
  // СВОЙ номер заказ-наряда из годовой очереди (страховая заводит дело по номеру ЗН,
  // поэтому два дела с одним номером недопустимы) — его выдаёт api.jobs.addClaim.
  async function addClaim() {
    const jobId = job?.id || job?.job_id;
    if (!jobId || claimBusy) return;
    if (isEdit && dirtyInfo) {
      if (!window.confirm('Есть несохранённые правки. Сохранить и завести новый убыток?')) return;
      await saveInfo();
    }
    setClaimBusy(true);
    try {
      // Страховую наследуем от убытка №1 — по одной машине дела почти всегда ведёт
      // одна компания; при необходимости она меняется прямо в реквизитах дела.
      const first = claims[0] || {};
      const created = await api.jobs.addClaim(jobId, {
        insurer_id: first.insurer_id || '',
        insurer_name: first.insurer_name || '',
      });
      const next = created?.claims || [];
      const fresh = next[next.length - 1];
      setClaims(next);
      if (fresh) {
        setActiveStream(fresh.id);
        setForm((f) => ({
          ...f,
          insurer_id: fresh.insurer_id || '', insurer_name: fresh.insurer_name || '',
          claim_number: '', policy_type: '', franchise: '',
        }));
        setDirtyInfo(false);
      }
    } catch (e) {
      alert('Не удалось завести убыток: ' + (e?.message || e));
    } finally {
      setClaimBusy(false);
    }
  }

  // Удаление дела. Позиции переезжают в убыток №1 (api.jobs.removeClaim меняет только
  // метку, сохраняя id/закупку/историю приёмки) — иначе они осиротели бы.
  async function removeClaim(id) {
    const jobId = job?.id || job?.job_id;
    if (!jobId || id === STREAM_INSURANCE || claimBusy) return;
    const n = claims.findIndex((x) => x.id === id);
    if (n < 0) return;
    if (!window.confirm(`Удалить «${claimLabel(claims[n], n)}»? Его работы и запчасти вернутся в Убыток 1 — ничего не потеряется, но раскладку по делам придётся делать заново.`)) return;
    setClaimBusy(true);
    try {
      const synced = await api.jobs.removeClaim(jobId, id);
      const next = claimsOf(synced || {});
      setClaims(next);
      // Возвращаемся на убыток №1 БЕЗ switchStream: его правки уже неактуальны (дело
      // удалено), и предлагать «сохранить перед переключением» было бы бессмыслицей.
      const first = next[0] || {};
      setActiveStream(STREAM_INSURANCE);
      setForm((f) => ({
        ...f,
        insurer_id: first.insurer_id || '', insurer_name: first.insurer_name || '',
        claim_number: first.claim_number || '', policy_type: first.policy_type || '',
        franchise: first.franchise ?? '',
      }));
      setDirtyInfo(false);
    } catch (e) {
      alert('Не удалось удалить убыток: ' + (e?.message || e));
    } finally {
      setClaimBusy(false);
    }
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
        discount: Number(data.meta?.discount) || 0,
      });
      // Распознанные запчасти кладём в редактируемую таблицу (дополняя уже добавленные
      // вручную) — их можно поправить/дополнить до сохранения машины.
      if (data.parts.length) {
        setCreateParts((cur) => [
          ...cur,
          ...data.parts.map((p) => ({ id: genPartId(), code: p.code || '', name: p.name || '', qty: Number(p.qty) || 1, unit: p.unit || 'шт.', price: Number(p.price) || 0 })),
        ]);
      }
      // Калькуляция содержит лакокрасочные материалы → машину красят: заводим блок
      // «Подготовка краски» у новой машины (строка ЛКМ при этом остаётся в запчастях).
      if (data.meta?.hasPaint) setCreatePaint(true);
      const bits = [];
      if (v.car_model) bits.push(v.car_model);
      bits.push(`работ: ${data.services.length}`);
      bits.push(`запчастей: ${data.parts.length}`);
      if (data.meta?.hasPaint) bits.push('краска: да');
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

  // Add one or several photos: each is compressed on the phone, uploaded to the
  // server, then its record is appended to job.photos. Sequential (not parallel)
  // so the progress bar reflects one clear upload at a time on weak mobile links.
  async function handlePhotoAdd(e, category) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const jobId = job?.id || job?.job_id;
    if (!files.length || !isEdit || !jobId) return;
    setPhotoErr('');
    setPhotoErrCat(null);
    setUploadingCat(category);
    try {
      for (const file of files) {
        setPhotoProgress(0);
        const up = await uploadPhoto(jobId, file, setPhotoProgress);
        const photo = {
          id: crypto.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
          category, // 'before' | 'after' — в какой зоне показывать
          url: up.url,
          path: up.path,
          size: up.size || 0,
          w: up.w || 0,
          h: up.h || 0,
          uploaded_at: Date.now(),
          uploaded_by: auth.currentUser?.email || null,
        };
        await api.jobs.addPhoto(jobId, photo);
        setPhotos((prev) => [...prev, photo]);
      }
    } catch (err) {
      console.error('Ошибка загрузки фото:', err);
      setPhotoErr(err?.message || 'Не удалось загрузить фото');
      setPhotoErrCat(category);
    } finally {
      setUploadingCat(null);
      setPhotoProgress(0);
    }
  }

  async function handlePhotoDelete(photo) {
    const jobId = job?.id || job?.job_id;
    if (!jobId || !window.confirm('Удалить это фото?')) return;
    setPhotoErr('');
    try {
      await api.jobs.removePhoto(jobId, photo.id);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      deletePhotoFile(photo.path).catch(() => {}); // file cleanup is best-effort
    } catch (err) {
      console.error('Ошибка удаления фото:', err);
      setPhotoErr('Не удалось удалить фото');
    }
  }

  // Одна зона фотографий (до / после). Старые снимки без category считаем «до».
  function renderPhotoZone(category, icon, title, hint) {
    const list = photos.filter((p) => (p.category || 'before') === category);
    const busy = uploadingCat === category;
    return (
      <section className="cc-section">
        <div className="cc-section-head"><span className="cc-section-icon">{icon}</span>{title}</div>
        <div className="cc-photos">
          {list.map((p) => (
            <div className="cc-photo" key={p.id}>
              <img src={p.url} alt={title} loading="lazy" onClick={() => setViewer(p)} />
              <button
                type="button"
                className="cc-photo-del"
                onClick={() => handlePhotoDelete(p)}
                aria-label="Удалить фото"
              >
                <Icon name="trash" size={14} strokeWidth={2} />
              </button>
            </div>
          ))}
          <label className={`cc-photo-add${busy ? ' is-busy' : ''}`}>
            {busy ? (
              <span className="cc-photo-progress">{photoProgress ? `${photoProgress}%` : '…'}</span>
            ) : (
              <><Icon name="camera" size={22} /><span>Добавить</span></>
            )}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => handlePhotoAdd(e, category)}
              disabled={uploadingCat != null}
              hidden
            />
          </label>
        </div>
        {photoErrCat === category && photoErr && <div className="cc-audatex-err">{photoErr}</div>}
        {!list.length && !busy && <div className="cc-hint">{hint}</div>}
      </section>
    );
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
  async function openPay() { await flushOpenRow(); setPayOpen(true); }
  async function finalize() { await flushOpenRow(); onFinalize(); }
  async function returnToApproval() {
    if (!window.confirm('Вернуть машину на согласование со страховой? Она уедет с графика на доску «Согласование».')) return;
    await onReturnToApproval();
  }

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
      const jobId = job?.id || job?.job_id;
      const insCar = isInsurance(form);
      // Работы: страховые (без изменений) + допродажи клиента (payer:'client').
      // Карточка — единственный, кто пишет job.services после создания, поэтому
      // массив можно отдавать целиком. Пустые строки допродаж отбрасываем.
      // `payer !== 'client'` оставляет нетронутыми позиции ВСЕХ убытков (и №1, и
      // 'cl_*'), а не только первого — перезапись массива их не теряет.
      const insuranceServices = (job?.services || []).filter((s) => s.payer !== 'client');
      const cleanExtraServices = extraServices
        .filter((s) => String(s.name || '').trim())
        .map((s) => ({ id: s.id, name: s.name.trim(), qty: Number(s.qty) || 1, price: Number(s.price) || 0, payer: 'client' }));
      const mergedServices = [...insuranceServices, ...cleanExtraServices];

      // Реквизиты дела. Убыток №1 едет плоскими полями — api.jobs.update зеркало-
      // осознан и сам дописывает их в claims[0], поэтому источник правды один.
      // Убытки 2..N — только через saveClaim (мерж по id: двое правят разные дела
      // одной машины и не затирают друг друга).
      const claimFields = {
        insurer_id: form.insurer_id,
        insurer_name: form.insurer_name,
        claim_number: form.claim_number,
        policy_type: form.policy_type,
        franchise: Number(form.franchise) || null,
      };
      // Открыт НЕ убыток №1 → плоские страховые поля из payload вырезаем. Это верно и
      // для вкладки «Допродажи»: страховой блок там скрыт, но `form` всё ещё держит
      // реквизиты дела, с которого ушли, — сохранение затёрло бы ими зеркало убытка №1.
      const stripClaimFields = isEdit && insCar && activeStream !== STREAM_INSURANCE && activeStream !== STREAM_ALL;
      const editingSecondaryClaim = stripClaimFields && !onExtrasTab;
      if (editingSecondaryClaim) {
        const synced = await api.jobs.saveClaim(jobId, { id: activeStream, ...claimFields });
        setClaims(claimsOf(synced || {}));
      }

      await onSaveInfo({
        ...form,
        ...(stripClaimFields
          ? { insurer_id: undefined, insurer_name: undefined, claim_number: undefined, policy_type: undefined, franchise: undefined }
          : { franchise: Number(form.franchise) || null }),
        expected_at: form.expected_at ? dayjs(form.expected_at).toISOString() : null,
        deadline: form.deadline ? dayjs(form.deadline).toISOString() : null,
        ...(insCar ? { services: mergedServices } : {}),
      });

      // Допродажные запчасти — пооперационно (транзакция + синхронизация склада),
      // чтобы не затирать правки страховых запчастей с экрана «Запчасти». Для уже
      // существующих позиций сохраняем поверх оригинала (сохраняем закупку/статус).
      if (insCar && jobId) {
        const origById = new Map((job?.parts || []).map((p) => [p.id, p]));
        const persistedClientIds = (job?.parts || []).filter((p) => p.payer === 'client' && p.id).map((p) => p.id);
        const keep = new Set(extraParts.map((p) => p.id));
        for (const id of persistedClientIds) if (!keep.has(id)) {
          await api.jobs.removePart(jobId, id);
          // removePart заодно удаляет фото приёмки этой позиции (Этап 2). Подчищаем
          // локальный `photos`, иначе галерея «Фото приёмки» показывала бы фантом
          // (битую картинку / «Деталь удалена») до переоткрытия карточки.
          setPhotos((prev) => prev.filter((ph) => !(ph.category === 'receiving' && ph.partId === id)));
        }
        for (const p of extraParts) {
          if (!String(p.name || '').trim() && !String(p.code || '').trim()) continue; // пустую строку не пишем
          const orig = origById.get(p.id) || {};
          await api.jobs.savePart(jobId, {
            ...orig, id: p.id, code: (p.code || '').trim(), name: (p.name || '').trim(),
            qty: Number(p.qty) || 1, unit: p.unit || 'шт.', price: Number(p.price) || 0, payer: 'client',
          });
        }
      }
      setDirtyInfo(false);
    } finally {
      setSavingInfo(false);
    }
  }

  async function submitCreate() {
    if (!form.car_model.trim()) { alert('Укажите марку и модель автомобиля'); return; }
    // Страховая машина заводится сразу на «Согласование»; наличные/юрлицо — в ремонт.
    const toApproval = isInsurance(form);
    // Запчасти (импорт Audatex и/или добавленные вручную): убираем пустые строки,
    // нормализуем числа, сохраняем стабильный id каждой позиции.
    const cleanCreateParts = createParts
      .map((p) => ({ id: p.id, code: (p.code || '').trim(), name: (p.name || '').trim(), qty: Number(p.qty) || 1, unit: p.unit || 'шт.', price: Number(p.price) || 0 }))
      .filter((p) => p.name || p.code);
    // Услуги новой машины: распознанные Audatex (imported.services) + добавленные
    // вручную. Уходят в job.services без payer — как основной поток работ (страховая
    // машина: payer!=='client'; наличные/юрлицо: recipient 'all'). Пустые отбрасываем.
    const cleanCreateServices = createServices
      .map((s) => ({ name: (s.name || '').trim(), qty: Number(s.qty) || 1, price: Number(s.price) || 0 }))
      .filter((s) => s.name);
    const mergedCreateServices = [...((imported && imported.services) || []), ...cleanCreateServices];
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
        phase: toApproval ? PHASE.APPROVAL : PHASE.REPAIR,
        approval_status: toApproval ? DEFAULT_APPROVAL_STATUS : undefined,
        approval_since: toApproval ? Date.now() : undefined,
        insurer_id: form.insurer_id,
        insurer_name: form.insurer_name,
        claim_number: form.claim_number,
        policy_type: form.policy_type,
        franchise: Number(form.franchise) || null,
        expected_at: form.expected_at ? dayjs(form.expected_at).toISOString() : null,
        deadline: form.deadline ? dayjs(form.deadline).toISOString() : null,
        // Работы: распознанные Audatex + добавленные вручную (см. mergedCreateServices).
        ...(mergedCreateServices.length ? { services: mergedCreateServices } : {}),
        ...(imported && imported.discount ? { discount: imported.discount } : {}),
        // Запчасти: импорт Audatex и/или добавленные вручную в таблице ниже. Уходят в
        // job.parts (с id) → заказ-наряд, ячейка склада и экран «Запчасти» автозаполняются.
        ...(cleanCreateParts.length ? { parts: cleanCreateParts } : {}),
        // Краска (Audatex распознал ЛКМ): пустой блок «Подготовка краски» под себестоимость.
        ...(createPaint ? { paint: { status: 'need', cost: 0 } } : {}),
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
  const partsSum = createParts.reduce((a, p) => a + (Number(p.price) || 0) * (Number(p.qty) || 1), 0);
  const createServicesSum = createServices.reduce((a, s) => a + (Number(s.price) || 0) * (Number(s.qty) || 1), 0);

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

  // ОСАГО: срок восстановительного ремонта по закону — не более 30 рабочих дней.
  // Отсчёт от заезда (а если он не заполнен — от даты создания заказ-наряда, т.е.
  // машина уже на СТОА) до дедлайна. Если по плану выходит больше — предупреждаем:
  // просрочка грозит неустойкой 0,5%/день от стоимости ремонта. Считаем «вживую»,
  // чтобы предупреждение появлялось сразу при выборе ОСАГО или правке дат.
  const osagoStart = form.expected_at || (isEdit ? job?.created_at : null);
  const osagoTermWorkdays = useMemo(() => {
    if (!(isInsurance(form) && form.policy_type === 'osago')) return 0;
    if (!osagoStart || !form.deadline) return 0;
    const wd = workdaysBetween(osagoStart, form.deadline);
    return wd > OSAGO_MAX_REPAIR_WORKDAYS ? wd : 0;
  }, [form.payment_type, form.policy_type, osagoStart, form.deadline]);

  // Read-only summaries + a derived event journal (edit mode). Works/parts are the
  // ones saved on the job; the journal is synthesised from the route (we don't store
  // per-event timestamps) so its times are the stages' scheduled ones.
  const works = isEdit ? (job?.services || []) : [];
  const jobParts = isEdit ? (job?.parts || []) : [];
  // Страховая машина показывает работы/запчасти ПО АКТИВНОМУ УБЫТКУ (вкладка сверху),
  // а допродажи клиента — своей вкладкой (редактируемый блок ниже). Раньше здесь был
  // фильтр «всё, что не client», то есть один общий список; с несколькими делами он
  // смешал бы их в кучу — а приёмщик должен видеть ровно то дело, что открыто.
  const isInsCar = isEdit && isInsurance(form);
  const insWorks = isInsCar ? itemsForStream(works, activeStream) : works;
  const insParts = isInsCar ? itemsForStream(jobParts, activeStream) : jobParts;
  // Предупреждения по видам запчастей (см. блок ниже). Три категории:
  //  • Б/У и Замена — нужно согласие клиента; оно попадает в заказ-наряд и акт
  //    (блок «Согласование по запчастям», см. orderDoc.buildPartsConsentText).
  //  • «под оригинал» (Б/У/аналог под ориг.) — в документы НЕ идёт, но деталь
  //    надо подготовить к товарному виду перед установкой.
  const origPrepParts = jobParts.filter((p) => ORIG_PREP_KINDS[p.kind]);
  const usedParts = jobParts.filter((p) => p.kind === 'used');
  const analogParts = jobParts.filter((p) => p.kind === 'analog');
  const names = (arr) => arr.map((p) => p.name || '—').join(', ');
  const partNotices = [];
  if (usedParts.length) partNotices.push({
    key: 'used', icon: 'history', tag: 'Б/У',
    title: 'Б/У запчасти — нужно согласие клиента',
    names: names(usedParts), parts: usedParts,
    text: `В заказ-наряд и акт добавлена отметка о согласии клиента на установку Б/У: ${names(usedParts)}.`,
  });
  if (analogParts.length) partNotices.push({
    key: 'analog', icon: 'refresh', tag: 'Аналог',
    title: 'Замена на аналог — нужно согласие клиента',
    names: names(analogParts), parts: analogParts,
    text: `В заказ-наряд и акт добавлена отметка о замене оригинала на аналог с согласия клиента: ${names(analogParts)}.`,
  });
  if (origPrepParts.length) partNotices.push({
    key: 'orig', icon: 'wrench', tag: 'Под ориг.',
    title: 'Детали «под оригинал» — требуют отдельного внимания',
    names: names(origPrepParts), parts: origPrepParts,
    text: `Подготовьте к должному (товарному) виду перед установкой: ${names(origPrepParts)}.`,
  });
  // ── Сводка вкладки «Обзор» (режим чтения) ────────────────────────────────
  // Полоса «Требуют внимания» показывает согласия по ВСЕЙ машине, а не только по
  // открытому убытку: приёмщик должен видеть их всегда, на какой бы вкладке ни
  // стоял. Чтобы не гадать, откуда взялась чужая деталь, у каждой пишем её дело.
  // На машине с одним убытком и без допродаж подпись не нужна — она была бы
  // одинаковой у всех (то же правило, что у заголовка «Оплата и страховая»).
  const showPartClaim = isInsCar
    && (claims.length > 1 || jobParts.some((p) => streamOf(p) === STREAM_CLIENT));
  const partClaimLabel = (p) => {
    if (!showPartClaim) return '';
    const sid = streamOf(p);
    if (sid === STREAM_CLIENT) return 'Допродажи';
    const i = claims.findIndex((c) => c.id === sid);
    return i >= 0 ? `Убыток ${i + 1}` : '';
  };
  // Плоский список «деталь → вид → дело» для полосы внимания.
  const noticeParts = partNotices.flatMap((n) => n.parts.map((p) => {
    const cl = partClaimLabel(p);
    return { key: `${n.key}-${p.id}`, text: `${p.name || '—'} (${cl ? `${n.tag} · ${cl}` : n.tag})` };
  }));
  // Всё считается по АКТИВНОМУ убытку (insParts), поэтому при переключении
  // вкладки убытка сводка пересчитывается сама.
  // Запчасти, ждущие действий, по приоритету статуса — показываем до 4 шт.
  const partsWaiting = [...insParts]
    .filter((p) => ['need', 'invoiced', 'ordered', 'arrived'].includes(p.status || 'need'))
    .sort((a, b) => psMeta(a.status).pr - psMeta(b.status).pr)
    .slice(0, 4);
  // Разбивка по статусам — сегменты полоски прогресса (только непустые).
  const partCounts = partStatusMeta
    .map((s) => ({ ...s, n: insParts.filter((p) => (p.status || 'need') === s.id).length }))
    .filter((s) => s.n > 0);
  // Ответственный этап маршрута → пост/мастер в шапке сводки.
  const activeStage = routeSet.find((s) => effectiveStatus(s, now) === 'in_progress')
    || routeSet.find((s) => effectiveStatus(s, now) !== 'done');
  const activePost = activeStage ? posts.find((p) => p.id === activeStage.post_id) : null;
  const activeMaster = activeStage ? masters.find((m) => m.id === activeStage.master_id) : null;
  // Календарных дней до дедлайна (отрицательное — просрочен).
  const daysLeft = form.deadline
    ? dayjs(form.deadline).startOf('day').diff(dayjs(now).startOf('day'), 'day')
    : null;
  // Суммы страхового ремонта (без допродаж) — идут в оценку неустойки по ОСАГО и в
  // подпись «Итого работ» страхового блока.
  const worksSum = insWorks.reduce((a, s) => a + (Number(s.price) || 0) * (Number(s.qty) || 1), 0);
  const jobPartsSum = insParts.reduce((a, p) => a + (Number(p.price) || 0) * (Number(p.qty) || 1), 0);
  // Ориентировочная неустойка по ОСАГО за просрочку ремонта: 0,5% в день от суммы
  // возмещения за каждый календарный день сверх законного срока (но не более самой
  // суммы возмещения). База возмещения: счёт → работы+запчасти → распознанная смета.
  const osagoPenalty = useMemo(() => {
    if (!osagoTermWorkdays || !osagoStart || !form.deadline) return null;
    const legal = addWorkdays(osagoStart, OSAGO_MAX_REPAIR_WORKDAYS);
    const d = new Date(form.deadline);
    const overrunDays = Math.max(1, Math.round(
      (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
        - Date.UTC(legal.getFullYear(), legal.getMonth(), legal.getDate())) / 86400000,
    ));
    const worksParts = worksSum + jobPartsSum;
    const estimate = svcSum + createServicesSum + partsSum;
    const [base, baseLabel] = hasInvoice ? [invAmount, 'счёта']
      : worksParts > 0 ? [worksParts, 'работ и запчастей']
        : estimate > 0 ? [estimate, 'сметы']
          : [0, ''];
    const amount = base ? Math.round(Math.min(base, base * OSAGO_PENALTY_PER_DAY * overrunDays)) : 0;
    return { overrunDays, base, baseLabel, amount };
  }, [osagoTermWorkdays, osagoStart, form.deadline, hasInvoice, invAmount, worksSum, jobPartsSum, svcSum, createServicesSum, partsSum]);
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
            {isEdit && hasInvoice && (
              <button
                className={`cc-pay-chip${allPaid ? ' is-paid' : ''}`}
                disabled={payBusy}
                onClick={togglePaid}
                title={allPaid ? 'Счёт оплачен — нажмите, чтобы отменить отметку' : 'Отметить счёт оплаченным'}
              >
                <Icon name={allPaid ? 'check' : 'wallet'} size={13} strokeWidth={allPaid ? 2 : 1.7} />
                <span>{allPaid ? 'Оплачено' : 'Не оплачено'}</span>
                {!allPaid && <span className="cc-pay-chip-amt">· {fmtMoney(invAmount)}</span>}
              </button>
            )}
            {isEdit && !hasInvoice && (
              <button className="cc-pay-chip is-none" onClick={openDocs} title="Счёт ещё не выставлен — оформить в «Документы»">
                <Icon name="file" size={13} />
                <span>Счёт не выставлен</span>
              </button>
            )}
            {isEdit && <span className="cc-status-pill" style={{ '--badge-color': STATUS_COLORS[overall] }}>{STATUS_LABELS[overall]}</span>}
            <button className="cc-close" onClick={closeCard} aria-label="Закрыть"><Icon name="x" size={18} strokeWidth={2} /></button>
          </div>
        </div>

        {/* Полоса убытков. Страховая может завести по одной машине несколько дел —
            у каждого свои реквизиты, свой номер ЗН и свой комплект документов.
            Живёт МЕЖДУ шапкой и телом: тут работает flex-shrink:0, полоса закреплена,
            тело скроллится под ней. Внутрь .cc-cols нельзя — columns:2 разорвёт.
            Только в режиме правки: у новой машины дело всегда одно. */}
        {isEdit && isInsCarForm && (
          <div className="cc-claims">
            {streams.map((s, i) => (
              <button
                key={s.id}
                className={`cc-claim-tab${activeStream === s.id ? ' active' : ''}${s.kind === 'client' ? ' is-extras' : ''}`}
                onClick={() => switchStream(s.id)}
                disabled={claimBusy}
                title={s.kind === 'client'
                  ? 'Работы и запчасти, которые клиент оплачивает сам — общие на машину'
                  : `Страховое дело${s.claim?.order_number ? ' · заказ-наряд ' + s.claim.order_number : ''}`}
              >
                {s.kind === 'client' ? <Icon name="wallet" size={12} /> : <Icon name="shield" size={12} />}
                <span>{s.kind === 'client' ? 'Допродажи клиента' : claimLabel(s.claim, i)}</span>
              </button>
            ))}
            <button className="cc-claim-add" onClick={addClaim} disabled={claimBusy} title="Страховая завела по этой машине ещё одно дело — у него будет свой номер заказ-наряда">
              <Icon name="plus" size={12} />Ещё убыток
            </button>
            {claims.length > 1 && (
              <span className="cc-claims-hint">
                Раздельные по делам: документы, номера ЗН, франшиза. Общие на машину: маршрут, склад, фото, прибыль.
              </span>
            )}
          </div>
        )}

        {/* Разделы карточки — второй ряд вкладок. Закреплён (flex-shrink:0), тело
            скроллится под ним. Секции ниже помечены `activeTab === …` и показываются
            только на своём разделе — содержимое секций не меняется, просто спрятано. */}
        <div className="cc-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={`cc-tab${activeTab === t.id ? ' active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="cc-body">
         <div className="cc-cols" data-tab={activeTab}>
          {/* «Обзор» одним взглядом: статус · ответственный · дедлайн · маршрут,
              затем деньги и запчасти. Правка карточки — по кнопке (ovEdit). */}
          {isEdit && activeTab === 'overview' && !ovEdit && (
            <div className="cc-ov cc-full">

              <div className="cc-ov-hero">
                <div className="cc-ov-hero-top">
                  <div className="cc-ov-status">
                    <span className="cc-ov-dot" style={{ background: STATUS_COLORS[overall] }} />
                    <span className="cc-ov-status-label">{STATUS_LABELS[overall]}</span>
                    {activePost && (
                      <span className="cc-ov-status-sub">· {activePost.name}{activeMaster ? ` · ${activeMaster.name}` : ''}</span>
                    )}
                  </div>
                  {form.deadline && (
                    <div className={`cc-ov-deadline${dlState === 'missed' || dlState === 'at-risk' ? ' is-risk' : ''}`}>
                      <b>{daysLeft <= 0 ? 'просрочен' : `${daysLeft} дн`}</b>
                      <span>до {dayjs(form.deadline).format('DD.MM.YY')}</span>
                    </div>
                  )}
                </div>
                {routeSet.length > 0 && (
                  <div className="cc-ov-route">
                    {routeSet.slice(0, 4).map((s, i) => {
                      const post = posts.find((p) => p.id === s.post_id);
                      const master = masters.find((m) => m.id === s.master_id);
                      const st = effectiveStatus(s, now);
                      return (
                        <div className="cc-ov-route-node" key={s.id || `st-${i}`}>
                          <div className="cc-ov-route-head">
                            <span className={`cc-ov-route-mark is-${st}`} style={{ '--mc': STATUS_COLORS[st] }}>
                              {st === 'done' && <Icon name="check" size={9} strokeWidth={3} />}
                            </span>
                            <span className="cc-ov-route-name">{post?.name || 'Пост'}</span>
                          </div>
                          <span className="cc-ov-route-sub">{master ? master.name : 'не назначен'} · {STATUS_LABELS[st]}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Согласия по запчастям: Б/У, аналог, «под оригинал». */}
              {partNotices.length > 0 && (
                <div className="cc-ov-attention">
                  <span className="cc-ov-attention-ico"><Icon name="warning" size={15} /></span>
                  <span className="cc-ov-attention-title">Требуют внимания</span>
                  {/* Строка длинная и режется многоточием — полный список в title. */}
                  <span className="cc-ov-attention-parts" title={noticeParts.map((n) => n.text).join(' · ')}>
                    {noticeParts.map((n) => n.text).join(' · ')}
                  </span>
                </div>
              )}

              <div className="cc-ov-split">

                <div className="cc-ov-card">
                  <div className="cc-ov-cardhead"><span className="cc-ov-cardbar" />Деньги</div>
                  {hasInvoice ? (
                    <>
                      <div className="cc-ov-money-val">{fmtMoney(invAmount)}</div>
                      <div className="cc-ov-money-state">
                        <span className="cc-ov-dot" style={{ background: allPaid ? STATUS_COLORS.done : 'var(--color-danger)' }} />
                        {allPaid ? 'Оплачено' : 'Не оплачено'}
                        {!onExtrasTab && Number(form.franchise) > 0 ? ` · франшиза ${fmtMoney(form.franchise)}` : ''}
                      </div>
                    </>
                  ) : (
                    <div className="cc-ov-empty">Счёт не выставлен</div>
                  )}
                  {/* На «Допродажах» страховую не показываем — клиент платит их сам,
                      ни полиса, ни № убытка, ни франшизы у них нет (см. блок
                      «Оплата и страховая» ниже — там то же правило). */}
                  {isInsCarForm && !onExtrasTab && form.insurer_name && (
                    <div className="cc-ov-insurer">
                      <Icon name="shield" size={14} />
                      <span className="cc-ov-insurer-name">{form.insurer_name}</span>
                      {(activeClaim?.claim_number || form.claim_number) && (
                        <span className="cc-ov-claimno">{activeClaim?.claim_number || form.claim_number}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="cc-ov-card">
                  <div className="cc-ov-cardhead">
                    <span className="cc-ov-cardbar" />Запчасти
                    <span className="cc-ov-cardmeta">
                      {insParts.length}{form.cell_ids.length ? ` · ${form.cell_ids.join(', ')}` : ''}
                    </span>
                  </div>
                  {insParts.length > 0 ? (
                    <>
                      <div className="cc-ov-bar">
                        {partCounts.map((s) => <span key={s.id} style={{ flex: s.n, background: s.color }} />)}
                      </div>
                      <div className="cc-ov-waiting">
                        {partsWaiting.length > 0 ? partsWaiting.map((p) => (
                          <div className="cc-ov-waiting-row" key={p.id}>
                            <span className="cc-ov-waiting-name">{p.name || '—'}</span>
                            <span className="cc-ov-waiting-status">
                              <span className="cc-ov-dot" style={{ background: psMeta(p.status).color }} />
                              {psMeta(p.status).label}
                            </span>
                          </div>
                        )) : (
                          <div className="cc-ov-empty">Все позиции на складе</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="cc-ov-empty">Запчасти не заведены</div>
                  )}
                </div>
              </div>

              <div className="cc-ov-meta">
                {form.mileage && <span>{form.mileage} км</span>}
                {form.color && <span>{form.color}</span>}
                {form.vin && <span className="cc-ov-vin">VIN {form.vin}</span>}
                <button type="button" className="cc-ov-edit-btn" onClick={() => setOvEdit(true)}>
                  <Icon name="edit" size={12} />Редактировать
                </button>
              </div>
            </div>
          )}
          {!isEdit && activeTab === 'overview' && (
            <div className="cc-audatex cc-full">
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

          {/* Формы «Обзора». В режиме создания карточки они видны всегда (сводки
              ещё нет), в режиме правки — только под кнопкой «Редактировать». */}
          {isEdit && activeTab === 'overview' && ovEdit && (
            <div className="cc-ov-editbar cc-full">
              <span>Правка карточки</span>
              <button type="button" className="cc-ov-done-btn" onClick={() => setOvEdit(false)}>
                <Icon name="check" size={13} strokeWidth={2} />Готово
              </button>
            </div>
          )}

          {activeTab === 'overview' && (!isEdit || ovEdit) && (
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
                <input placeholder="оставьте пустым — присвоится сам" value={form.order_number} onChange={(e) => patchForm({ order_number: e.target.value })} />
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
          )}

          {isEdit && activeTab === 'photos' && renderPhotoZone('before', '📷', 'Фото — до ремонта', 'Снимите машину при приёмке: повреждения, общий вид, VIN.')}
          {isEdit && activeTab === 'photos' && renderPhotoZone('after', '✨', 'Фото — после ремонта', 'Снимите готовую машину перед выдачей клиенту.')}

          {/* Галерея фото приёмки запчастей — только просмотр и удаление; снимают
              их на экране «Приёмка». Показываем секцию, лишь когда фото есть. */}
          {isEdit && activeTab === 'photos' && Object.keys(receivingByPart).length > 0 && (
            <section className="cc-section">
              <div className="cc-section-head"><span className="cc-section-icon">🧾</span>Фото приёмки запчастей</div>
              {Object.entries(receivingByPart)
                .sort((a, b) => String(partNameById[a[0]] || '').localeCompare(String(partNameById[b[0]] || ''), 'ru'))
                .map(([partId, list]) => (
                  <div className="cc-recv-group" key={partId}>
                    <div className="cc-section-subhead">{partNameById[partId] || 'Деталь удалена'}</div>
                    <div className="cc-photos">
                      {list.map((p) => (
                        <div className="cc-photo" key={p.id}>
                          <img src={p.url} alt="Фото приёмки запчасти" loading="lazy" onClick={() => setViewer(p)} />
                          <button
                            type="button"
                            className="cc-photo-del"
                            onClick={() => handlePhotoDelete(p)}
                            aria-label="Удалить фото"
                          >
                            <Icon name="trash" size={14} strokeWidth={2} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </section>
          )}

          {activeTab === 'overview' && (!isEdit || ovEdit) && (
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
            {osagoTermWorkdays > 0 && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger)' }}>
                <span style={{ color: 'var(--color-danger-text)', flexShrink: 0, display: 'inline-flex', marginTop: 1 }}><Icon name="warning" size={16} /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-danger-text)' }}>Превышен срок ремонта по ОСАГО</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3, lineHeight: 1.4 }}>
                    От заезда до дедлайна {osagoTermWorkdays} раб. дн., по закону — не более {OSAGO_MAX_REPAIR_WORKDAYS}{osagoPenalty ? `, просрочка ~${osagoPenalty.overrunDays} дн` : ''}.
                  </div>
                  {osagoPenalty && osagoPenalty.amount > 0 ? (
                    <div style={{ fontSize: 12.5, marginTop: 4, color: 'var(--color-danger-text)' }}>
                      Ориентировочная неустойка: <b>≈ {fmtMoney(osagoPenalty.amount)}</b>
                      <span style={{ color: 'var(--color-text-muted)' }}> — 0,5%/день от суммы {osagoPenalty.baseLabel} ({fmtMoney(osagoPenalty.base)})</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-text-muted)' }}>
                      Неустойка — 0,5%/день от стоимости ремонта; сумма появится, когда будет счёт или смета.
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
          )}

          {/* На вкладке «Допродажи» страховой блок не показываем: допродажи — это то,
              что клиент платит сам, у них нет ни полиса, ни № убытка, ни франшизы. */}
          {activeTab === 'money' && !onExtrasTab && (
          <section className="cc-section">
            <div className="cc-section-head">
              <span className="cc-section-icon">💳</span>
              {claims.length > 1 && activeClaimIdx >= 0 ? `Оплата и страховая · ${claimLabel(activeClaim, activeClaimIdx)}` : 'Оплата и страховая'}
              {/* Номер ЗН этого дела — по нему страховая заводит дело, поэтому он
                  должен быть виден там же, где реквизиты, а не только в документах. */}
              {isEdit && isInsCarForm && activeClaim?.order_number && (
                <span className="cc-claim-num" title="Номер заказ-наряда этого дела — под ним оно уходит в страховую">
                  {activeClaim.order_number}
                </span>
              )}
              {isEdit && claims.length > 1 && activeStream !== STREAM_INSURANCE && (
                <button type="button" className="cc-claim-del" onClick={() => removeClaim(activeStream)} disabled={claimBusy} title="Удалить это дело — его позиции вернутся в Убыток 1">
                  <Icon name="trash" size={13} />
                </button>
              )}
            </div>
            <div className="cc-grid">
              <label className="cc-field">
                <span>Тип оплаты</span>
                <select value={form.payment_type} onChange={(e) => patchForm({ payment_type: e.target.value })} disabled={isEdit && claims.length > 1}>
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
                  <span>Тип полиса</span>
                  <select value={form.policy_type} onChange={(e) => patchForm({ policy_type: e.target.value })}>
                    <option value="">— выберите —</option>
                    {POLICY_TYPES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
              )}
              {form.payment_type === 'insurance' && (
                <label className="cc-field">
                  <span>Франшиза, ₽</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="напр. 15000"
                    value={form.franchise}
                    onChange={(e) => patchForm({ franchise: e.target.value })}
                  />
                </label>
              )}
            </div>
            {form.payment_type === 'insurance' && Number(form.franchise) > 0 && (
              <div className="cc-hint">Эту сумму платит клиент, остальное — страховая. Отражается в заказ-наряде, акте и счёте.</div>
            )}
            {form.payment_type === 'insurance' && !insurers.length && (
              <div className="cc-hint">Справочник страховых пуст — добавьте их в разделе «Посты и мастера».</div>
            )}
            {isEdit && claims.length > 1 && (
              <div className="cc-hint">Тип оплаты не меняется, пока по машине заведено несколько убытков — сначала удалите лишние дела.</div>
            )}
          </section>
          )}

          {activeTab === 'overview' && (!isEdit || ovEdit) && (
          <section className="cc-section">
            <div className="cc-section-head"><span className="cc-section-icon">📝</span>Примечания</div>
            <textarea className="cc-notes" placeholder="Комментарии по работе, договорённости с клиентом…" value={form.notes} onChange={(e) => patchForm({ notes: e.target.value })} />
          </section>
          )}

          {!isEdit && activeTab === 'works' && imported && imported.services.length > 0 && (
            <section className="cc-section cc-full">
              <button type="button" className="cc-imported-head" onClick={() => setImportedOpen((o) => !o)}>
                <span className="cc-section-icon">🧾</span>Распознанные работы
                <span className="cc-imported-count">работ {imported.services.length}</span>
                <span className="cc-imported-chevron"><Icon name={importedOpen ? 'chevron-down' : 'chevron-right'} size={13} /></span>
              </button>
              {importedOpen && (
                <div className="cc-imported-body">
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
                  <div className="cc-imported-foot">
                    {imported.discount > 0 ? <span>Скидка Audatex: {imported.discount.toLocaleString('ru-RU')} ₽</span> : <span />}
                    <span className="cc-imported-note">итоговый расчёт с НДС — в заказ-наряде</span>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Услуги новой машины — ручной ввод работ (create-режим). Распознанные
              Audatex работы показаны выше отдельным блоком; здесь — добавленные
              руками. Обе группы уходят в job.services при сохранении. */}
          {!isEdit && activeTab === 'works' && (
            <section className="cc-section cc-full cc-extras">
              <div className="cc-section-head">
                <span className="cc-section-icon">🛠️</span>Услуги
                <span className="cc-section-hint">добавьте работы вручную — вместе с распознанными уйдут в заказ-наряд</span>
              </div>
              {createServices.length > 0 ? (
                <table className="items-table cc-extras-table">
                  <thead><tr><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th /></tr></thead>
                  <tbody>
                    {createServices.map((s) => (
                      <tr key={s.id}>
                        <td><input value={s.name} onChange={(e) => updateCreateService(s.id, { name: e.target.value })} placeholder="напр. Окраска бампера" /></td>
                        <td><input type="number" min="0" value={s.qty} onChange={(e) => updateCreateService(s.id, { qty: e.target.value })} /></td>
                        <td><input type="number" min="0" value={s.price} onChange={(e) => updateCreateService(s.id, { price: e.target.value })} /></td>
                        <td className="items-table-sum">{fmtMoney((Number(s.price) || 0) * (Number(s.qty) || 1))}</td>
                        <td><button className="danger small" onClick={() => removeCreateService(s.id)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="cc-hint" style={{ marginTop: 0 }}>Пока пусто. Добавьте работы вручную кнопкой ниже{imported && imported.services.length ? ' — распознанные Audatex работы показаны выше' : ''}.</div>
              )}
              <button className="cc-add-stage" onClick={addCreateService}>+ Добавить услугу</button>
              {createServices.length > 0 && (
                <div className="cc-sum-total"><span>Итого услуги (вручную)</span><b>{fmtMoney(createServicesSum)}</b></div>
              )}
            </section>
          )}

          {/* Запчасти новой машины — редактируемая таблица (create-режим). Всегда видна:
              можно добавить вручную, а импорт Audatex наполняет её же. Правится до
              сохранения; уходит в job.parts и на экран «Запчасти». */}
          {!isEdit && activeTab === 'works' && (
            <section className="cc-section cc-full cc-extras">
              <div className="cc-section-head">
                <span className="cc-section-icon">📦</span>Запчасти
                <span className="cc-section-hint">добавьте вручную или импортом из Audatex — потом уйдут на экран «Запчасти»</span>
              </div>
              {createParts.length > 0 ? (
                <table className="items-table cc-extras-table">
                  <thead><tr><th>Код</th><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th /></tr></thead>
                  <tbody>
                    {createParts.map((p) => (
                      <tr key={p.id}>
                        <td><input value={p.code} onChange={(e) => updateCreatePart(p.id, { code: e.target.value })} placeholder="артикул" /></td>
                        <td><input value={p.name} onChange={(e) => updateCreatePart(p.id, { name: e.target.value })} placeholder="напр. Бампер передний" /></td>
                        <td><input type="number" min="0" value={p.qty} onChange={(e) => updateCreatePart(p.id, { qty: e.target.value })} /></td>
                        <td><input type="number" min="0" value={p.price} onChange={(e) => updateCreatePart(p.id, { price: e.target.value })} /></td>
                        <td className="items-table-sum">{fmtMoney((Number(p.price) || 0) * (Number(p.qty) || 1))}</td>
                        <td><button className="danger small" onClick={() => removeCreatePart(p.id)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="cc-hint" style={{ marginTop: 0 }}>Пока пусто. Добавьте запчасти вручную кнопкой ниже или импортируйте калькуляцию Audatex — распознанные позиции появятся здесь, и их можно будет поправить.</div>
              )}
              <button className="cc-add-stage" onClick={addCreatePart}>+ Добавить запчасть</button>
              {createParts.length > 0 && (
                <div className="cc-sum-total"><span>Итого запчасти</span><b>{fmtMoney(partsSum)}</b></div>
              )}
            </section>
          )}

          {activeTab === 'route' && (
          <section className="cc-section cc-full">
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
          )}

          {isEdit && activeTab === 'works' && insWorks.length > 0 && (
            <section className="cc-section">
              <div className="cc-section-head"><span className="cc-section-icon" />{isInsCar ? 'Работы по страховой' : 'Работы'}<span className="cc-section-hint">{insWorks.length} поз.</span></div>
              <div className="cc-sum-list">
                {insWorks.map((s, i) => (
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

          {/* Допродажи — СВОЯ вкладка, а не секция рядом с убытком. Полоса вкладок
              означает «всё ниже относится к активной вкладке»; секция, которая этому
              не подчиняется, — ловушка: приёмщик правил бы допродажи, стоя на «Убытке
              2», и не понимал, куда они уехали. Список общий на машину (решение
              владельца: клиент один, счёт ему один). */}
          {isEdit && activeTab === 'works' && isInsCar && onExtrasTab && (
            <section className="cc-section cc-extras">
              <div className="cc-section-head">
                <span className="cc-section-icon">➕</span>Допродажи клиента
                <span className="cc-section-hint">оплачивает клиент отдельно от страховой</span>
              </div>
              <div className="cc-hint" style={{ marginTop: 0 }}>
                Доп. работы и запчасти, которые клиент заказывает сверх страхового ремонта — общие на машину, независимо от количества убытков. В окне «Документы» для них формируется отдельный комплект («Кому: Клиенту»).
              </div>

              <div className="cc-section-subhead">Работы</div>
              <table className="items-table cc-extras-table">
                <thead><tr><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th /></tr></thead>
                <tbody>
                  {extraServices.map((s) => (
                    <tr key={s.id}>
                      <td><input value={s.name} onChange={(e) => updateExtraService(s.id, { name: e.target.value })} placeholder="напр. Полировка фар" /></td>
                      <td><input type="number" min="0" value={s.qty} onChange={(e) => updateExtraService(s.id, { qty: e.target.value })} /></td>
                      <td><input type="number" min="0" value={s.price} onChange={(e) => updateExtraService(s.id, { price: e.target.value })} /></td>
                      <td className="items-table-sum">{fmtMoney((Number(s.price) || 0) * (Number(s.qty) || 1))}</td>
                      <td><button className="danger small" onClick={() => removeExtraService(s.id)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="cc-add-stage" onClick={addExtraService}>+ Добавить работу</button>

              <div className="cc-section-subhead" style={{ marginTop: 14 }}>Запчасти</div>
              <table className="items-table cc-extras-table">
                <thead><tr><th>Код</th><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th /></tr></thead>
                <tbody>
                  {extraParts.map((p) => (
                    <tr key={p.id}>
                      <td><input value={p.code} onChange={(e) => updateExtraPart(p.id, { code: e.target.value })} placeholder="артикул" /></td>
                      <td><input value={p.name} onChange={(e) => updateExtraPart(p.id, { name: e.target.value })} placeholder="напр. Коврики" /></td>
                      <td><input type="number" min="0" value={p.qty} onChange={(e) => updateExtraPart(p.id, { qty: e.target.value })} /></td>
                      <td><input type="number" min="0" value={p.price} onChange={(e) => updateExtraPart(p.id, { price: e.target.value })} /></td>
                      <td className="items-table-sum">{fmtMoney((Number(p.price) || 0) * (Number(p.qty) || 1))}</td>
                      <td><button className="danger small" onClick={() => removeExtraPart(p.id)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="cc-add-stage" onClick={addExtraPart}>+ Добавить запчасть</button>

              {(extraServices.length > 0 || extraParts.length > 0) && (
                <div className="cc-sum-total"><span>Итого допродажи</span><b>{fmtMoney(extraServicesSum + extraPartsSum)}</b></div>
              )}
              <div className="cc-hint" style={{ marginTop: 8 }}>Не забудьте нажать «Сохранить» внизу. Запчасти попадут на экран «Запчасти» для закупки.</div>
            </section>
          )}

          {isEdit && activeTab === 'works' && (insParts.length > 0 || invoices.length > 0) && (
            <section className="cc-section">
              <div className="cc-section-head"><span className="cc-section-icon" />Запчасти и документы</div>
              <div className="cc-2col">
                <div>
                  <div className="cc-section-subhead">{isInsCar ? 'Запчасти по страховой' : 'Запчасти'}</div>
                  {partNotices.map((n) => (
                    <div key={n.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: '0 0 8px', padding: '7px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.35, background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning) 55%, transparent)', color: 'var(--color-warning)' }}>
                      <span style={{ flexShrink: 0, display: 'inline-flex', marginTop: 1 }}><Icon name={n.icon} size={13} /></span>
                      <span>{n.title}</span>
                    </div>
                  ))}
                  {insParts.length ? (
                    <div className="cc-sum-list">
                      {insParts.map((p, i) => (
                        <div className="cc-sum-row" key={`p-${i}`}>
                          <span className="cc-sum-ico"><Icon name="box" size={15} /></span>
                          <span className="cc-sum-name">
                            {p.name || '—'}{p.code ? ` · ${p.code}` : ''}
                            {KIND_BADGES[p.kind] && (
                              <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 5, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', background: 'color-mix(in srgb, var(--color-warning) 18%, transparent)', color: 'var(--color-warning)' }}>{KIND_BADGES[p.kind]}</span>
                            )}
                          </span>
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

          {isEdit && activeTab === 'journal' && journal.length > 0 && (
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
          {/* Пустые разделы: короткая подсказка вместо белого экрана. Деньги на
              вкладке допродаж (у них нет страховых реквизитов) и работы у машины,
              по которой ещё ничего не заведено. */}
          {activeTab === 'money' && onExtrasTab && (
            <div className="cc-tab-empty cc-full">Допродажи клиент оплачивает отдельным счётом — страховых реквизитов у них нет. Их работы и запчасти — на вкладке «Работы и запчасти».</div>
          )}
          {isEdit && activeTab === 'works' && !insWorks.length && !insParts.length && !invoices.length && !(isInsCar && onExtrasTab) && (
            <div className="cc-tab-empty cc-full">Работы и запчасти пока не добавлены. Их можно внести в окне «Документы» или импортом Audatex при создании машины.</div>
          )}
         </div>
        </div>

        <div className="cc-footer">
          {isEdit ? (
            <>
              <button className="danger cc-btn-ico" onClick={onRemove}><Icon name="trash" size={15} />Удалить</button>
              <div className="cc-footer-actions">
                {isRepair(job) && !job.stages?.length && (
                  <button className="cc-btn-ico" onClick={returnToApproval}><Icon name="shield" size={15} />Вернуть в согласование</button>
                )}
                <button className="cc-btn-ico" onClick={openDocs}><Icon name="file" size={15} />Документы</button>
                {isOwner && <button className="cc-btn-ico" onClick={openPay}><Icon name="receipt" size={15} />Оплата мастерам</button>}
                {isOwner && <button className="cc-btn-ico" onClick={openCosting}><Icon name="wallet" size={15} />Себестоимость</button>}
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

      {payOpen && (
        <MasterPayModal
          job={costingJob}
          onSaved={(c) => setLocalCosting(c)}
          onClose={() => setPayOpen(false)}
        />
      )}

      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} alt="Фото автомобиля" />
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
