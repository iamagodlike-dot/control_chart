import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { api } from '../api';
import {
  canDecodeHeicNatively, compressImage, deletePhotoFile, preloadHeicDecoder,
} from '../photos';
import { dequeue, enqueue, subscribeQueue } from '../photoQueue';
import { printFitted } from '../printDoc';
import Icon from './Icon';
import PhotoViewer from './PhotoViewer';
import IntakeAct from './IntakeAct';
import {
  DAMAGE_KINDS, DAMAGE_SCOPES, DEFAULT_DAMAGE_KIND, DOC_ITEMS, EQUIPMENT_ITEMS,
  FUEL_LEVELS, INSPECTION_STEPS, buildIntakeActSnapshot, groupZones,
  inspectionStatus, readIntake, zoneLabel,
} from '../intake';

// Мастер дефектовки — рабочий экран приёмщика у приехавшей машины.
//
// ПОЧЕМУ ПО ШАГАМ. Приёмщик стоит у машины с телефоном в одной руке. Один шаг =
// один экран без прокрутки, и шаги идут в том же порядке, в каком реально ходят
// вокруг машины: сначала за руль (пробег, топливо, ключи), потом круговая съёмка,
// потом обход по кузову, потом разговор с клиентом о том, что он передаёт.
//
// СОХРАНЕНИЕ АВТОМАТИЧЕСКОЕ. Кнопки «Сохранить» нет сознательно: у машины её
// забывают нажать, и полчаса работы пропадают. Каждое касание сразу меняет экран,
// а запись уходит пачкой через ~0,7 с — иначе десять галочек комплектности
// превратились бы в десять обращений к базе.
//
// БЕЗ СВЯЗИ ТОЖЕ РАБОТАЕТ. Поля пишутся по отдельности и ложатся в очередь
// Firestore (см. api.jobs.saveInspection), снимки — в очередь на самом телефоне
// (photoQueue.js) и видны на экране сразу. Единственное, чему нужна сеть, —
// номер акта: без неё лист печатается с прочерком.

const SAVE_DEBOUNCE_MS = 700;

const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

function Chip({ on, onToggle, children, tone }) {
  return (
    <button
      type="button"
      className={`ins-chip${on ? ' is-on' : ''}${tone ? ` is-${tone}` : ''}`}
      aria-pressed={on}
      onClick={onToggle}
    >
      {on && <Icon name="check" size={13} strokeWidth={2.6} />}
      {children}
    </button>
  );
}

