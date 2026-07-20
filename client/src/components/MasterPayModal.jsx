import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { uid } from '../orderDoc';
import { buildCosting } from '../costing';
import { buildPayRows, payRowsTotal, money } from '../salary';
import Icon from './Icon';

// «Оплата мастерам за эту машину» — простой экран, где управляющий вводит, сколько
// платит каждому мастеру за эту машину (сдельная). Открывается кнопкой с карточки
// авто; только для управленца (кнопка скрыта у остальных ролей).
//
// Единый источник суммы «за машину» — job.costing.labor: его же читают финансы и
// себестоимость, поэтому ввод здесь и «Оплата мастерам» в окне «Себестоимость» —
// одни и те же данные (там теперь только для чтения, чтобы не было двойного ввода).
// Если у машины ещё нет расчёта себестоимости, создаём его из заказ-наряда (как в
// окне «Себестоимость»), чтобы выручка тоже попала в расчёт.
export default function MasterPayModal({ job, onSaved, onClose }) {
  const jobId = job.id || job.job_id;
  const [masters, setMasters] = useState([]);
  const [docs, setDocs] = useState([]);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Грузим один раз на открытую машину (по стабильному id) — как в CostingModal,
  // чтобы живой ре-рендер job не затирал введённое. `prev ?? …` — второй страж.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [m, d] = await Promise.all([
        api.masters.list().catch(() => []),
        api.orderDocuments.listByJob(jobId, 'order').catch(() => []),
      ]);
      if (!alive) return;
      setMasters(m);
      setDocs(d);
      setRows((prev) => prev ?? buildPayRows(job, m));
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const total = useMemo(() => payRowsTotal(rows || []), [rows]);

  function update(id, fields) { setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...fields } : r))); setSaved(false); }
  function selectMaster(id, masterId) {
    const m = masters.find((x) => x.id === masterId);
    update(id, { master_id: masterId, name: m ? m.name : '' });
  }
  function addRow() { setRows((rs) => [...rs, { id: uid(), master_id: '', name: '', amount: 0 }]); setSaved(false); }
  function removeRow(id) { setRows((rs) => rs.filter((r) => r.id !== id)); setSaved(false); }

  async function save() {
    setSaving(true);
    try {
      // Оставляем только строки с выбранным мастером; сумму приводим к числу.
      const labor = rows
        .filter((r) => r.master_id)
        .map((r) => ({ id: r.id, master_id: r.master_id, name: r.name || '', amount: money(r.amount, 0) }));
      // Кладём оплату в costing: если расчёта ещё нет — создаём из заказ-наряда,
      // чтобы выручка тоже учлась (иначе машина уйдёт в финансы «в минус»).
      const base = job.costing || buildCosting(job, docs, masters);
      const costing = { ...base, labor, updated_at: Date.now() };
      await api.jobs.update(jobId, { costing });
      setSaved(true);
      if (onSaved) onSaved(costing);
    } catch {
      alert('Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal costing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cc-header">
          <div className="cc-header-main">
            <div className="cc-header-text">
              <div className="cc-doc-label">Оплата мастерам</div>
              <h3 className="cc-title">Оплата мастерам за машину</h3>
              <div className="cc-header-meta">
                <span className="cc-header-sub">
                  {job.car_model || 'Без модели'}{job.plate_number ? ` · ${job.plate_number}` : ''}
                </span>
              </div>
            </div>
          </div>
          <button className="cc-close" onClick={onClose} aria-label="Закрыть"><Icon name="x" size={18} strokeWidth={2} /></button>
        </div>

        {loading || !rows ? (
          <div className="cc-body"><div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div></div>
        ) : (
          <>
            <div className="cc-body">
              <p className="cc-hint" style={{ marginTop: 0 }}>
                Сколько платим мастеру за эту машину (сдельно). Мастера, назначенные на машину,
                уже в списке — впишите суммы. Эти суммы мастер увидит у себя в «Мой заработок».
              </p>
              <table className="items-table costing-table">
                <thead><tr><th>Мастер</th><th>Сумма за машину, ₽</th><th></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <select value={r.master_id} onChange={(e) => selectMaster(r.id, e.target.value)}>
                          <option value="">— выберите мастера —</option>
                          {r.master_id && r.name && !masters.some((m) => m.id === r.master_id) && (
                            <option value={r.master_id}>{r.name}</option>
                          )}
                          {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number" min="0" inputMode="numeric" className="costing-input"
                          value={r.amount} onChange={(e) => update(r.id, { amount: e.target.value })}
                        />
                      </td>
                      <td><button className="danger small" onClick={() => removeRow(r.id)} aria-label="Убрать">×</button></td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={3}><div className="cc-hint">Мастеров пока нет — добавьте ниже.</div></td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr><td>Итого за машину</td><td className="costing-num"><b>{money(total)}</b></td><td></td></tr>
                </tfoot>
              </table>
              <button onClick={addRow}>+ Добавить мастера</button>
            </div>

            <div className="cc-footer">
              <button onClick={onClose}>Закрыть</button>
              <div className="cc-footer-actions">
                {saved && <span className="oe-saved">Сохранено ✓</span>}
                <button className="primary" disabled={saving} onClick={save}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
