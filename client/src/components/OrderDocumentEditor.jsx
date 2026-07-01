import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { parseAudatexPdf } from '../audatexParse';
import OrderDocument from './OrderDocument';
import {
  buildOrderSnapshot, computeOrderTotals, uid, money, lineTotal, formatDocDate,
  DEFAULT_WARRANTY, DEFAULT_CONSENT,
} from '../orderDoc';
import '../orderDoc.css';

const A4_WIDTH_PX = 794; // 210mm at 96dpi

function seedSnapshot(job, company, existingDoc) {
  if (existingDoc) {
    // Reopen a saved document exactly as issued (drop only the storage fields).
    const { id, created_at, updated_at, created_by, ...rest } = existingDoc; // eslint-disable-line no-unused-vars
    return rest;
  }
  return buildOrderSnapshot(job, company);
}

export default function OrderDocumentEditor({ job, company, existingDoc = null, onClose }) {
  const [snapshot, setSnapshot] = useState(() => seedSnapshot(job, company, existingDoc));
  const [docId, setDocId] = useState(existingDoc?.id || null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extractInfo, setExtractInfo] = useState('');
  const [scale, setScale] = useState(0.6);
  const [history, setHistory] = useState([]);
  const paneRef = useRef(null);

  async function loadHistory() {
    if (!job?.id) return;
    try {
      setHistory(await api.orderDocuments.listByJob(job.id, 'order'));
    } catch {
      // Reading issued documents may be blocked until Firestore rules are deployed;
      // the editor still works for creating/printing.
      setHistory([]);
    }
  }
  useEffect(() => { loadHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  function openExisting(d) {
    setSnapshot(seedSnapshot(job, company, d));
    setDocId(d.id);
    setSaved(true);
  }
  function newDoc() {
    setSnapshot(buildOrderSnapshot(job, company));
    setDocId(null);
    setSaved(false);
  }

  // Fit the A4 preview to the width of the right pane.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return undefined;
    const fit = () => {
      const avail = pane.clientWidth - 32;
      setScale(Math.max(0.25, Math.min(1, avail / A4_WIDTH_PX)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(pane);
    return () => ro.disconnect();
  }, []);

  // Preload the logo so it's painted before the print dialog fires.
  useEffect(() => {
    const img = new Image();
    img.src = '/logo-mark.png';
  }, []);

  function patch(fields) {
    setSnapshot((s) => ({ ...s, ...fields }));
    setSaved(false);
  }
  function patchGroup(group, fields) {
    setSnapshot((s) => ({ ...s, [group]: { ...s[group], ...fields } }));
    setSaved(false);
  }

  function addService() {
    patch({ services: [...snapshot.services, { id: uid(), name: '', qty: 1, price: 0 }] });
  }
  function updateService(id, fields) {
    patch({ services: snapshot.services.map((s) => (s.id === id ? { ...s, ...fields } : s)) });
  }
  function removeService(id) {
    patch({ services: snapshot.services.filter((s) => s.id !== id) });
  }

  function addPart() {
    patch({ parts: [...snapshot.parts, { id: uid(), code: '', name: '', qty: 1, unit: 'шт.', price: 0 }] });
  }
  function updatePart(id, fields) {
    patch({ parts: snapshot.parts.map((p) => (p.id === id ? { ...p, ...fields } : p)) });
  }
  function removePart(id) {
    patch({ parts: snapshot.parts.filter((p) => p.id !== id) });
  }

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
        setExtractError('Не нашли данных в этом PDF — проверьте, что это калькуляция Audatex, или добавьте позиции вручную.');
        return;
      }
      const discount = Number(data.meta?.discount) || 0;
      setSnapshot((s) => {
        // Fill only empty vehicle fields — never overwrite what's already there.
        const vehicle = { ...s.vehicle };
        if (!vehicle.car_model && v.car_model) vehicle.car_model = v.car_model;
        if (!vehicle.vin && v.vin) vehicle.vin = v.vin;
        if (!vehicle.plate_number && v.plate) vehicle.plate_number = v.plate;
        if (!vehicle.mileage && v.mileage) vehicle.mileage = v.mileage;
        return {
          ...s,
          vehicle,
          discount: discount > 0 ? discount : s.discount,
          services: [
            ...s.services,
            ...data.services.map((x) => ({ id: uid(), name: x.name || '', qty: Number(x.qty) || 1, price: Number(x.price) || 0 })),
          ],
          parts: [
            ...s.parts,
            ...data.parts.map((p) => ({ id: uid(), code: p.code || '', name: p.name || '', qty: Number(p.qty) || 1, unit: p.unit || 'шт.', price: Number(p.price) || 0 })),
          ],
        };
      });
      setSaved(false);
      const bits = [];
      if (v.car_model) bits.push(v.car_model);
      bits.push(`работ: ${data.services.length}`);
      bits.push(`запчастей: ${data.parts.length}`);
      if (discount > 0) bits.push(`скидка: ${discount.toLocaleString('ru-RU')} ₽`);
      if (data.meta?.repair_total > 0) bits.push(`итог Audatex: ${Number(data.meta.repair_total).toLocaleString('ru-RU')} ₽`);
      setExtractInfo(`Распознано — ${bits.join(' · ')}`);
    } catch {
      setExtractError('Не удалось прочитать файл. Проверьте, что это PDF из Audatex.');
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaveError('');
    try {
      const n = (v) => Number(v) || 0;
      const totals = computeOrderTotals(snapshot);
      const payload = {
        ...snapshot,
        services: snapshot.services.map((s) => ({ ...s, qty: n(s.qty), price: n(s.price) })),
        parts: snapshot.parts.map((p) => ({ ...p, qty: n(p.qty), price: n(p.price) })),
        discount: n(snapshot.discount),
        prepayment: n(snapshot.prepayment),
        totals,
      };
      if (docId) {
        await api.orderDocuments.update(docId, payload);
      } else {
        const created = await api.orderDocuments.create(payload);
        setDocId(created.id);
      }
      setSaved(true);
      loadHistory();
    } catch {
      setSaveError('Не удалось сохранить. Похоже, ещё не обновлены правила доступа Firestore. Печать при этом работает.');
    } finally {
      setSaving(false);
    }
  }

  const totals = computeOrderTotals(snapshot);
  const c = snapshot.company;
  const cust = snapshot.customer;
  const veh = snapshot.vehicle;

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
            <label className="oe-field">№ заказ-наряда
              <input value={snapshot.doc_number} onChange={(e) => patch({ doc_number: e.target.value })} />
            </label>
            <label className="oe-field">Дата составления
              <input type="date" value={snapshot.doc_date} onChange={(e) => patch({ doc_date: e.target.value })} />
            </label>
            <label className="oe-field oe-full">Плановая готовность (необязательно)
              <input type="date" value={snapshot.planned_ready_at} onChange={(e) => patch({ planned_ready_at: e.target.value })} />
            </label>
          </div>
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
            <label className="oe-field oe-full">Пробег, км
              <input value={veh.mileage} onChange={(e) => patchGroup('vehicle', { mileage: e.target.value })} />
            </label>
          </div>
        </div>

        <div className="oe-section">
          <h4>Причина обращения</h4>
          <textarea className="oe-textarea" value={snapshot.reason} onChange={(e) => patch({ reason: e.target.value })} placeholder="Опишите причину обращения / дефекты" />
        </div>

        <div className="oe-section">
          <h4>Работы</h4>
          <div className="audatex-upload">
            <label className={`audatex-upload-btn${extracting ? ' is-busy' : ''}`}>
              {extracting ? 'Распознаём…' : '📎 Распознать смету Audatex (PDF)'}
              <input type="file" accept="application/pdf" onChange={handleAudatexUpload} disabled={extracting} hidden />
            </label>
            {extractError && <span className="login-error">{extractError}</span>}
            {extractInfo && <span className="oe-recognized">{extractInfo}</span>}
          </div>
          <table className="items-table">
            <thead>
              <tr><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th></th></tr>
            </thead>
            <tbody>
              {snapshot.services.map((s) => (
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
            <thead>
              <tr><th>Код</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th><th></th></tr>
            </thead>
            <tbody>
              {snapshot.parts.map((p) => (
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
            <label className="oe-field">Предоплата, ₽
              <input type="number" min="0" value={snapshot.prepayment} onChange={(e) => patch({ prepayment: e.target.value })} />
            </label>
          </div>
          <div className="oe-hint">Итого к оплате: <b>{money(totals.total)}</b> · К доплате: {money(totals.due)}</div>
        </div>

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
              <input type="checkbox" checked={snapshot.show_warranty} onChange={(e) => patch({ show_warranty: e.target.checked })} />
              Гарантия
            </label>
            <button className="small" onClick={() => patch({ warranty_text: DEFAULT_WARRANTY })}>Вернуть стандартный текст</button>
          </div>
          <textarea className="oe-textarea" value={snapshot.warranty_text} disabled={!snapshot.show_warranty} onChange={(e) => patch({ warranty_text: e.target.value })} />
        </div>

        <div className="oe-section">
          <div className="oe-toggle-row">
            <label className="oe-toggle">
              <input type="checkbox" checked={snapshot.show_consent} onChange={(e) => patch({ show_consent: e.target.checked })} />
              Согласие заказчика
            </label>
            <button className="small" onClick={() => patch({ consent_text: DEFAULT_CONSENT })}>Вернуть стандартный текст</button>
          </div>
          <textarea className="oe-textarea" value={snapshot.consent_text} disabled={!snapshot.show_consent} onChange={(e) => patch({ consent_text: e.target.value })} />
        </div>

        <div className="oe-section">
          <h4>Реквизиты компании (для этого документа)</h4>
          <div className="oe-hint">По умолчанию берутся из «Посты и мастера → Реквизиты». Правки здесь остаются только в этом документе.</div>
          <div className="oe-grid">
            <label className="oe-field oe-full">Наименование
              <input value={c.name} onChange={(e) => patchGroup('company', { name: e.target.value })} />
            </label>
            <label className="oe-field">ИНН
              <input value={c.inn} onChange={(e) => patchGroup('company', { inn: e.target.value })} />
            </label>
            <label className="oe-field">ОГРН / ОГРНИП
              <input value={c.ogrn} onChange={(e) => patchGroup('company', { ogrn: e.target.value })} />
            </label>
            <label className="oe-field oe-full">Адрес
              <input value={c.address} onChange={(e) => patchGroup('company', { address: e.target.value })} />
            </label>
            <label className="oe-field">Телефон
              <input value={c.phone} onChange={(e) => patchGroup('company', { phone: e.target.value })} />
            </label>
            <label className="oe-field">Руководитель (подпись)
              <input value={c.director} onChange={(e) => patchGroup('company', { director: e.target.value })} />
            </label>
          </div>
        </div>
      </div>

      <div className="order-editor-right" ref={paneRef} style={{ textAlign: 'center' }}>
        <div style={{ zoom: scale, display: 'inline-block' }}>
          <OrderDocument snapshot={snapshot} />
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

      {createPortal(
        <div id="zn-print-mount"><OrderDocument snapshot={snapshot} /></div>,
        document.body,
      )}
    </div>
  );
}
