import { useEffect, useMemo, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { api } from '../api';
import { uid, money as rub } from '../orderDoc';
import { buildCosting } from '../costing';
import { buildWorks, laborFromWorks, worksTotals, buildMasterOrderSheets, normalizeWork, newWork } from '../masterOrder';
import { printFitted } from '../printDoc';
import { useModalEscape } from '../modalEscape';
import MasterOrderSheets from './MasterOrderSheet';
import Icon from './Icon';
import '../masterOrder.css';

// «Наряд мастерам» — экран, где работы заказ-наряда получают РЕАЛЬНУЮ цену и
// конкретного мастера. Цена работы = заработок мастера за неё, поэтому отсюда же
// печатается наряд-задание и считается зарплата. Открывается с карточки авто,
// только у управленца.
//
// Наружу (клиенту/страховой) эти цены НЕ уходят: живут в job.costing.works,
// печатные документы их не видят. Строки оплаты job.costing.labor — производные,
// пересобираются при каждом сохранении (их читают финансы и кабинет мастера).

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export default function MasterOrderModal({ job, onSaved, onClose }) {
  const jobId = job.id || job.job_id;
  const [masters, setMasters] = useState([]);
  const [docs, setDocs] = useState([]);
  const [company, setCompany] = useState({});
  const [works, setWorks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Грузим один раз на открытую машину (по стабильному id) — как в CostingModal:
  // живой ре-рендер карточки (тик часов / пуш из Firestore) не должен затирать ввод.
  // `prev ?? …` — второй страж на тот же случай.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [m, d, c] = await Promise.all([
        api.masters.list().catch(() => []),
        api.orderDocuments.listByJob(jobId, 'order').catch(() => []),
        api.settings.getCompany().catch(() => ({})),
      ]);
      if (!alive) return;
      setMasters(m || []);
      setDocs(d || []);
      setCompany(c || {});
      // Уже расписанный наряд — источник истины; если его нет, сидируем из
      // заказ-наряда (реальная цена стартует с цены ЗН — её и правят).
      setWorks((prev) => prev ?? (
        Array.isArray(job.costing?.works) && job.costing.works.length
          ? job.costing.works.map(normalizeWork)
          : buildWorks(job, d || [], job.costing?.works || [])
      ));
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const totals = useMemo(() => worksTotals(works || []), [works]);
  // Оплата, введённая старым окном одной суммой на мастера (у машин без наряда).
  // Её заменит расчёт по работам — предупреждаем об этом на экране и при сохранении.
  const legacyPay = useMemo(() => {
    if ((job.costing?.works || []).length) return 0;
    return Math.round((job.costing?.labor || []).reduce((s, l) => s + num(l.amount, 0), 0));
  }, [job.costing]);
  const sheets = useMemo(
    () => buildMasterOrderSheets(job, works || [], company),
    [job, works, company],
  );

  function touch() { setDirty(true); setSaved(false); }
  function update(id, fields) {
    setWorks((ws) => ws.map((w) => (w.id === id ? { ...w, ...fields } : w)));
    touch();
  }
  function selectMaster(id, masterId) {
    const m = masters.find((x) => x.id === masterId);
    update(id, { master_id: masterId, master_name: masterId ? (m?.name || '') : '' });
  }
  function addRow() {
    setWorks((ws) => [...ws, newWork({ id: uid() })]);
    touch();
  }
  function removeRow(id) {
    setWorks((ws) => ws.filter((w) => w.id !== id));
    touch();
  }
  // Пересид из свежего заказ-наряда: введённые цены и назначения переносятся на
  // одноимённые работы, ручные строки остаются (см. buildWorks).
  function reseed() {
    setWorks((ws) => buildWorks(job, docs, ws || []));
    touch();
  }

  async function save() {
    // Пустые заготовки (без названия и цены) не сохраняем.
    const clean = (works || [])
      .map(normalizeWork)
      .filter((w) => w.name.trim() || w.price || w.master_id);
    const labor = laborFromWorks(clean);
    // Старая машина: оплата мастерам задана прежним окном одной суммой и лежит в
    // costing.labor. Сохранение пересоберёт labor из работ — вернуть прежнюю сумму
    // будет неоткуда, поэтому спрашиваем. После первого сохранения works есть, и
    // вопрос больше не возникает.
    if (legacyPay > 0) {
      const next = labor.reduce((s, l) => s + l.amount, 0);
      const ok = window.confirm(
        `По этой машине уже задана оплата мастерам — ${rub(legacyPay)}. Она будет заменена расчётом по наряду (${rub(next)}). Продолжить?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      // Если расчёта себестоимости ещё нет — создаём из заказ-наряда, чтобы выручка
      // тоже учлась (иначе машина уйдёт в финансы «в минус»).
      const base = job.costing || buildCosting(job, docs, masters);
      const costing = { ...base, works: clean, labor, updated_at: Date.now() };
      await api.jobs.update(jobId, { costing });
      setWorks(clean);
      setDirty(false);
      setSaved(true);
      if (onSaved) onSaved(costing);
    } catch {
      alert('Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  // Печать: лист на каждого мастера. Портал монтируем только на время печати —
  // иначе два узла #zn-print-mount (наш и окна документов) напечатались бы разом.
  function print() {
    if (!sheets.length) {
      alert('Печатать нечего: ни одна работа не назначена мастеру.');
      return;
    }
    flushSync(() => setPrinting(true));
    printFitted();
    const done = () => {
      setPrinting(false);
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setTimeout(done, 2000);
  }

  function close() {
    if (dirty && !window.confirm('Наряд изменён, но не сохранён. Закрыть без сохранения?')) return;
    onClose();
  }

  const backdropRef = useModalEscape(close);

  return (
    <div className="modal-backdrop" ref={backdropRef}>
      <div className="modal mo-modal">
        <div className="cc-header">
          <div className="cc-header-main">
            <div className="cc-header-text">
              <div className="cc-doc-label">Наряд мастерам</div>
              <h3 className="cc-title">Работы и оплата мастерам</h3>
              <div className="cc-header-meta">
                <span className="cc-header-sub">
                  {job.car_model || 'Без модели'}{job.plate_number ? ` · ${job.plate_number}` : ''}
                </span>
              </div>
            </div>
          </div>
          <button className="cc-close" onClick={close} aria-label="Закрыть"><Icon name="x" size={18} strokeWidth={2} /></button>
        </div>

        {loading || !works ? (
          <div className="cc-body"><div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div></div>
        ) : (
          <>
            <div className="cc-body">
              <p className="cc-hint mo-hint" style={{ marginTop: 0 }}>
                Работы взяты из заказ-наряда. Поставьте <b>реальную цену</b> — столько мастер
                и заработает на этой работе, — и выберите, кто её делает. Можно дописать работы
                сверх заказ-наряда. Клиенту и страховой эти цены не показываются.
              </p>

              {legacyPay > 0 && (
                <div className="mo-legacy">
                  По этой машине оплата мастерам уже задана одной суммой — <b>{rub(legacyPay)}</b>.
                  Когда сохраните наряд, она будет заменена суммой расписанных работ.
                </div>
              )}

              <div className="costing-source">
                <span>Источник: <b>{docs.length ? 'заказ-наряд' : 'позиции карточки'}</b></span>
                <button onClick={reseed} title="Подтянуть свежие работы из заказ-наряда, сохранив введённые цены и мастеров">
                  <Icon name="refresh" size={14} /> Обновить из заказ-наряда
                </button>
              </div>

              <div className="mo-items">
                <div className="mo-head">
                  <span>Работа</span>
                  <span>Кол-во</span>
                  <span>Цена, ₽</span>
                  <span>Мастер</span>
                  <span>Цена в ЗН</span>
                  <span />
                </div>

                {works.map((w) => (
                  <div key={w.id} className={`mo-row${w.from_order ? '' : ' is-extra'}`}>
                    <div className="mo-cell mo-cell-name">
                      <span className="mo-cell-label">Работа</span>
                      <input
                        className="mo-in" type="text" value={w.name}
                        placeholder="Наименование работы"
                        onChange={(e) => update(w.id, { name: e.target.value })}
                      />
                    </div>
                    {/* В state держим СЫРУЮ строку (как везде в проекте): у
                        <input type="number"> промежуточное «1.» отдаёт '', и
                        приведение к числу на каждом нажатии затирало бы поле нулём —
                        дробное кол-во стало бы не набрать. К числам приводим при
                        сохранении (normalizeWork). */}
                    <div className="mo-cell">
                      <span className="mo-cell-label">Кол-во</span>
                      <input
                        className="mo-in is-num" type="number" min="0" step="0.1" inputMode="decimal"
                        value={w.qty} onChange={(e) => update(w.id, { qty: e.target.value })}
                      />
                    </div>
                    <div className="mo-cell">
                      <span className="mo-cell-label">Реальная цена, ₽</span>
                      <input
                        className="mo-in is-num" type="number" min="0" inputMode="numeric"
                        value={w.price} onChange={(e) => update(w.id, { price: e.target.value })}
                      />
                    </div>
                    <div className="mo-cell mo-cell-master">
                      <span className="mo-cell-label">Мастер</span>
                      <select className="mo-in" value={w.master_id} onChange={(e) => selectMaster(w.id, e.target.value)}>
                        <option value="">— не распределено —</option>
                        {/* Мастера могли удалить из справочника — показываем сохранённое имя. */}
                        {w.master_id && w.master_name && !masters.some((m) => m.id === w.master_id) && (
                          <option value={w.master_id}>{w.master_name} (недоступен)</option>
                        )}
                        {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <div className="mo-cell">
                      <span className="mo-cell-label">Цена в заказ-наряде</span>
                      <div className={`mo-ref${w.from_order && num(w.price, 0) !== w.order_price ? ' is-diff' : ''}`}>
                        {w.from_order ? rub(w.order_price) : 'сверх ЗН'}
                      </div>
                    </div>
                    <button className="danger small mo-del" onClick={() => removeRow(w.id)} aria-label="Убрать работу">×</button>
                  </div>
                ))}

                {!works.length && (
                  <div className="cc-hint">Работ пока нет — добавьте вручную или обновите из заказ-наряда.</div>
                )}
              </div>

              <button className="mo-add" onClick={addRow}><Icon name="plus" size={14} /> Добавить работу</button>

              <div className="mo-summary">
                <div className="mo-summary-row">
                  <span>Итого работ по наряду</span>
                  <span className="mo-summary-val">{rub(totals.sum)}</span>
                </div>
                <div className="mo-chips">
                  {totals.byMaster.map((m) => (
                    <span key={m.master_id} className="mo-chip">
                      {m.name} <small>· {m.count} раб.</small> <b>{rub(m.sum)}</b>
                    </span>
                  ))}
                  {totals.unassigned > 0 && (
                    <span className="mo-chip is-warn">Не распределено <b>{rub(totals.unassigned)}</b></span>
                  )}
                  {!totals.byMaster.length && !totals.unassigned && (
                    <span className="cc-hint">Назначьте мастеров — из этих сумм считается их зарплата.</span>
                  )}
                </div>
              </div>

              {preview && (
                <div className="mo-preview">
                  {sheets.length
                    ? <div style={{ zoom: 0.55, display: 'inline-block' }}><MasterOrderSheets sheets={sheets} /></div>
                    : <div className="cc-hint">Наряд печатается по мастеру — сначала назначьте исполнителей.</div>}
                </div>
              )}
            </div>

            <div className="cc-footer">
              <button onClick={close}>Закрыть</button>
              <div className="cc-footer-actions">
                {saved && <span className="oe-saved">Сохранено ✓</span>}
                <button onClick={() => setPreview((v) => !v)}>{preview ? 'Скрыть наряд' : 'Показать наряд'}</button>
                <button onClick={print}>🖨 Печать наряда</button>
                <button className="primary" disabled={saving} onClick={save}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
              </div>
            </div>
          </>
        )}
      </div>

      {printing && createPortal(<div id="zn-print-mount"><MasterOrderSheets sheets={sheets} /></div>, document.body)}
    </div>
  );
}