export default function InspectionWizard({
  job,
  company = {},
  userName = '',
  onClose = () => {},
  onAdvanced = () => {},
}) {
  const jobId = job?.id;

  const [intake, setIntake] = useState(() => readIntake(job));
  const [pending, setPending] = useState([]);       // снимки из очереди отправки
  const [stepIdx, setStepIdx] = useState(0);
  const [saveState, setSaveState] = useState('idle');  // idle | saving | saved | error
  const [photoErr, setPhotoErr] = useState('');
  const [busySlot, setBusySlot] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [askAdvance, setAskAdvance] = useState(false);
  const [act, setAct] = useState(() => {
    const stored = readIntake(job);
    return { number: stored.act_number || '', at: stored.act_date || 0 };
  });

  const pendingRef = useRef({});
  const timerRef = useRef(null);
  // Самое свежее состояние, обновляемое СИНХРОННО. Переключатели считают новое
  // значение от него, а не от `intake` из замыкания: два быстрых касания подряд
  // попадают в один рендер, и второе прочитало бы то же старое состояние —
  // первая галочка молча терялась бы (эта ошибка уже ловилась в проекте).
  const draftRef = useRef(intake);
  // Ссылки на локальные превью снимков из очереди. Держим отдельно от состояния,
  // чтобы отзывать их ровно один раз (createObjectURL течёт, если этого не делать).
  const urlsRef = useRef(new Map());

  // ─── Сохранение ────────────────────────────────────────────────────────────

  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const patch = pendingRef.current;
    if (!jobId || !patch || !Object.keys(patch).length) return;
    pendingRef.current = {};
    setSaveState('saving');
    try {
      await api.jobs.saveInspection(jobId, patch);
      setSaveState('saved');
    } catch {
      // Несохранённое возвращаем в очередь: молча потерять зафиксированное
      // повреждение хуже, чем показать красную плашку.
      pendingRef.current = { ...patch, ...pendingRef.current };
      setSaveState('error');
    }
  }, [jobId]);

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

  // Локальная правка без очереди — для того, что уже записано отдельным вызовом
  // (номер акта, отметка о завершении). Держит draftRef в строю, иначе следующая
  // правка откатила бы её обратно.
  const applyLocal = useCallback((patch) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setIntake(next);
  }, []);

  // Уход с экрана не должен обрывать недописанную пачку.
  useEffect(() => () => { flush(); }, [flush]);

  // ─── Очередь снимков ───────────────────────────────────────────────────────
  // Превью строим ЗДЕСЬ, в обработчике подписки, а не в рендере: createObjectURL —
  // нечистая функция, в теле компонента ей не место.
  useEffect(() => {
    const off = subscribeQueue((list) => {
      const mine = list.filter((it) => it.jobId === jobId);
      const cache = urlsRef.current;
      const next = mine.map((it) => {
        let url = cache.get(it.id);
        if (!url) { url = URL.createObjectURL(it.blob); cache.set(it.id, url); }
        return { id: it.id, slot: it.slot, url, pending: true, tries: it.tries || 0, error: it.error || '' };
      });
      for (const [id, url] of cache) {
        if (!mine.some((it) => it.id === id)) { URL.revokeObjectURL(url); cache.delete(id); }
      }
      setPending(next);
    });
    return off;
  }, [jobId]);

  useEffect(() => {
    const cache = urlsRef.current;
    return () => { for (const url of cache.values()) URL.revokeObjectURL(url); cache.clear(); };
  }, []);

  // Айфоны снимают в HEIC, а его не понимает никто, кроме Safari. Конвертер
  // весит около мегабайта, поэтому тянем его заранее и ТОЛЬКО туда, где он
  // понадобится: пока приёмщик заполняет первый шаг, связь обычно ещё есть, а на
  // площадке её может не стать — и докачивать будет неоткуда.
  useEffect(() => {
    let alive = true;
    canDecodeHeicNatively().then((native) => {
      if (!alive || native || navigator.onLine === false) return;
      preloadHeicDecoder().catch(() => {});
    });
    return () => { alive = false; };
  }, []);

  // Загруженные снимки НЕ копируем в состояние: job приходит из живой подписки, а
  // запись в Firestore применяется к локальному кэшу сразу — даже без связи, —
  // поэтому удаление и появление снимка видно и так, без второго источника правды.
  const st = useMemo(
    () => inspectionStatus({ ...job, intake }, pending),
    [job, intake, pending],
  );

  const damageByZone = useMemo(
    () => new Map(intake.damages.map((d) => [d.zone, d])),
    [intake.damages],
  );
  const zoneGroups = useMemo(() => groupZones(), []);

  // ─── Переключатели ─────────────────────────────────────────────────────────

  const toggleIn = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const toggleDoc = (id) => queue((cur) => ({ docs: toggleIn(cur.docs, id) }));
  const toggleEquip = (id) => queue((cur) => ({ equipment: toggleIn(cur.equipment, id) }));

  function toggleZone(zoneId) {
    queue((cur) => ({
      damages: cur.damages.some((d) => d.zone === zoneId)
        ? cur.damages.filter((d) => d.zone !== zoneId)
        : [...cur.damages, { id: uid(), zone: zoneId, kind: DEFAULT_DAMAGE_KIND, scope: 'case', note: '' }],
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
    setBusySlot(slotId);
    try {
      // Сжимаем СРАЗУ, до очереди: в хранилище телефона должны лежать 200 КБ, а не
      // оригиналы по 10 МБ — иначе на десятке снимков упрёмся в лимит места.
      for (const file of files) {
        const { blob, w, h } = await compressImage(file);
        const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
        await enqueue({ jobId, slot: slotId, blob, w, h, name: `${base}.jpg` });
      }
    } catch (err) {
      setPhotoErr(err?.message || 'Не удалось подготовить фото');
    } finally {
      setBusySlot(null);
    }
  }

  async function removePhoto(photo) {
    if (!window.confirm('Удалить это фото?')) return;
    setPhotoErr('');
    try {
      if (photo.pending) { await dequeue(photo.id); return; }
      // Передаём ВЕСЬ объект: так удаление работает и без связи (см. api.removePhoto).
      await api.jobs.removePhoto(jobId, photo);
      deletePhotoFile(photo.path).catch(() => {});   // чистка файла — best-effort
    } catch {
      setPhotoErr('Не удалось удалить фото');
    }
  }

  // ─── Акт ───────────────────────────────────────────────────────────────────

  const snapshot = useMemo(
    () => buildIntakeActSnapshot({ ...job, intake }, company, {
      docNumber: act.number, docDate: act.at, acceptedBy: userName,
    }),
    [job, intake, company, act, userName],
  );

  async function printAct() {
    if (busy) return;
    setBusy(true);
    try {
      await flush();
      if (!act.number && jobId) {
        const issued = await api.jobs.ensureIntakeActNumber(jobId);
        // flushSync — чтобы свежий номер оказался в DOM до window.print().
        flushSync(() => {
          setAct(issued);
          applyLocal({ act_number: issued.number, act_date: issued.at });
        });
      }
    } catch {
      // Номер не выдался (нет связи — счётчику нужен сервер). Печатаем без него:
      // бумага с прочерком полезнее несостоявшейся печати у стоящего клиента.
      setSaveState('error');
    } finally {
      setBusy(false);
    }
    printFitted();
  }

  // ─── Завершение ────────────────────────────────────────────────────────────

  async function finish() {
    if (busy || !st.ready) return;
    setBusy(true);
    try {
      await flush();
      await api.jobs.finishInspection(jobId, true);
      applyLocal({ finished_at: Date.now() });
      setSaveState('saved');
      setAskAdvance(true);
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
      await api.jobs.finishInspection(jobId, false);
      applyLocal({ finished_at: 0 });
      setAskAdvance(false);
    } catch {
      setSaveState('error');
    } finally {
      setBusy(false);
    }
  }

  // Перевод в «Калькуляцию» — следующая колонка доски согласования. Приёмщик может
  // отказаться: бывает, что машину приняли, а в смету она пойдёт позже.
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
      setBusy(false);
    }
  }

  async function close() {
    await flush();
    onClose();
  }

  // ─── Шаги ──────────────────────────────────────────────────────────────────

  const step = INSPECTION_STEPS[stepIdx];
  const isLast = stepIdx === INSPECTION_STEPS.length - 1;
  const go = (i) => setStepIdx(Math.max(0, Math.min(INSPECTION_STEPS.length - 1, i)));

  const saveLabel = {
    idle: '', saving: 'Сохраняем…', saved: 'Сохранено', error: 'Не сохранено — повторим',
  }[saveState];

  return (
    <div className="modal-backdrop ins-backdrop" onClick={close}>
      <div className="ins-sheet" onClick={(e) => e.stopPropagation()}>

        <header className="ins-head">
          <button type="button" className="ins-x" onClick={close} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
          <div className="ins-id">
            {job?.plate_number && <span className="ink-plate">{job.plate_number}</span>}
            <span className="ink-model">{job?.car_model || 'Без модели'}</span>
          </div>
          <button type="button" className="ink-btn is-quiet" onClick={printAct} disabled={busy}>
            <Icon name="file" size={15} />Акт
          </button>
        </header>

        {/* Точки прогресса — они же навигация: приёмщик может вернуться и дописать */}
        <nav className="ins-steps">
          {INSPECTION_STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`ins-step${i === stepIdx ? ' is-current' : ''}${st.steps[s.id] ? ' is-done' : ''}`}
              onClick={() => go(i)}
            >
              <span className="ins-step-dot">{st.steps[s.id] ? <Icon name="check" size={11} strokeWidth={3} /> : i + 1}</span>
              <span className="ins-step-label">{s.label}</span>
            </button>
          ))}
        </nav>

        <div className={`ins-savebar is-${saveState}`}>
          <span className="ins-hint">{step.hint}</span>
          {st.photos.waiting > 0 && (
            <span className="ins-waiting" title="Снимки лежат в телефоне и уйдут, когда появится связь">
              <Icon name="image" size={13} />{st.photos.waiting} ждут отправки
            </span>
          )}
          {saveLabel && <span className="ins-save">{saveLabel}</span>}
          {saveState === 'error' && (
            <button type="button" className="ins-retry" onClick={flush}>Повторить</button>
          )}
        </div>

        <div className="ins-body">
          {step.id === 'car' && (
            <>
              <div className="ins-fields">
                <label className="ins-field is-big">
                  <span>Пробег, км<i> · обязательно</i></span>
                  <input
                    inputMode="numeric"
                    value={intake.mileage}
                    onChange={(e) => queue({ mileage: e.target.value })}
                    placeholder="124500"
                  />
                </label>
                <label className="ins-field">
                  <span>Ключей, комплектов</span>
                  <input
                    inputMode="numeric"
                    value={intake.keys}
                    onChange={(e) => queue({ keys: e.target.value })}
                    placeholder="1"
                  />
                </label>
              </div>
              <div className="ins-sub">Уровень топлива</div>
              <div className="ins-chips">
                {FUEL_LEVELS.map((f) => (
                  <Chip
                    key={f.id}
                    on={intake.fuel === f.id}
                    onToggle={() => queue({ fuel: intake.fuel === f.id ? '' : f.id })}
                  >
                    {f.label}
                  </Chip>
                ))}
              </div>
            </>
          )}

          {step.id === 'photos' && (
            <>
              {photoErr && <div className="ink-banner is-error"><Icon name="warning" size={15} />{photoErr}</div>}
              <div className="ins-slots">
                {st.slots.map((slot) => (
                  <div key={slot.id} className={`ins-slot${slot.required && !slot.count ? ' is-missing' : ''}${slot.count ? ' is-filled' : ''}`}>
                    <div className="ins-slot-head">
                      {slot.label}{slot.required && <i title="Обязательно">*</i>}
                      {slot.count > 1 && <span className="ins-slot-n">{slot.count}</span>}
                    </div>
                    <div className="ins-slot-body">
                      {slot.photos.map((p) => (
                        <div className={`ins-thumb${p.pending ? ' is-pending' : ''}`} key={p.id}>
                          <img src={p.url} alt={slot.label} loading="lazy" onClick={() => setViewer(p)} />
                          {p.pending && <span className="ins-thumb-badge" title="Ждёт отправки"><Icon name="clock" size={11} /></span>}
                          <button type="button" onClick={() => removePhoto(p)} aria-label="Удалить фото">
                            <Icon name="trash" size={12} strokeWidth={2} />
                          </button>
                        </div>
                      ))}
                      {/* Пока снимок готовится, плитка честно говорит об этом:
                          HEIC с айфона перекодируется несколько секунд, и молчащая
                          кнопка выглядела бы зависшей. */}
                      <label className={`ins-shoot${busySlot === slot.id ? ' is-busy' : ''}`}>
                        {busySlot === slot.id
                          ? <><span className="ins-spin" /><span>Готовим…</span></>
                          : <><Icon name="camera" size={20} /><span>Снять</span></>}
                        <input
                          type="file" accept="image/*" capture="environment" multiple hidden
                          disabled={busySlot != null}
                          onChange={(e) => addPhotos(e, slot.id)}
                        />
                      </label>
                      {/* Второй вход — из галереи: если связи не было и приёмщик
                          снимал штатной камерой, снимки надо просто выбрать. */}
                      <label className="ins-pick" title="Выбрать уже снятые фото из галереи телефона">
                        <Icon name="image" size={16} /><span>Галерея</span>
                        <input
                          type="file" accept="image/*" multiple hidden
                          disabled={busySlot != null}
                          onChange={(e) => addPhotos(e, slot.id)}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step.id === 'damages' && (
            <>
              {zoneGroups.map((g) => (
                <div key={g.group} className="ins-zone-group">
                  <div className="ins-sub">{g.group}</div>
                  <div className="ins-chips">
                    {g.zones.map((z) => (
                      <Chip key={z.id} on={damageByZone.has(z.id)} onToggle={() => toggleZone(z.id)} tone="damage">
                        {z.label}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}

              {intake.damages.length > 0 && (
                <div className="ins-damages">
                  <div className="ins-sub">Уточните каждое повреждение</div>
                  {intake.damages.map((d) => (
                    <div className="ins-damage" key={d.id || d.zone}>
                      <div className="ins-damage-top">
                        <span className="ins-damage-zone">{zoneLabel(d.zone)}</span>
                        <button type="button" className="ins-damage-del" onClick={() => toggleZone(d.zone)} aria-label="Убрать">
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                      <div className="ins-damage-row">
                        <select value={d.kind} onChange={(e) => patchDamage(d.zone, { kind: e.target.value })}>
                          {DAMAGE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                        </select>
                        {/* Отношение к случаю — то, за что платит страховая, и то,
                            что было на машине до аварии. Разделять надо здесь,
                            пока машина перед глазами. */}
                        <div className="ins-scope">
                          {DAMAGE_SCOPES.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              className={`ins-scope-btn${(d.scope || 'case') === s.id ? ' is-on' : ''} is-${s.id}`}
                              onClick={() => patchDamage(d.zone, { scope: s.id })}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        className="ins-damage-note"
                        value={d.note}
                        onChange={(e) => patchDamage(d.zone, { note: e.target.value })}
                        placeholder="Где именно, размер — по желанию"
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {step.id === 'handover' && (
            <>
              <div className="ins-sub">Документы <span className="ins-count">{intake.docs.length}</span></div>
              <div className="ins-chips">
                {DOC_ITEMS.map((d) => (
                  <Chip key={d.id} on={intake.docs.includes(d.id)} onToggle={() => toggleDoc(d.id)}>{d.label}</Chip>
                ))}
              </div>
              <div className="ins-sub">Комплектность <span className="ins-count">{intake.equipment.length}</span></div>
              <div className="ins-note-line">Отмечайте только то, что реально есть в машине. Непроверенное лучше не ставить.</div>
              <div className="ins-chips">
                {EQUIPMENT_ITEMS.map((it) => (
                  <Chip key={it.id} on={intake.equipment.includes(it.id)} onToggle={() => toggleEquip(it.id)}>{it.label}</Chip>
                ))}
              </div>
            </>
          )}

          {step.id === 'finish' && (
            <>
              <div className="ins-summary">
                <div className={`ins-sum${st.mileageMissing ? ' is-bad' : ''}`}>
                  <b>{intake.mileage || '—'}</b><span>пробег, км</span>
                </div>
                <div className={`ins-sum${st.photosMissing.length ? ' is-bad' : ''}`}>
                  <b>{st.photos.done}/{st.photos.total}</b><span>рубрик снято</span>
                </div>
                <div className="ins-sum">
                  <b>{st.damagesByScope.case}</b><span>по случаю</span>
                </div>
                <div className="ins-sum">
                  <b>{st.damagesByScope.old}</b><span>было раньше</span>
                </div>
                <div className="ins-sum">
                  <b>{intake.docs.length + intake.equipment.length}</b><span>принято позиций</span>
                </div>
              </div>

              {st.warnNoDamages && (
                <div className="ink-banner is-warn">
                  <Icon name="warning" size={15} />
                  Повреждений не отмечено. Если машина действительно целая — так и оставьте.
                </div>
              )}

              <label className="ins-field">
                <span>Примечание — всё, что не влезло в пункты выше</span>
                <textarea
                  rows={3}
                  value={intake.notes}
                  onChange={(e) => queue({ notes: e.target.value })}
                  placeholder="Машина не на ходу, особые пожелания клиента, договорённости"
                />
              </label>

              <button type="button" className="ink-btn" onClick={printAct} disabled={busy}>
                <Icon name="file" size={15} />
                {act.number ? `Печать акта ${act.number}` : 'Распечатать акт приёмки'}
              </button>
            </>
          )}
        </div>

        <footer className="ins-foot">
          {askAdvance || st.done ? (
            <div className="ins-ask">
              <div className="ins-ask-text">
                <b>Дефектовка завершена.</b> Перевести машину в «Калькуляцию»?
              </div>
              <div className="ins-ask-btns">
                <button type="button" className="ink-btn" onClick={reopen} disabled={busy}>Открыть заново</button>
                <button type="button" className="ink-btn is-primary" onClick={advance} disabled={busy}>Перевести →</button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="ink-btn"
                onClick={() => go(stepIdx - 1)}
                disabled={stepIdx === 0}
              >
                Назад
              </button>
              {isLast ? (
                <button
                  type="button"
                  className="ink-btn is-primary is-big"
                  onClick={finish}
                  disabled={!st.ready || busy}
                  title={st.ready ? '' : `Осталось: ${st.blockers.join(', ')}`}
                >
                  Завершить дефектовку
                </button>
              ) : (
                <button type="button" className="ink-btn is-primary is-big" onClick={() => go(stepIdx + 1)}>
                  Дальше →
                </button>
              )}
            </>
          )}
          {!st.ready && !st.done && (
            <div className="ins-blockers">Не хватает: {st.blockers.slice(0, 3).join(' · ')}{st.blockers.length > 3 ? ` · ещё ${st.blockers.length - 3}` : ''}</div>
          )}
        </footer>
      </div>

      {viewer && <PhotoViewer photo={viewer} onClose={() => setViewer(null)} alt="Фото дефектовки" />}

      {/* Печатный лист живёт вне модалки (портал в body) — так @media print видит
          его без наследования стилей окна. На экране он скрыт. */}
      {createPortal(<div id="zn-print-mount"><IntakeAct snapshot={snapshot} /></div>, document.body)}
    </div>
  );
}
