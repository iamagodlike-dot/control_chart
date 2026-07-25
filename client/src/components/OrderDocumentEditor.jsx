import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { parseAudatexPdf } from '../audatexParse';
import OrderDocument from './OrderDocument';
import DocLineItems from './DocLineItems';
import DocPreviewPane from './DocPreviewPane';
import CollapsibleSection from './CollapsibleSection';
import DocTotal from './DocTotal';
import DiscountField from './DiscountField';
import DateTimeField from './DateTimeField';
import { printFitted } from '../printDoc';
import {
  buildOrderSnapshot, computeOrderTotals, uid, formatDocDate,
  buildPartsConsentText, orderMatchesRecipient, planDocItemsToCar, DEFAULT_WARRANTY, DEFAULT_CONSENT,
} from '../orderDoc';
import { genPartId } from '../parts';
import '../orderDoc.css';

function seedSnapshot(job, company, existingDoc, recipient) {
  if (existingDoc) {
    // Reopen a saved document exactly as issued (drop only the storage fields).
    const { id, created_at, updated_at, created_by, ...rest } = existingDoc; // eslint-disable-line no-unused-vars
    return rest;
  }
  return buildOrderSnapshot(job, company, recipient);
}

export default function OrderDocumentEditor({ job, company, existingDoc = null, recipient = 'all', onClose, onJobUpdated }) {
  const [snapshot, setSnapshot] = useState(() => seedSnapshot(job, company, existingDoc, recipient));
  const [docId, setDocId] = useState(existingDoc?.id || null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedToCar, setSavedToCar] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extractInfo, setExtractInfo] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [history, setHistory] = useState([]);

  async function loadHistory() {
    if (!job?.id) return;
    try {
      const all = await api.orderDocuments.listByJob(job.id, 'order');
      // Показываем только ранее выданные ЗН этого же получателя (страховой/клиента),
      // чтобы страховые и клиентские заказ-наряды не путались в одном списке.
      setHistory(recipient === 'all' ? all : all.filter((d) => orderMatchesRecipient(d, recipient)));
    } catch {
      // Reading issued documents may be blocked until Firestore rules are deployed;
      // the editor still works for creating/printing.
      setHistory([]);
    }
  }
  useEffect(() => { loadHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  function openExisting(d) {
    setSnapshot(seedSnapshot(job, company, d, recipient));
    setDocId(d.id);
    setSaved(true);
  }
  function newDoc() {
    setSnapshot(buildOrderSnapshot(job, company, recipient));
    setDocId(null);
    setSaved(false);
  }

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
    setSavedToCar(false);
  }

  // Push the document's vehicle + client data AND услуги/запчасти back onto the car
  // (opt-in — the document is isolated by default). Vehicle/client: заполненные поля
  // перезаписывают карточку. Услуги/запчасти: «добавить и обновить, не удалять»
  // по получателю (см. planDocItemsToCar) — совпадающие запчасти сохраняют закупку
  // и историю приёмки (matched by артикул+название через savePart).
  async function saveToCar() {
    if (!job?.id) return;
    const veh = snapshot.vehicle || {};
    const cust = snapshot.customer || {};
    const upd = {};
    if (veh.car_model) upd.car_model = veh.car_model;
    if (veh.plate_number) upd.plate_number = veh.plate_number;
    if (veh.vin) upd.vin = veh.vin;
    if (veh.year) upd.year = veh.year;
    if (veh.mileage) upd.mileage = veh.mileage;
    if (cust.name) upd.client_name = cust.name;
    if (cust.phone) upd.client_phone = cust.phone;
    const { services, partOps } = planDocItemsToCar(job, snapshot, recipient, genPartId);
    const hasDocItems = (snapshot.services || []).some((s) => String((s && s.name) || '').trim())
      || (snapshot.parts || []).some((p) => String((p && p.code) || '').trim() || String((p && p.name) || '').trim());
    if (!Object.keys(upd).length && !hasDocItems) return;
    if (!window.confirm('Обновить карточку машины данными из документа?\n\n• Марка, гос. номер, VIN, пробег и клиент — перезапишут карточку.\n• Услуги и запчасти из документа — добавятся в карточку и обновят совпадающие. Ничего не удаляется (удалить позицию можно на экране «Запчасти»).')) return;
    try {
      // Услуги пишем целым (слитым) массивом, только если в документе есть работы —
      // иначе карточку не трогаем. Запчасти — пооперационно (сохраняют склад/приёмку).
      const payload = { ...upd };
      if ((snapshot.services || []).some((s) => String((s && s.name) || '').trim())) payload.services = services;
      if (Object.keys(payload).length) await api.jobs.update(job.id, payload);
      for (const p of partOps) await api.jobs.savePart(job.id, p); // последовательно: транзакции на один job-док не должны конфликтовать
      setSavedToCar(true);
      if (onJobUpdated) onJobUpdated();
    } catch {
      alert('Не удалось обновить карточку машины.');
    }
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
    } catch (err) {
      console.error('Ошибка импорта Audatex:', err);
      const detail = err?.message ? ` (${err.message})` : '';
      setExtractError(`Не удалось прочитать файл${detail}. Проверьте, что это PDF из Audatex.`);
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
        // discount ПЕРСИСТИМ рублями (эффективную сумму) — costing и печать читают его
        // как рубли; режим/процент сохраняем отдельно для повторного открытия.
        discount: totals.discount,
        discount_mode: snapshot.discount_mode === 'pct' ? 'pct' : 'rub',
        discount_pct: n(snapshot.discount_pct),
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
              <DateTimeField mode="date" value={snapshot.doc_date} onChange={(v) => patch({ doc_date: v })} />
            </label>
            <label className="oe-field oe-full">Плановая готовность (необязательно)
              <DateTimeField mode="date" value={snapshot.planned_ready_at} onChange={(v) => patch({ planned_ready_at: v })} />
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
          <DocLineItems
            kind="services"
            items={snapshot.services}
            onAdd={addService}
            onUpdate={updateService}
            onRemove={removeService}
            addLabel="+ Добавить работу"
          />
        </div>

        <div className="oe-section">
          <h4>Запчасти / материалы</h4>
          <DocLineItems
            kind="parts"
            items={snapshot.parts}
            onAdd={addPart}
            onUpdate={updatePart}
            onRemove={removePart}
            addLabel="+ Добавить запчасть"
          />
        </div>

        <div className="oe-section">
          <h4>Итоги</h4>
          <div className="oe-grid">
            <DiscountField
              mode={snapshot.discount_mode}
              rub={snapshot.discount}
              pct={snapshot.discount_pct}
              effective={totals.discount}
              subtotal={totals.discount_base}
              baseLabel={(snapshot.insurance || {}).payment_type === 'insurance' ? 'от запчастей' : 'от работ и запчастей'}
              onPatch={patch}
            />
            <label className="oe-field">Предоплата, ₽
              <input type="number" min="0" value={snapshot.prepayment} onChange={(e) => patch({ prepayment: e.target.value })} />
            </label>
          </div>
          <DocTotal totals={totals} />
        </div>

        <div className="oe-group-label"><span>Дополнительно · тексты и реквизиты</span></div>

        <CollapsibleSection title="Рекомендации" toggle={{ checked: snapshot.show_recommendations, onChange: (v) => patch({ show_recommendations: v }) }}>
          <textarea className="oe-textarea" value={snapshot.recommendations} disabled={!snapshot.show_recommendations} onChange={(e) => patch({ recommendations: e.target.value })} placeholder="Рекомендации мастера" />
        </CollapsibleSection>

        <CollapsibleSection title="Гарантия" toggle={{ checked: snapshot.show_warranty, onChange: (v) => patch({ show_warranty: v }) }}>
          <div className="oe-collapse-actions">
            {/* Заодно включаем блок: иначе при снятой галочке клик «ничего не делает» */}
            <button className="small" onClick={() => patch({ warranty_text: DEFAULT_WARRANTY, show_warranty: true })}>Вернуть стандартный текст</button>
          </div>
          <textarea className="oe-textarea" value={snapshot.warranty_text} disabled={!snapshot.show_warranty} onChange={(e) => patch({ warranty_text: e.target.value })} />
        </CollapsibleSection>

        <CollapsibleSection title="Согласие заказчика" toggle={{ checked: snapshot.show_consent, onChange: (v) => patch({ show_consent: v }) }}>
          <div className="oe-collapse-actions">
            <button className="small" onClick={() => patch({ consent_text: DEFAULT_CONSENT, show_consent: true })}>Вернуть стандартный текст</button>
          </div>
          <textarea className="oe-textarea" value={snapshot.consent_text} disabled={!snapshot.show_consent} onChange={(e) => patch({ consent_text: e.target.value })} />
        </CollapsibleSection>

        <CollapsibleSection title="Согласование по запчастям (Б/У и замены)" toggle={{ checked: snapshot.show_parts_consent, onChange: (v) => patch({ show_parts_consent: v }) }}>
          <div className="oe-collapse-actions">
            <button className="small" onClick={() => patch({ parts_consent_text: buildPartsConsentText(snapshot.parts), show_parts_consent: true })}>Собрать из запчастей</button>
          </div>
          <textarea className="oe-textarea" value={snapshot.parts_consent_text || ''} disabled={!snapshot.show_parts_consent} onChange={(e) => patch({ parts_consent_text: e.target.value })} placeholder="Отметки о Б/У и заменах на аналог — по одной в строке" />
        </CollapsibleSection>

        <CollapsibleSection title="Реквизиты компании (для этого документа)" hint="По умолчанию берутся из «Посты и мастера → Реквизиты». Правки здесь остаются только в этом документе.">
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
        </CollapsibleSection>
      </div>

      <DocPreviewPane show={showPreview}>
        <OrderDocument snapshot={snapshot} />
      </DocPreviewPane>
      </div>

      <div className="order-editor-actions">
        <div className="oe-actions-left">
          <button onClick={onClose}>Закрыть</button>
          <button className="oe-preview-toggle" aria-pressed={showPreview} onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? '🙈 Скрыть лист' : '👁 Показать образец'}
          </button>
        </div>
        <div>
          {saveError && <span className="login-error">{saveError}</span>}
          {savedToCar && <span className="oe-saved">Карточка обновлена ✓</span>}
          {saved && !saveError && <span className="oe-saved">Сохранено ✓</span>}
          <button onClick={saveToCar} title="Перенести данные ТС, клиента, а также услуги и запчасти из документа в карточку машины (новые добавит, совпадающие обновит, ничего не удалит)">↩ Обновить карточку машины</button>
          <button disabled={saving} onClick={save}>{saving ? 'Сохраняем…' : (docId ? 'Сохранить изменения' : 'Сохранить документ')}</button>
          <button className="primary" onClick={() => printFitted()}>🖨 Печать</button>
        </div>
      </div>

      {createPortal(
        <div id="zn-print-mount"><OrderDocument snapshot={snapshot} /></div>,
        document.body,
      )}
    </div>
  );
}
