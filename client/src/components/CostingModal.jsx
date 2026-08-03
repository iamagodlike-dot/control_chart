import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { money } from '../orderDoc';
import { buildCosting, computeCosting } from '../costing';
import { useModalEscape } from '../modalEscape';
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

  // Costing is seeded from the заказ-наряд once, then independent. If the order was
  // edited later (its timestamp is newer than this saved costing), flag it as stale
  // so the owner knows to press «Обновить из заказ-наряда» before trusting the profit.
  const isStale = useMemo(() => {
    if (!costing?.updated_at) return false;
    const latestOrderTs = (latestDocs || [])
      .filter((d) => d.type === 'order')
      .reduce((mx, d) => Math.max(mx, d.updated_at || d.created_at || 0), 0);
    return latestOrderTs > costing.updated_at;
  }, [costing, latestDocs]);

  function patch(fields) {
    setCosting((c) => ({ ...c, ...fields }));
    setSaved(false);
  }
  function updatePart(id, fields) {
    patch({ parts: costing.parts.map((p) => (p.id === id ? { ...p, ...fields } : p)) });
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
        parts: costing.parts.map((p) => ({ ...p, qty: n(p.qty), price: n(p.price), cost: n(p.cost) })),
        labor: costing.labor.map((l) => ({ ...l, amount: n(l.amount) })),
        materials: costing.materials == null ? null : n(costing.materials),
        overhead: costing.overhead == null ? null : n(costing.overhead),
        // Freeze the auto-% at the moment of calculation, ONCE — so a later change to the
        // global % never moves this car's numbers. Preserve an existing snapshot on re-save.
        materials_pct: costing.materials_pct != null ? costing.materials_pct : Number(settings.materials_pct ?? 15),
        overhead_pct: costing.overhead_pct != null ? costing.overhead_pct : Number(settings.overhead_pct ?? 0),
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

  // Show this car's frozen % if it has one, else the current global — matches what
  // computeCosting actually uses for the «(авто: X%)» hints.
  const materials_pct = Number(costing?.materials_pct ?? settings.materials_pct ?? 15);
  const overhead_pct = Number(costing?.overhead_pct ?? settings.overhead_pct ?? 0);

  // Клик мимо окна не закрывает: нативные списки на телефоне отдают странице
  // сквозной клик, и наполовину заполненная форма пропадала (см. modalEscape).
  const backdropRef = useModalEscape(onClose);

  return (
    <div className="modal-backdrop" ref={backdropRef}>
      <div className="modal modal-wide costing-modal">
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
              {isStale && !reseeded && (
                <div className="cc-hint" style={{ marginTop: 8, color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="warning" size={13} /> Заказ-наряд менялся после этого расчёта — обновите, чтобы подтянуть свежие работы и запчасти.
                </div>
              )}

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

              {/* ОПЛАТА МАСТЕРАМ — только для справки; задаётся на карточке машины */}
              <section className="oe-section">
                <h4>Оплата мастерам (сдельно)</h4>
                <p className="cc-hint" style={{ marginTop: 0 }}>
                  Задаётся на карточке машины — кнопка «Наряд мастерам»: там у каждой работы своя
                  реальная цена и свой исполнитель. Здесь показано для справки (входит в себестоимость).
                </p>
                {/* Прячем секцию, только если труда действительно нет. Наряд, где цены
                    проставлены, а исполнители ещё не выбраны, даёт пустой labor при
                    ненулевом labor_cost — тогда таблицу надо показать, иначе «− Мастера»
                    в сводке возьмётся из ниоткуда. */}
                {costing.labor.filter((l) => l.master_id || Number(l.amount)).length === 0 && !totals.labor_cost ? (
                  <div className="cc-hint">Оплата мастерам ещё не задана.</div>
                ) : (
                  <table className="items-table costing-table">
                    <thead><tr><th>Мастер</th><th>Сумма за машину</th></tr></thead>
                    <tbody>
                      {costing.labor.filter((l) => l.master_id || Number(l.amount)).map((l) => (
                        <tr key={l.id}>
                          <td>{l.name || '—'}</td>
                          <td className="costing-num">{money(l.amount)}</td>
                        </tr>
                      ))}
                      {/* Работы наряда без исполнителя: в себестоимость входят, в ЗП — нет. */}
                      {totals.works_unassigned > 0 && (
                        <tr>
                          <td>Не распределено по мастерам</td>
                          <td className="costing-num">{money(totals.works_unassigned)}</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr><td>Итого оплата мастерам</td><td className="costing-num"><b>{money(totals.labor_cost)}</b></td></tr>
                    </tfoot>
                  </table>
                )}
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
      </div>
    </div>
  );
}
