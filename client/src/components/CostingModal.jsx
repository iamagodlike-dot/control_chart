import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { money, uid } from '../orderDoc';
import { buildCosting, computeCosting } from '../costing';
import MasterWorksheetModal from './MasterWorksheet';
import { buildWorksheet } from '../worksheet';
import Icon from './Icon';

// Internal repair-cost / profit editor for one car. Reads the latest заказ-наряд
// to seed works & parts (no double entry), lets the shop fill purchase prices,
// сдельную оплату мастерам and накладные, and shows profit + margin live.
// Saved onto the job (job.costing) — never touches client documents.
export default function CostingModal({ job, onClose, onSaved }) {
  const jobId = job.id || job.job_id;
  const [costing, setCosting] = useState(null);
  const [settings, setSettings] = useState({});
  const [masters, setMasters] = useState([]);
  const [latestDocs, setLatestDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reseeded, setReseeded] = useState(false);
  const [worksheet, setWorksheet] = useState(null);

  // Load once per opened car, keyed on the STABLE job id — never on the whole
  // `job` object. The parent (CarCard/Gantt) hands us a fresh job object on every
  // render (clock tick, live Firestore push), and depending on it here would
  // re-run this effect and wipe whatever the user is typing. `prev ?? …` is a
  // second guard: seed the state only when it is still empty, so an in-progress
  // draft is never overwritten.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [company, docs, mastersList] = await Promise.all([
        api.settings.getCompany().catch(() => ({})),
        api.orderDocuments.listByJob(jobId, 'order').catch(() => []),
        api.masters.list().catch(() => []),
      ]);
      if (!alive) return;
      setSettings(company);
      setMasters(mastersList);
      setLatestDocs(docs);
      // Use the saved costing if present; otherwise seed a fresh one from the ЗН.
      setCosting((prev) => prev ?? (job.costing || buildCosting(job, docs, mastersList)));
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const totals = useMemo(() => (costing ? computeCosting(costing, settings) : null), [costing, settings]);

  function patch(fields) {
    setCosting((c) => ({ ...c, ...fields }));
    setSaved(false);
  }
  function updatePart(id, fields) {
    patch({ parts: costing.parts.map((p) => (p.id === id ? { ...p, ...fields } : p)) });
  }
  function updateLabor(id, fields) {
    patch({ labor: costing.labor.map((l) => (l.id === id ? { ...l, ...(typeof fields === 'function' ? fields(l) : fields) } : l)) });
  }
  function addLabor() {
    patch({ labor: [...costing.labor, { id: uid(), master_id: '', name: '', pct: 0, amount: 0 }] });
  }
  function removeLabor(id) {
    patch({ labor: costing.labor.filter((l) => l.id !== id) });
  }
  function selectLaborMaster(id, masterId) {
    const m = masters.find((x) => x.id === masterId);
    // При выборе мастера подставляем его сдельный % из справочника, если в
    // строке процент ещё не введён.
    updateLabor(id, (l) => ({
      master_id: masterId,
      name: m ? m.name : '',
      pct: Number(l.pct) > 0 ? l.pct : (Number(m?.rate_pct) || 0),
    }));
  }

  // Назначить работу мастеру (наряд). Если строки оплаты для этого мастера ещё
  // нет — добавляем её автоматически с процентом из справочника.
  function assignWorkMaster(serviceId, masterId) {
    setCosting((c) => {
      const services = (c.services || []).map((s) => (s.id === serviceId ? { ...s, master_id: masterId } : s));
      let labor = c.labor;
      if (masterId && !labor.some((l) => l.master_id === masterId)) {
        const m = masters.find((x) => x.id === masterId);
        labor = [...labor, { id: uid(), master_id: masterId, name: m?.name || '', pct: Number(m?.rate_pct) || 0, amount: 0 }];
      }
      return { ...c, services, labor };
    });
    setSaved(false);
  }

  function openWorksheet(laborRow) {
    setWorksheet(buildWorksheet(job, settings, laborRow, costing.services || []));
  }

  // Re-pull works & parts from the latest заказ-наряд, keeping purchase prices
  // and labour already entered.
  function reseedFromOrder() {
    if (!window.confirm('Обновить список работ и запчастей из последнего заказ-наряда? Введённые закупочные цены и оплата мастерам сохранятся.')) return;
    setCosting((c) => buildCosting(job, latestDocs, masters, c));
    setReseeded(true);
    setSaved(false);
    setTimeout(() => setReseeded(false), 2500);
  }

  async function save() {
    setSaving(true);
    try {
      const n = (v) => Number(v) || 0;
      const payload = {
        ...costing,
        services: (costing.services || []).map((s) => ({ ...s, qty: n(s.qty), price: n(s.price), master_id: s.master_id || '' })),
        parts: costing.parts.map((p) => ({ ...p, qty: n(p.qty), price: n(p.price), cost: n(p.cost) })),
        labor: costing.labor.map((l) => ({ ...l, pct: n(l.pct), amount: n(l.amount) })),
        materials: costing.materials == null ? null : n(costing.materials),
        overhead: costing.overhead == null ? null : n(costing.overhead),
        updated_at: Date.now(),
      };
      await api.jobs.update(jobId, { costing: payload });
      setCosting(payload);
      setSaved(true);
      if (onSaved) onSaved(payload);
    } catch {
      alert('Не удалось сохранить расчёт. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  const materials_pct = Number(settings.materials_pct ?? 15);
  const overhead_pct = Number(settings.overhead_pct ?? 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide costing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cc-header">
          <div className="cc-header-main">
            <div className="cc-header-text">
              <div className="cc-doc-label">Себестоимость</div>
              <h3 className="cc-title">Себестоимость ремонта</h3>
              <div className="cc-header-meta">
                <span className="cc-header-sub">
                  {job.car_model || 'Без модели'}{job.plate_number ? ` · ${job.plate_number}` : ''}
                </span>
              </div>
            </div>
          </div>
          <button className="cc-close" onClick={onClose} aria-label="Закрыть"><Icon name="x" size={18} strokeWidth={2} /></button>
        </div>

        {loading || !costing || !totals ? (
          <div className="cc-body"><div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div></div>
        ) : (
          <>
            <div className="cc-body">
              {costing.source === 'job' && !(costing.parts.length || costing.services_sum) && (
                <div className="cc-hint" style={{ marginBottom: 8 }}>
                  Заказ-наряд ещё не оформлен и позиций нет — расчёт будет пустым. Сначала оформите заказ-наряд в «Документы».
                </div>
              )}
              <div className="costing-source">
                Основа расчёта: {costing.source === 'order'
                  ? <b>заказ-наряд{costing.source_number ? ` № ${costing.source_number}` : ''}</b>
                  : <b>данные машины</b>}
                <button className="small" onClick={reseedFromOrder}>↻ Обновить из заказ-наряда</button>
                {reseeded && <span className="oe-saved">Обновлено ✓</span>}
              </div>

              {/* ЗАПЧАСТИ */}
              <section className="oe-section">
                <h4>Запчасти — закупка</h4>
                {costing.parts.length === 0 ? (
                  <div className="cc-hint">Запчастей в заказ-наряде нет.</div>
                ) : (
                  <table className="items-table costing-table">
                    <thead>
                      <tr><th>Наименование</th><th>Кол-во</th><th>Продажа</th><th>Закупка (за ед.)</th><th>Прибыль</th></tr>
                    </thead>
                    <tbody>
                      {costing.parts.map((p) => {
                        const rowProfit = (Number(p.qty) || 0) * ((Number(p.price) || 0) - (Number(p.cost) || 0));
                        return (
                          <tr key={p.id}>
                            <td>{p.name || '—'}{p.code ? <span className="costing-code"> · {p.code}</span> : ''}</td>
                            <td className="costing-num">{p.qty} {p.unit || 'шт.'}</td>
                            <td className="costing-num">{money((Number(p.qty) || 0) * (Number(p.price) || 0))}</td>
                            <td>
                              <input
                                type="number" min="0" className="costing-input"
                                value={p.cost} onChange={(e) => updatePart(p.id, { cost: e.target.value })}
                              />
                            </td>
                            <td className={`costing-num ${rowProfit < 0 ? 'is-loss' : 'is-gain'}`}>{money(rowProfit)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}>Итого закупка запчастей</td>
                        <td className="costing-num">{money(totals.parts_sale)}</td>
                        <td className="costing-num"><b>{money(totals.parts_cost)}</b></td>
                        <td className={`costing-num ${totals.parts_sale - totals.parts_cost < 0 ? 'is-loss' : 'is-gain'}`}>
                          {money(totals.parts_sale - totals.parts_cost)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </section>

              {/* НАРЯДЫ: РАБОТЫ ПО МАСТЕРАМ */}
              <section className="oe-section">
                <h4>Наряды — кто выполняет работы</h4>
                {(costing.services || []).length === 0 ? (
                  <div className="cc-hint">
                    {costing.source === 'order'
                      ? 'В этом расчёте ещё нет списка работ — нажмите «Обновить из заказ-наряда» выше, чтобы распределить работы по мастерам.'
                      : 'Работ в заказ-наряде нет.'}
                  </div>
                ) : (
                  <table className="items-table costing-table">
                    <thead><tr><th>Работа</th><th>Сумма</th><th>Мастер</th></tr></thead>
                    <tbody>
                      {costing.services.map((s) => (
                        <tr key={s.id}>
                          <td>{s.name || '—'}</td>
                          <td className="costing-num">{money((Number(s.qty) || 0) * (Number(s.price) || 0))}</td>
                          <td>
                            <select value={s.master_id || ''} onChange={(e) => assignWorkMaster(s.id, e.target.value)}>
                              <option value="">— не назначен —</option>
                              {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              {/* ОПЛАТА МАСТЕРАМ */}
              <section className="oe-section">
                <h4>Оплата мастерам (сдельно)</h4>
                <div className="cc-hint">Сдельно = сумма работ мастера × его %. Доплата — ручная сумма сверх сдельной (или вся оплата, если работы не распределены).</div>
                <table className="items-table costing-table">
                  <thead><tr><th>Мастер</th><th>Работы</th><th>%</th><th>Сдельно</th><th>Доплата</th><th>Итого</th><th></th></tr></thead>
                  <tbody>
                    {totals.labor_rows.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <select value={l.master_id} onChange={(e) => selectLaborMaster(l.id, e.target.value)}>
                            <option value="">— выберите мастера —</option>
                            {l.master_id && l.name && !masters.some((m) => m.id === l.master_id) && (
                              <option value={l.master_id}>{l.name}</option>
                            )}
                            {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </td>
                        <td className="costing-num">{money(l.works_sum)}</td>
                        <td>
                          <input
                            type="number" min="0" max="100" className="costing-input costing-input-pct"
                            value={l.pct} onChange={(e) => updateLabor(l.id, { pct: e.target.value })}
                          />
                        </td>
                        <td className="costing-num">{money(l.piece)}</td>
                        <td>
                          <input
                            type="number" min="0" className="costing-input"
                            value={l.amount} onChange={(e) => updateLabor(l.id, { amount: e.target.value })}
                          />
                        </td>
                        <td className="costing-num"><b>{money(l.total)}</b></td>
                        <td className="costing-row-actions">
                          <button
                            className="small" title="Наряд мастера — предпросмотр и печать"
                            disabled={!l.master_id}
                            onClick={() => openWorksheet(l)}
                          >
                            Наряд
                          </button>
                          <button className="danger small" onClick={() => removeLabor(l.id)}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={5}>Итого оплата мастерам</td><td className="costing-num"><b>{money(totals.labor_cost)}</b></td><td></td></tr>
                  </tfoot>
                </table>
                <button onClick={addLabor}>+ Добавить мастера</button>
              </section>

              {/* МАТЕРИАЛЫ + НАКЛАДНЫЕ */}
              <section className="oe-section">
                <h4>Материалы и накладные</h4>
                <div className="costing-fields">
                  <label className="cc-field">
                    <span>Материалы, ₽ {totals.materials_is_auto && <i>(авто: {materials_pct}% от работ)</i>}</span>
                    <div className="costing-auto-row">
                      <input
                        type="number" min="0" className="costing-input"
                        value={totals.materials_cost}
                        onChange={(e) => patch({ materials: Number(e.target.value) || 0 })}
                      />
                      {!totals.materials_is_auto && (
                        <button className="small" onClick={() => patch({ materials: null })}>авто</button>
                      )}
                    </div>
                  </label>
                  <label className="cc-field">
                    <span>Накладные, ₽ {totals.overhead_is_auto && <i>(авто: {overhead_pct}% от выручки)</i>}</span>
                    <div className="costing-auto-row">
                      <input
                        type="number" min="0" className="costing-input"
                        value={totals.overhead_cost}
                        onChange={(e) => patch({ overhead: Number(e.target.value) || 0 })}
                      />
                      {!totals.overhead_is_auto && (
                        <button className="small" onClick={() => patch({ overhead: null })}>авто</button>
                      )}
                    </div>
                  </label>
                </div>
              </section>

              {/* ИТОГ */}
              <section className="costing-summary">
                <div className="costing-summary-row">
                  <span>Выручка</span>
                  <span className="costing-summary-val">{money(totals.revenue)}</span>
                </div>
                <div className="costing-breakdown">
                  <span>− Запчасти {money(totals.parts_cost)}</span>
                  <span>− Материалы {money(totals.materials_cost)}</span>
                  <span>− Мастера {money(totals.labor_cost)}</span>
                  <span>− Накладные {money(totals.overhead_cost)}</span>
                </div>
                <div className="costing-summary-row">
                  <span>Себестоимость</span>
                  <span className="costing-summary-val">{money(totals.cost_total)}</span>
                </div>
                <div className={`costing-summary-row is-total ${totals.profit < 0 ? 'is-loss' : 'is-gain'}`}>
                  <span>Прибыль</span>
                  <span className="costing-summary-val">{money(totals.profit)} · {totals.margin_pct}%</span>
                </div>
              </section>
            </div>

            <div className="cc-footer">
              <button onClick={onClose}>Закрыть</button>
              <div className="cc-footer-actions">
                {saved && <span className="oe-saved">Сохранено ✓</span>}
                <button className="primary" disabled={saving} onClick={save}>{saving ? 'Сохраняем…' : 'Сохранить расчёт'}</button>
              </div>
            </div>
          </>
        )}

        {worksheet && <MasterWorksheetModal sheet={worksheet} onClose={() => setWorksheet(null)} />}
      </div>
    </div>
  );
}
