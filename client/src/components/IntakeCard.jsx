import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { api } from '../api';
import { auth } from '../firebase';
import { uploadPhoto, deletePhotoFile } from '../photos';
import { printFitted } from '../printDoc';
import Icon from './Icon';
import PhotoViewer from './PhotoViewer';
import IntakeAct from './IntakeAct';
import {
  DAMAGE_KINDS, DEFAULT_DAMAGE_KIND, FUEL_LEVELS,
  buildIntakeActSnapshot, groupZones, intakeStatus, normalizeIntakeSettings,
  photoCategory, photoSlotId, readIntake,
} from '../intake';

// Карточка предремонтной приёмки ОДНОЙ машины — рабочий экран мастера-приёмщика.
// Открывается поверх списка (Intake) и рассчитана в первую очередь на телефон:
// приёмщик ходит вокруг машины и заполняет её большими пальцами.
//
// СОХРАНЕНИЕ — АВТОМАТИЧЕСКОЕ. Кнопки «Сохранить» нет сознательно: у машины с
// телефоном в руках её забывают нажать, и полчаса работы пропадают. Каждое
// касание сразу меняет экран, а запись в базу уходит пачкой через ~0,7 с
// (queue → flush). Пачка нужна, чтобы десять галочек комплектности не
// превращались в десять транзакций подряд.
//
// Порядок блоков повторяет порядок реальной приёмки: сначала то, что видно с
// водительского места (пробег, топливо, ключи), потом документы и комплектность,
// потом обход по кузову, потом фото, и только в конце — чек-лист как контрольная
// сверка. Чек-лист внизу намеренно: он проверяет работу, а не заменяет её.

const SAVE_DEBOUNCE_MS = 700;

