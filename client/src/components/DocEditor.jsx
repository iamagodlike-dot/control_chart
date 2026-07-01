import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { api } from '../api';
import DocSheet from './DocSheet';
import {
  buildActSnapshot, buildInvoiceSnapshot, buildHandoverSnapshot, pickSeedItems,
  computeDocTotals, buildPaymentQrString, qrIsComplete, uid, money, lineTotal,
  formatDocDate, DEFAULT_ACT_TEXT, DEFAULT_WARRANTY, DEFAULT_INVOICE_NOTE, DEFAULT_HANDOVER_TEXT,
} from '../orderDoc';
import '../orderDoc.css';

const A4_WIDTH_PX = 794;

function buildInitial(type, job, company) {
  if (type === 'act') return buildActSnapshot(job, company);
  if (type === 'invoice') return buildInvoiceSnapshot(job, company);
  return buildHandoverSnapshot(job, company);
}

function seedFromExisting(existingDoc) {
  const { id, created_at, updated_at, created_by, ...rest } = existingDoc; // eslint-disable-line no-unused-vars
  return rest;
}

export default function DocEditor({ type, job, company, onClose }) {
  const [snapshot, setSnapshot] = useState(() => buildInitial(type, job, company));
  const [docId, setDocId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [scale, setScale] = useState(0.6);
  const [history, setHistory] = useState([]);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const paneRef = useRef(null);
  const touchedRef = useRef(false);

  const isAct = type === 'act';
  const isInvoice = type === 'invoice';
  const isHandover = type === 'handover';
  const hasItems = isAct || isInvoice;

  // Fit A4 preview to pane width.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return undefined;
    const fit = () => setScale(Math.max(0.25, Math.min(1, (pane.clientWidth - 32) / A4_WIDTH_PX)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(pane);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { const img = new Image(); img.src = '/logo-mark.png'; }, []);

  async function refresh() {
    if (!job?.id) return [];
    try {
      const all = await api.orderDocuments.listByJob(job.id);
      setHistory(all.filter((d) => d.type === type));
      return all;
    } catch {
      setHistory([]);
      return [];
    }
  }

  // On mount: load history and (act/invoice) seed items from the last заказ-наряд.
  useEffect(() => {
    (async () => {
      const all = await refresh();
      if (hasItems && !touchedRef.current) {
        const seed = pickSeedItems(job, all);
        if (seed.source === 'order') {
          setSnapshot((s) => (touchedRef.current ? s : (isAct ? buildActSnapshot(job, company, seed) : buildInvoiceSnapshot(job, company, seed))));
        }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Regenerate the payment QR for the счёт whenever the snapshot changes.
  // (DocSheet only shows it when show_qr, so no need to clear it here.)
  useEffect(() => {
    if (!isInvoice || !snapshot.show_qr) return undefined;
    let cancelled = false;
    QRCode.toDataURL(buildPaymentQrString(snapshot), { margin: 1, width: 256 })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(''); });
    return () => { cancelled = true; };
  }, [isInvoice, snapshot]);

  function patch(fields) { touchedRef.current = true; setSnapshot((s) => ({ ...s, ...fields })); setSaved(false); }
  function patchGroup(group, fields) { touchedRef.current = true; setSnapshot((s) => ({ ...s, [group]: { ...s[group], ...fields } })); setSaved(false); }
  function patchBank(fields) { touchedRef.current = true; setSnapshot((s) => ({ ...s, company: { ...s.company, bank: { ...(s.company.bank || {}), ...fields } } })); setSaved(false); }

  function addService() { patch({ services: [...(snapshot.services || []), { id: uid(), name: '', qty: 1, price: 0 }] }); }
  function updateService(id, f) { patch({ services: snapshot.services.map((s) => (s.id === id ? { ...s, ...f } : s)) }); }
  function removeService(id) { patch({ services: snapshot.services.filter((s) => s.id !== id) }); }
  function addPart() { patch({ parts: [...(snapshot.parts || []), { id: uid(), code: '', name: '', qty: 1, unit: 'шт.', price: 0 }] }); }
  function updatePart(id, f) { patch({ parts: snapshot.parts.map((p) => (p.id === id ? { ...p, ...f } : p)) }); }
  function removePart(id) { patch({ parts: snapshot.parts.filter((p) => p.id !== id) }); }

  function openExisting(d) { touchedRef.current = true; setSnapshot(seedFromExisting(d)); setDocId(d.id); setSaved(true); }
  function newDoc() { touchedRef.current = true; setSnapshot(buildInitial(type, job, company)); setDocId(null); setSaved(false); }

  async function save() {
    setSaving(true);
    setSaveError('');
    try {
      const n = (v) => Number(v) || 0;
      const payload = { ...snapshot };
      if (hasItems) {
        payload.services = (snapshot.services || []).map((s) => ({ ...s, qty: n(s.qty), price: n(s.price) }));
        payload.parts = (snapshot.parts || []).map((p) => ({ ...p, qty: n(p.qty), price: n(p.price) }));
        payload.discount = n(snapshot.discount);
        payload.prepayment = n(snapshot.prepayment);
        payload.totals = computeDocTotals(snapshot);
      }
      if (docId) await api.orderDocuments.update(docId, payload);
      else { const created = await api.orderDocuments.create(payload); setDocId(created.id); }
      setSaved(true);
      refresh();
    } catch {
      setSaveError('Не удалось сохранить. Похоже, ещё не обновлены правила доступа Firestore. Печать при этом работает.');
    } finally {
      setSaving(false);
    }
  }

  const totals = hasItems ? computeDocTotals(snapshot) : null;
  const cust = snapshot.customer;
  const veh = snapshot.vehicle;
  const c = snapshot.company;
  const bank = c.bank || {};
  const cond = snapshot.condition || {};

  return (
    <div className="order-editor-root">
      {history.length > 0 && (
        <div className="oe-history">
          <span className="oe-history-label">Ранее выданные:</span>
          {history.map((d) => (
            <button key={d.id} className={d.id === docId ? 'active' : ''} onClick={() => openExisting(d)}>
              {d.doc_number} · {formatDocDate(d.doc_date)}
            </button>
          ))}
          <button className="oe-history-new" onClick={newDoc}>+ Новый</button>
        </div>
      )}
      <div className="order-editor">
        <div className="order-editor-left">
          <div className="oe-section">
            <h4>Документ</h4>
            <div className="oe-grid">
              <label className="oe-field">№ документа
                <input value={snapshot.doc_number} onChange={(e) => patch({ doc_number: e.target.value })} />
              </label>
              <label className="oe-field">Дата
                <input type="date" value={snapshot.doc_date} onChange={(e) => patch({ doc_date: e.target.value })} />
              </label>
              {hasItems && (
                <label className="oe-field oe-full">Основание — заказ-наряд №
                  <input value={snapshot.order_ref || ''} onChange={(e) => patch({ order_ref: e.target.value })} placeholder="номер заказ-наряда" />
                </label>
              )}
            </div>
            {hasItems && snapshot.order_ref && <div className="oe-hint">Позиции подтянуты из заказ-наряда № {snapshot.order_ref}.</div>}
          </div>

          <div className="oe-section">
            <h4>Заказчик</h4>
            <div className="oe-grid">
              <label className="oe-field oe-full">ФИО / наименование
                <input value={cust.name} onChange={(e) => patchGroup('customer', { name: e.target.value })} />
              </label>
              <label className="oe-field oe-full">Телефон
                <input value={cust.phone} onChange={(e) => patchGroup('customer', { phone: e.target.value })} />
              </label>
            </div>
          </div>

          <div className="oe-section">
            <h4>Автомобиль</h4>
            <div className="oe-grid">
              <label className="oe-field">Марка и модель
                <input value={veh.car_model} onChange={(e) => patchGroup('vehicle', { car_model: e.target.value })} />
              </label>
              <label className="oe-field">Гос. номер
                <input value={veh.plate_number} onChange={(e) => patchGroup('vehicle', { plate_number: e.target.value })} />
              </label>
              <label className="oe-field">VIN
                <input value={veh.vin} onChange={(e) => patchGroup('vehicle', { vin: e.target.value })} />
              </label>
              <label className="oe-field">Год выпуска
                <input value={veh.year} onChange={(e) => patchGroup('vehicle', { year: e.target.value })} />
              </label>
            </div>
          </div>

          {hasItems && (
            <>
              <div className="oe-section">
                <h4>Работы</h4>
                <table className="items-table">
                  <thead><tr><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th></th></tr></thead>
                  <tbody>
                    {(snapshot.services || []).map((s) => (
                      <tr key={s.id}>
                        <td><input value={s.name} onChange={(e) => updateService(s.id, { name: e.target.value })} placeholder="напр. Окраска двери" /></td>
                        <td><input type="number" min="0" value={s.qty} onChange={(e) => updateService(s.id, { qty: e.target.value })} /></td>
                        <td><input type="number" min="0" value={s.price} onChange={(e) => updateService(s.id, { price: e.target.value })} /></td>
                        <td className="items-table-sum">{money(lineTotal(s))}</td>
                        <td><button className="danger small" onClick={() => removeService(s.id)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={addService}>+ Добавить работу</button>
              </div>

              <div className="oe-section">
                <h4>Запчасти / материалы</h4>
                <table className="items-table">
                  <thead><tr><th>Код</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th><th></th></tr></thead>
                  <tbody>
                    {(snapshot.parts || []).map((p) => (
                      <tr key={p.id}>
                        <td><input value={p.code} onChange={(e) => updatePart(p.id, { code: e.target.value })} placeholder="артикул" /></td>
                        <td><input value={p.name} onChange={(e) => updatePart(p.id, { name: e.target.value })} placeholder="напр. Бампер" /></td>
                        <td><input type="number" min="0" value={p.qty} onChange={(e) => updatePart(p.id, { qty: e.target.value })} /></td>
                        <td><input value={p.unit} onChange={(e) => updatePart(p.id, { unit: e.target.value })} placeholder="шт." /></td>
                        <td><input type="number" min="0" value={p.price} onChange={(e) => updatePart(p.id, { price: e.target.value })} /></td>
                        <td className="items-table-sum">{money(lineTotal(p))}</td>
                        <td><button className="danger small" onClick={() => removePart(p.id)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={addPart}>+ Добавить запчасть</button>
              </div>

              <div className="oe-section">
                <h4>Итоги</h4>
                <div className="oe-grid">
                  <label className="oe-field">Скидка, ₽
                    <input type="number" min="0" value={snapshot.discount} onChange={(e) => patch({ discount: e.target.value })} />
                  </label>
                  {isAct && (
                    <label className="oe-field">Предоплата, ₽
                      <input type="number" min="0" value={snapshot.prepayment} onChange={(e) => patch({ prepayment: e.target.value })} />
                    </label>
                  )}
                  {isInvoice && (
                    <label className="oe-field">НДС
                      <select value={snapshot.vat_mode} onChange={(e) => patch({ vat_mode: e.target.value })}>
                        <option value="none">Без НДС</option>
                        <option value="vat20">НДС 20%</option>
                      </select>
                    </label>
                  )}
                </div>
                {totals && <div className="oe-hint">Итого: <b>{money(totals.total)}</b></div>}
              </div>
            </>
          )}

          {isInvoice && (
            <>
              <div className="oe-section">
                <h4>Банковские реквизиты (для этого счёта)</h4>
                <div className="oe-hint">По умолчанию из «Реквизиты компании». Правки здесь остаются только в этом счёте.</div>
                <div className="oe-grid">
                  <label className="oe-field oe-full">Банк получателя
                    <input value={bank.bank_name || ''} onChange={(e) => patchBank({ bank_name: e.target.value })} />
                  </label>
                  <label className="oe-field">БИК
                    <input value={bank.bik || ''} onChange={(e) => patchBank({ bik: e.target.value })} />
                  </label>
                  <label className="oe-field">КПП
                    <input value={c.kpp || ''} onChange={(e) => patchGroup('company', { kpp: e.target.value })} />
                  </label>
                  <label className="oe-field oe-full">Расчётный счёт (р/с)
                    <input value={bank.account || ''} onChange={(e) => patchBank({ account: e.target.value })} />
                  </label>
                  <label className="oe-field oe-full">Корр. счёт (к/с)
                    <input value={bank.corr_account || ''} onChange={(e) => patchBank({ corr_account: e.target.value })} />
                  </label>
                </div>
              </div>

              <div className="oe-section">
                <label className="oe-toggle">
                  <input type="checkbox" checked={snapshot.show_qr} onChange={(e) => patch({ show_qr: e.target.checked })} />
                  QR-код для оплаты
                </label>
                {snapshot.show_qr && !qrIsComplete(snapshot) && <div className="oe-hint">Заполните банковские реквизиты и ИНН — тогда QR будет рабочим.</div>}
              </div>

              <div className="oe-section">
                <div className="oe-toggle-row">
                  <label className="oe-toggle">
                    <input type="checkbox" checked={snapshot.show_invoice_note} onChange={(e) => patch({ show_invoice_note: e.target.checked })} />
                    Примечание об оплате
                  </label>
                  <button className="small" onClick={() => patch({ invoice_note: DEFAULT_INVOICE_NOTE })}>Вернуть стандартный текст</button>
                </div>
                <textarea className="oe-textarea" value={snapshot.invoice_note} disabled={!snapshot.show_invoice_note} onChange={(e) => patch({ invoice_note: e.target.value })} />
              </div>
            </>
          )}

          {isAct && (
            <>
              <div className="oe-section">
                <label className="oe-toggle">
                  <input type="checkbox" checked={snapshot.show_recommendations} onChange={(e) => patch({ show_recommendations: e.target.checked })} />
                  Рекомендации
                </label>
                <textarea className="oe-textarea" value={snapshot.recommendations} disabled={!snapshot.show_recommendations} onChange={(e) => patch({ recommendations: e.target.value })} placeholder="Рекомендации мастера" />
              </div>
              <div className="oe-section">
                <div className="oe-toggle-row">
                  <label className="oe-toggle">
                    <input type="checkbox" checked={snapshot.show_act_text} onChange={(e) => patch({ show_act_text: e.target.checked })} />
                    Текст акта (выполнено, претензий нет)
                  </label>
                  <button className="small" onClick={() => patch({ act_text: DEFAULT_ACT_TEXT })}>Вернуть стандартный текст</button>
                </div>
                <textarea className="oe-textarea" value={snapshot.act_text} disabled={!snapshot.show_act_text} onChange={(e) => patch({ act_text: e.target.value })} />
              </div>
              <div className="oe-section">
                <div className="oe-toggle-row">
                  <label className="oe-toggle">
                    <input type="checkbox" checked={snapshot.show_warranty} onChange={(e) => patch({ show_warranty: e.target.checked })} />
                    Гарантия
                  </label>
                  <button className="small" onClick={() => patch({ warranty_text: DEFAULT_WARRANTY })}>Вернуть стандартный текст</button>
                </div>
                <textarea className="oe-textarea" value={snapshot.warranty_text} disabled={!snapshot.show_warranty} onChange={(e) => patch({ warranty_text: e.target.value })} />
              </div>
            </>
          )}

          {isHandover && (
            <>
              <div className="oe-section">
                <label className="oe-toggle">
                  <input type="checkbox" checked={snapshot.show_intake} onChange={(e) => patch({ show_intake: e.target.checked })} />
                  При приёме ТС
                </label>
                <div className="oe-grid" style={{ opacity: snapshot.show_intake ? 1 : 0.45 }}>
                  <label className="oe-field oe-full">Пробег при приёме, км
                    <input value={cond.mileage_in} disabled={!snapshot.show_intake} onChange={(e) => patchGroup('condition', { mileage_in: e.target.value })} />
                  </label>
                  <label className="oe-field oe-full">Комплектация
                    <input value={cond.equipment} disabled={!snapshot.show_intake} onChange={(e) => patchGroup('condition', { equipment: e.target.value })} />
                  </label>
                </div>
                <textarea className="oe-textarea" value={cond.condition_in} disabled={!snapshot.show_intake} onChange={(e) => patchGroup('condition', { condition_in: e.target.value })} placeholder="Видимые повреждения / состояние при приёме" />
              </div>
              <div className="oe-section">
                <label className="oe-toggle">
                  <input type="checkbox" checked={snapshot.show_issue} onChange={(e) => patch({ show_issue: e.target.checked })} />
                  При выдаче ТС
                </label>
                <label className="oe-field oe-full" style={{ opacity: snapshot.show_issue ? 1 : 0.45 }}>Пробег при выдаче, км
                  <input value={cond.mileage_out} disabled={!snapshot.show_issue} onChange={(e) => patchGroup('condition', { mileage_out: e.target.value })} />
                </label>
                <textarea className="oe-textarea" value={cond.condition_out} disabled={!snapshot.show_issue} onChange={(e) => patchGroup('condition', { condition_out: e.target.value })} placeholder="Состояние при выдаче" />
              </div>
              <div className="oe-section">
                <div className="oe-toggle-row">
                  <label className="oe-toggle">
                    <input type="checkbox" checked={snapshot.show_handover_text} onChange={(e) => patch({ show_handover_text: e.target.checked })} />
                    Текст приёма-передачи
                  </label>
                  <button className="small" onClick={() => patch({ handover_text: DEFAULT_HANDOVER_TEXT })}>Вернуть стандартный текст</button>
                </div>
                <textarea className="oe-textarea" value={snapshot.handover_text} disabled={!snapshot.show_handover_text} onChange={(e) => patch({ handover_text: e.target.value })} />
              </div>
            </>
          )}

          <div className="oe-section">
            <h4>Реквизиты компании (для этого документа)</h4>
            <div className="oe-hint">По умолчанию из «Посты и мастера → Реквизиты». Правки здесь остаются только в этом документе.</div>
            <div className="oe-grid">
              <label className="oe-field oe-full">Наименование
                <input value={c.name} onChange={(e) => patchGroup('company', { name: e.target.value })} />
              </label>
              <label className="oe-field">ИНН
                <input value={c.inn} onChange={(e) => patchGroup('company', { inn: e.target.value })} />
              </label>
              <label className="oe-field">Руководитель (подпись)
                <input value={c.director} onChange={(e) => patchGroup('company', { director: e.target.value })} />
              </label>
            </div>
          </div>
        </div>

        <div className="order-editor-right" ref={paneRef} style={{ textAlign: 'center' }}>
          <div style={{ zoom: scale, display: 'inline-block' }}>
            <DocSheet snapshot={snapshot} qrDataUrl={qrDataUrl} />
          </div>
        </div>
      </div>

      <div className="order-editor-actions">
        <button onClick={onClose}>Закрыть</button>
        <div>
          {saveError && <span className="login-error">{saveError}</span>}
          {saved && !saveError && <span className="oe-saved">Сохранено ✓</span>}
          <button disabled={saving} onClick={save}>{saving ? 'Сохраняем…' : (docId ? 'Сохранить изменения' : 'Сохранить документ')}</button>
          <button className="primary" onClick={() => window.print()}>🖨 Печать</button>
        </div>
      </div>

      {createPortal(<div id="zn-print-mount"><DocSheet snapshot={snapshot} qrDataUrl={qrDataUrl} /></div>, document.body)}
    </div>
  );
}