function pluralRu(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

// Запись о загруженном снимке для job.photos. Вынесена из компонента, потому что
// внутри него любой Date.now() — это вызов нечистой функции в области рендера
// (правило react-hooks/purity), даже когда фактически он происходит в обработчике.
function photoRecord(slotId, up) {
  return {
    id: uid(),
    category: photoCategory(slotId),
    url: up.url,
    path: up.path,
    size: up.size || 0,
    w: up.w || 0,
    h: up.h || 0,
    uploaded_at: Date.now(),
    uploaded_by: auth.currentUser?.email || null,
  };
}

// Чип-переключатель: документы, комплектность, зоны повреждений.
function Chip({ on, onToggle, children, tone }) {
  return (
    <button
      type="button"
      className={`ink-chip-btn${on ? ' is-on' : ''}${tone ? ` is-${tone}` : ''}`}
      aria-pressed={on}
      onClick={onToggle}
    >
      {on && <Icon name="check" size={13} strokeWidth={2.6} />}
      {children}
    </button>
  );
}

function Section({ title, hint, count, children }) {
  return (
    <section className="ink-sec">
      <div className="ink-sec-head">
        <span className="ink-sec-mark" />
        <span className="ink-sec-title">{title}</span>
        {count != null && <span className="ink-sec-count">{count}</span>}
      </div>
      {hint && <div className="ink-sec-hint">{hint}</div>}
      {children}
    </section>
  );
}

export default function IntakeCard({
  job: initialJob,
  settings,
  company = {},
  userName = '',
  onClose = () => {},
  onOpenDocs = null,
  onAdvanced = () => {},
  // Загрузчик снимков вынесен в проп, чтобы демо-страница могла подменить его
  // заглушкой. Остальные обращения к сети идут через `api`, который демо
  // подменяет напрямую (так же, как car-card-demo), — а вот пространство имён
  // ES-модуля photos.js переприсвоить нельзя, оно только для чтения.
  uploadFn = uploadPhoto,
}) {
  const jobId = initialJob?.id;
  const s = useMemo(() => normalizeIntakeSettings(settings), [settings]);

  const [intake, setIntake] = useState(() => readIntake(initialJob));
  const [photos, setPhotos] = useState(() => initialJob?.photos || []);
  const [saveState, setSaveState] = useState('idle');   // idle | saving | saved | error
  const [uploadSlot, setUploadSlot] = useState(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [photoErr, setPhotoErr] = useState('');
  const [viewer, setViewer] = useState(null);
  const [askAdvance, setAskAdvance] = useState(false);
  const [busy, setBusy] = useState(false);
  // Номер и дата акта — одна пара: обе приходят из api.jobs.ensureIntakeActNumber,
  // чтобы на бумаге стояло ровно то, что записано в базе.
  const [act, setAct] = useState(() => {
    const stored = readIntake(initialJob);
    return { number: stored.act_number || '', at: stored.act_date || 0 };
  });

  const pendingRef = useRef({});
  const timerRef = useRef(null);
  // Самое свежее состояние приёмки, обновляемое СИНХРОННО. Обработчики считают
  // новое значение от него, а не от `intake` из замыкания: два быстрых касания
  // (а на телефоне так и тыкают) попадают в один рендер, и второе прочитало бы
  // то же старое состояние — первая галочка молча терялась бы.
  const draftRef = useRef(intake);

  // Отправить накопленные правки в базу. Ошибку не глотаем: несохранённое
  // возвращается в очередь, а приёмщик видит красную плашку и может повторить —
  // молча потерять зафиксированное повреждение хуже, чем показать ошибку.
  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const patch = pendingRef.current;
    if (!jobId || !patch || !Object.keys(patch).length) return;
    pendingRef.current = {};
    setSaveState('saving');
    try {
      await api.jobs.saveIntake(jobId, patch);
      setSaveState('saved');
    } catch {
      pendingRef.current = { ...patch, ...pendingRef.current };
      setSaveState('error');
    }
  }, [jobId]);

  // Записать правку: `patchOrFn` — либо готовые поля, либо функция от ТЕКУЩЕГО
  // состояния (для переключателей, где новое значение зависит от старого).
  const queue = useCallback((patchOrFn) => {
    const prev = draftRef.current;
    const patch = typeof patchOrFn === 'function' ? patchOrFn(prev) : patchOrFn;
    const next = { ...prev, ...patch };
    draftRef.current = next;
    pendingRef.current = { ...pendingRef.current, ...patch };
    setIntake(next);
    setSaveState('saving');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { flush(); }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Локальная правка БЕЗ постановки в очередь — для того, что уже записано в базу
  // отдельным вызовом (смена статуса, выданный номер акта). Держит draftRef в
  // строю, иначе следующая правка откатила бы её обратно.
  const applyLocal = useCallback((patch) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setIntake(next);
  }, []);

  // Уход с экрана (закрытие, переход назад) не должен обрывать недописанную пачку.
  useEffect(() => () => { flush(); }, [flush]);

  // Статус готовности считаем ровно тем же кодом, что и список машин, — иначе
  // карточка и плитка разошлись бы в ответе на вопрос «можно ли закрывать».
  const st = useMemo(
    () => intakeStatus({ ...initialJob, intake, photos }, s),
    [initialJob, intake, photos, s],
  );

  const bySlot = useMemo(() => {
    const out = {};
    for (const p of photos) {
      const slot = photoSlotId(p?.category);
      if (slot) (out[slot] || (out[slot] = [])).push(p);
    }
    return out;
  }, [photos]);

  const damageByZone = useMemo(
    () => new Map(intake.damages.map((d) => [d.zone, d])),
    [intake.damages],
  );

  // ─── Переключатели ─────────────────────────────────────────────────────────

  const toggleIn = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  // Все переключатели считают новое значение от `cur` — актуального состояния на
  // момент касания, а не от того, что было на последнем рендере.
  function toggleDoc(id) { queue((cur) => ({ docs: toggleIn(cur.docs, id) })); }
  function toggleEquip(id) { queue((cur) => ({ equipment: toggleIn(cur.equipment, id) })); }
  function toggleCheck(id) { queue((cur) => ({ checked: toggleIn(cur.checked, id) })); }

  function toggleZone(zoneId) {
    queue((cur) => ({
      damages: cur.damages.some((d) => d.zone === zoneId)
        ? cur.damages.filter((d) => d.zone !== zoneId)
        : [...cur.damages, { id: uid(), zone: zoneId, kind: DEFAULT_DAMAGE_KIND, note: '' }],
    }));
  }

  function patchDamage(zoneId, patch) {
    queue((cur) => ({ damages: cur.damages.map((d) => (d.zone === zoneId ? { ...d, ...patch } : d)) }));
  }

  // ─── Фото ──────────────────────────────────────────────────────────────────

  async function addPhotos(e, slotId) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !jobId) return;
    setPhotoErr('');
    setUploadSlot(slotId);
    try {
      // Последовательно, а не параллельно: на слабой сети в цехе так виден
      // честный прогресс одного снимка вместо трёх зависших полосок.
      for (const file of files) {
        setUploadPct(0);
        const up = await uploadFn(jobId, file, setUploadPct);
        const photo = photoRecord(slotId, up);
        await api.jobs.addPhoto(jobId, photo);
        setPhotos((prev) => [...prev, photo]);
      }
    } catch (err) {
      setPhotoErr(err?.message || 'Не удалось загрузить фото');
    } finally {
      setUploadSlot(null);
      setUploadPct(0);
    }
  }

  async function removePhoto(photo) {
    if (!jobId || !window.confirm('Удалить это фото?')) return;
    setPhotoErr('');
    try {
      await api.jobs.removePhoto(jobId, photo.id);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      deletePhotoFile(photo.path).catch(() => {});   // чистка файла — best-effort
    } catch {
      setPhotoErr('Не удалось удалить фото');
    }
  }

  // ─── Печать акта ───────────────────────────────────────────────────────────

  const snapshot = useMemo(
    () => buildIntakeActSnapshot(
      { ...initialJob, intake },
      s,
      company,
      { docNumber: act.number, docDate: act.at, acceptedBy: userName },
    ),
    [initialJob, intake, s, company, act, userName],
  );

  // Номер акта присваивается при ПЕРВОЙ печати (а не при заведении машины) —
  // иначе годовая очередь ПР-… тратилась бы на машины, до акта которых не дошло.
  // flushSync — чтобы свежий номер оказался в DOM до window.print().
  async function printAct() {
    if (busy) return;
    setBusy(true);
    try {
      await flush();
      if (!act.number && jobId) {
        const issued = await api.jobs.ensureIntakeActNumber(jobId);
        flushSync(() => {
          setAct(issued);
          applyLocal({ act_number: issued.number, act_date: issued.at });
        });
      }
    } catch {
      // Номер не выдался (нет сети / правила Firestore) — печатаем без номера:
      // бумага с прочерком полезнее, чем несостоявшаяся печать у стоящего клиента.
      setSaveState('error');
    } finally {
      setBusy(false);
    }
    printFitted();
  }

  // ─── Завершение приёмки ────────────────────────────────────────────────────

  async function finish() {
    if (busy || !st.ready) return;
    setBusy(true);
    try {
      await flush();
      await api.jobs.saveIntake(jobId, { status: 'done' });
      applyLocal({ status: 'done' });
      setSaveState('saved');
      setAskAdvance(true);
    } catch {
      setSaveState('error');
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    const ok = window.confirm(
      'Закрыть приёмку без заполнения?\n\n'
      + 'Так помечают машины, заехавшие до появления этого экрана. '
      + 'В карточке останется отметка «приёмка не проводилась».',
    );
    if (!ok || busy) return;
    setBusy(true);
    try {
      await flush();
      await api.jobs.saveIntake(jobId, { status: 'skipped' });
      applyLocal({ status: 'skipped' });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (busy) return;
    setBusy(true);
    try {
      await api.jobs.saveIntake(jobId, { status: 'open' });
      applyLocal({ status: 'open' });
      setAskAdvance(false);
    } catch {
      setSaveState('error');
    } finally {
      setBusy(false);
    }
  }

  // Перевод в «Калькуляцию» — следующая колонка доски «Согласование». Приёмщик
  // может отказаться: бывает, что машину приняли, но в смету она пойдёт позже.
  async function advance() {
    if (busy) return;
    setBusy(true);
    try {
      await api.jobs.update(jobId, { approval_status: 'calc' });
      onAdvanced(jobId);
      onClose();
    } catch {
      setSaveState('error');
    } finally {
      // Обычно карточка тут же размонтируется, но полагаться на это нельзя:
      // если родитель почему-то не закрыл её, кнопки не должны остаться мёртвыми.
      setBusy(false);
    }
  }

  async function close() {
    await flush();
    onClose();
  }

  const saveLabel = {
    idle: '',
    saving: 'Сохраняем…',
    saved: 'Сохранено',
    error: 'Не сохранено — нет связи',
  }[saveState];

  const zoneGroups = useMemo(() => groupZones(s.damage_zones), [s.damage_zones]);

  return (
    <div className="modal-backdrop ink-backdrop" onClick={close}>
      <div className="ink-sheet" onClick={(e) => e.stopPropagation()}>

        <header className="ink-sheet-head">
          <button type="button" className="ink-back" onClick={close} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
          <div className="ink-sheet-id">
            {initialJob?.plate_number && <span className="ink-plate">{initialJob.plate_number}</span>}
            <span className="ink-model">{initialJob?.car_model || 'Без модели'}</span>
            {initialJob?.client_name && <span className="ink-sheet-client">{initialJob.client_name}</span>}
          </div>
          <div className="ink-sheet-actions">
            <button type="button" className="ink-btn" onClick={printAct} disabled={busy}>
              <Icon name="file" size={15} />Акт приёмки
            </button>
            {onOpenDocs && (
              <button type="button" className="ink-btn" onClick={() => onOpenDocs(initialJob)}>
                <Icon name="receipt" size={15} />Документы
              </button>
            )}
          </div>
        </header>

        <div className={`ink-savebar is-${saveState}`}>
          <span className="ink-progress-chip">Чек-лист <b>{st.checklist.done}/{st.checklist.total}</b></span>
          <span className="ink-progress-chip">Фото <b>{st.photos.done}/{st.photos.total}</b></span>
          <span className="ink-progress-chip">Повреждений <b>{st.damages}</b></span>
          {saveLabel && <span className="ink-save-state">{saveLabel}</span>}
          {saveState === 'error' && (
            <button type="button" className="ink-retry" onClick={flush}>Повторить</button>
          )}
        </div>

        <div className="ink-sheet-body">

          {st.skipped && (
            <div className="ink-banner is-warn">
              <Icon name="warning" size={16} />
              Отмечено: приёмка не проводилась. Данные ниже в акт не пойдут.
            </div>
          )}

          <Section title="Состояние при заезде" hint="То, что видно с водительского места. Пробег обязателен — он идёт в акт и в смету.">
            <div className="ink-fields">
              <label className="ink-field">
                <span>Пробег, км{s.require_mileage && <i> · обязательно</i>}</span>
                <input
                  inputMode="numeric"
                  value={intake.mileage}
                  onChange={(e) => queue({ mileage: e.target.value })}
                  placeholder="например 124500"
                />
              </label>
              <label className="ink-field">
                <span>Ключей, комплектов</span>
                <input
                  inputMode="numeric"
                  value={intake.keys}
                  onChange={(e) => queue({ keys: e.target.value })}
                  placeholder="1"
                />
              </label>
              <label className="ink-field">
                <span>Чек-лист</span>
                <select value={st.template?.id || ''} onChange={(e) => queue({ template_id: e.target.value })}>
                  {s.templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
            </div>
            <div className="ink-sub">Уровень топлива</div>
            <div className="ink-chips">
              {FUEL_LEVELS.map((f) => (
                <Chip key={f.id} on={intake.fuel === f.id} onToggle={() => queue({ fuel: intake.fuel === f.id ? '' : f.id })}>
                  {f.label}
                </Chip>
              ))}
            </div>
          </Section>

          <Section
            title="Переданные документы"
            count={intake.docs.length}
            hint="В акт печатаются все пункты — и переданные, и нет."
          >
            <div className="ink-chips">
              {s.docs.map((d) => (
                <Chip key={d.id} on={intake.docs.includes(d.id)} onToggle={() => toggleDoc(d.id)}>{d.label}</Chip>
              ))}
            </div>
          </Section>

          <Section
            title="Комплектность"
            count={intake.equipment.length}
            hint="Отмечайте только то, что реально есть в машине. Непроверенное лучше не ставить."
          >
            <div className="ink-chips">
              {s.equipment.map((it) => (
                <Chip key={it.id} on={intake.equipment.includes(it.id)} onToggle={() => toggleEquip(it.id)}>{it.label}</Chip>
              ))}
            </div>
          </Section>

          <Section
            title="Повреждения"
            count={intake.damages.length}
            hint="Обойдите машину по кругу и отметьте каждый повреждённый элемент. Потом уточните характер."
          >
            {zoneGroups.map((g) => (
              <div key={g.group} className="ink-zone-group">
                <div className="ink-sub">{g.group}</div>
                <div className="ink-chips">
                  {g.zones.map((z) => (
                    <Chip key={z.id} on={damageByZone.has(z.id)} onToggle={() => toggleZone(z.id)} tone="damage">
                      {z.label}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}

            {intake.damages.length > 0 && (
              <div className="ink-damage-list">
                <div className="ink-sub">Уточните характер</div>
                {intake.damages.map((d) => {
                  const zone = s.damage_zones.find((z) => z.id === d.zone);
                  return (
                    <div className="ink-damage-row" key={d.id || d.zone}>
                      <span className="ink-damage-zone">{zone?.label || d.zone}</span>
                      <select value={d.kind} onChange={(e) => patchDamage(d.zone, { kind: e.target.value })}>
                        {DAMAGE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                      </select>
                      <input
                        value={d.note}
                        onChange={(e) => patchDamage(d.zone, { note: e.target.value })}
                        placeholder="Примечание — где именно, размер"
                      />
                      <button type="button" className="ink-damage-del" onClick={() => toggleZone(d.zone)} aria-label="Убрать">
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section
            title="Фотофиксация"
            count={`${st.photos.done}/${st.photos.total}`}
            hint="Снимайте прямо здесь — камера открывается по нажатию. Рубрики со звёздочкой обязательны."
          >
            {photoErr && <div className="ink-banner is-error"><Icon name="warning" size={16} />{photoErr}</div>}
            <div className="ink-slots">
              {s.photo_slots.map((slot) => {
                const list = bySlot[slot.id] || [];
                const uploading = uploadSlot === slot.id;
                const missing = slot.required && !list.length;
                return (
                  <div key={slot.id} className={`ink-slot${missing ? ' is-missing' : ''}${list.length ? ' is-filled' : ''}`}>
                    <div className="ink-slot-head">
                      {slot.label}{slot.required && <i title="Обязательно">*</i>}
                      {list.length > 1 && <span className="ink-slot-count">{list.length}</span>}
                    </div>
                    <div className="ink-slot-body">
                      {list.map((p) => (
                        <div className="ink-thumb" key={p.id}>
                          <img src={p.url} alt={slot.label} loading="lazy" onClick={() => setViewer(p)} />
                          <button type="button" onClick={() => removePhoto(p)} aria-label="Удалить фото">
                            <Icon name="trash" size={12} strokeWidth={2} />
                          </button>
                        </div>
                      ))}
                      <label className={`ink-shoot${uploading ? ' is-busy' : ''}`}>
                        {uploading
                          ? <span>{uploadPct ? `${uploadPct}%` : '…'}</span>
                          : <><Icon name="camera" size={20} /><span>Снять</span></>}
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          multiple
                          hidden
                          disabled={uploadSlot != null}
                          onChange={(e) => addPhotos(e, slot.id)}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section
            title="Чек-лист приёмки"
            count={`${st.checklist.done}/${st.checklist.total}`}
            hint={st.template ? `Шаблон: ${st.template.label}` : ''}
          >
            <ul className="ink-checklist">
              {st.items.map((it) => {
                const on = intake.checked.includes(it.id);
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      className={`ink-check${on ? ' is-on' : ''}${it.required && !on ? ' is-required' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggleCheck(it.id)}
                    >
                      <span className="ink-check-box">{on && <Icon name="check" size={14} strokeWidth={3} />}</span>
                      <span className="ink-check-text">{it.text}</span>
                      {!it.required && <span className="ink-check-opt">не обязательно</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title="Примечания" hint="Всё, что не влезло в пункты выше: машина не на ходу, особые пожелания клиента, договорённости.">
            <textarea
              className="ink-notes"
              rows={3}
              value={intake.notes}
              onChange={(e) => queue({ notes: e.target.value })}
              placeholder="Свободный текст — попадёт в акт приёмки"
            />
          </Section>
        </div>

        <footer className="ink-foot">
          {askAdvance ? (
            <div className="ink-ask">
              <div className="ink-ask-text">
                <b>Приёмка закрыта.</b> Перевести машину в «Калькуляцию»?
              </div>
              <div className="ink-ask-btns">
                <button type="button" className="ink-btn" onClick={() => { setAskAdvance(false); onClose(); }} disabled={busy}>
                  Пока оставить
                </button>
                <button type="button" className="ink-btn is-primary" onClick={advance} disabled={busy}>
                  Перевести →
                </button>
              </div>
            </div>
          ) : st.done || st.skipped ? (
            <div className="ink-ask">
              <div className="ink-ask-text">
                {st.skipped ? 'Отмечено: приёмка не проводилась.' : 'Приёмка завершена.'}
              </div>
              <div className="ink-ask-btns">
                <button type="button" className="ink-btn" onClick={reopen} disabled={busy}>Открыть заново</button>
                <button type="button" className="ink-btn is-primary" onClick={advance} disabled={busy}>
                  В «Калькуляцию» →
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="ink-foot-status">
                {st.ready ? (
                  <span className="ink-ready"><Icon name="check" size={15} strokeWidth={2.6} />Всё заполнено — можно закрывать</span>
                ) : (
                  <span className="ink-blockers">
                    Осталось {st.blockers.length} {pluralRu(st.blockers.length, 'пункт', 'пункта', 'пунктов')}:{' '}
                    {st.blockers.slice(0, 4).join(' · ')}
                    {st.blockers.length > 4 ? ` · ещё ${st.blockers.length - 4}` : ''}
                  </span>
                )}
              </div>
              <div className="ink-foot-btns">
                <button type="button" className="ink-skip" onClick={skip} disabled={busy}>
                  Приёмка не проводилась
                </button>
                <button
                  type="button"
                  className="ink-btn is-primary is-big"
                  onClick={finish}
                  disabled={!st.ready || busy}
                  title={st.ready ? '' : 'Сначала заполните обязательные пункты'}
                >
                  Завершить приёмку
                </button>
              </div>
            </>
          )}
        </footer>
      </div>

      {viewer && <PhotoViewer photo={viewer} onClose={() => setViewer(null)} alt="Фото приёмки" />}

      {/* Печатный лист живёт вне модалки (портал в body) — так @media print видит
          его без наследования стилей окна. На экране он скрыт. */}
      {createPortal(<div id="zn-print-mount"><IntakeAct snapshot={snapshot} /></div>, document.body)}
    </div>
  );
}
