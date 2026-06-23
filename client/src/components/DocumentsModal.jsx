import { useState } from 'react';
import { api } from '../api';
import { generateOrderPdf, generateActPdf, generateHandoverPdf } from '../pdf';

const DOC_TYPES = [
  { id: 'order', label: 'Заказ-наряд' },
  { id: 'act', label: 'Акт выполненных работ' },
  { id: 'handover', label: 'Акт приёма-передачи' },
];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function money(v) {
  const n = Number(v) || 0;
  return `${n.toLocaleString('ru-RU')} ₽`;
}

function lineTotal(item) {
  return (Number(item.qty) || 0) * (Number(item.price) || 0);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function DocumentsModal({ job, company, onClose, onJobUpdated }) {
  const [docType, setDocType] = useState('order');
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [form, setForm] = useState({
    vin: job.vin || '',
    year: job.year || '',
    mileage: job.mileage || '',
    reason: job.reason || '',
    recommendations: job.recommendations || '',
    discount: job.discount ?? '',
    prepayment: job.prepayment ?? '',
    equipment: job.equipment || '',
    condition_in: job.condition_in || '',
    mileage_out: job.mileage_out || '',
    condition_out: job.condition_out || '',
    services: job.services && job.services.length ? job.services : [],
    parts: job.parts && job.parts.length ? job.parts : [],
  });

  function patch(fields) {
    setForm((f) => ({ ...f, ...fields }));
  }

  function addService() {
    patch({ services: [...form.services, { id: uid(), name: '', executor: '', qty: 1, price: '' }] });
  }
  function updateService(id, fields) {
    patch({ services: form.services.map((s) => (s.id === id ? { ...s, ...fields } : s)) });
  }
  function removeService(id) {
    patch({ services: form.services.filter((s) => s.id !== id) });
  }

  function addPart() {
    patch({ parts: [...form.parts, { id: uid(), code: '', name: '', qty: 1, unit: 'шт.', price: '' }] });
  }
  function updatePart(id, fields) {
    patch({ parts: form.parts.map((p) => (p.id === id ? { ...p, ...fields } : p)) });
  }
  function removePart(id) {
    patch({ parts: form.parts.filter((p) => p.id !== id) });
  }

  async function handleAudatexUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setExtracting(true);
    setExtractError('');
    try {
      const pdfBase64 = await fileToBase64(file);
      const res = await fetch('/api/extract-audatex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64 }),
      });
      if (!res.ok) throw new Error('request failed');
      const data = await res.json();
      patch({
        vin: form.vin || data.vin || '',
        services: [
          ...form.services,
          ...(data.services || []).map((s) => ({ id: uid(), name: s.name || '', executor: '', qty: s.qty ?? 1, price: s.price ?? '' })),
        ],
        parts: [
          ...form.parts,
          ...(data.parts || []).map((p) => ({ id: uid(), code: p.code || '', name: p.name || '', qty: p.qty ?? 1, unit: p.unit || 'шт.', price: p.price ?? '' })),
        ],
      });
    } catch {
      setExtractError('Не удалось распознать документ. Проверьте файл и попробуйте ещё раз.');
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    setSaving(true);
    await api.jobs.update(job.id, form);
    setSaving(false);
    onJobUpdated && onJobUpdated();
  }

  async function saveAndGenerate(generator) {
    setSaving(true);
    await api.jobs.update(job.id, form);
    setSaving(false);
    onJobUpdated && onJobUpdated();
    await generator({ ...job, ...form }, company);
  }

  const servicesSum = form.services.reduce((sum, s) => sum + lineTotal(s), 0);
  const partsSum = form.parts.reduce((sum, p) => sum + lineTotal(p), 0);
  const total = Math.max(0, servicesSum + partsSum - (Number(form.discount) || 0));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="doc-tabs">
          {DOC_TYPES.map((t) => (
            <button key={t.id} className={docType === t.id ? 'active' : ''} onClick={() => setDocType(t.id)}>{t.label}</button>
          ))}
        </div>

        <div className="doc-modal-body">
          {docType === 'order' && (
            <>
              <div className="doc-fields-row">
                <input placeholder="VIN" value={form.vin} onChange={(e) => patch({ vin: e.target.value })} />
                <input placeholder="Год выпуска" value={form.year} onChange={(e) => patch({ year: e.target.value })} />
                <input placeholder="Пробег, км" value={form.mileage} onChange={(e) => patch({ mileage: e.target.value })} />
              </div>
              <textarea placeholder="Причина обращения" value={form.reason} onChange={(e) => patch({ reason: e.target.value })} />

              <div className="audatex-upload">
                <label className={`audatex-upload-btn${extracting ? ' is-busy' : ''}`}>
                  {extracting ? 'Распознаём…' : '📎 Распознать смету Audatex (PDF)'}
                  <input type="file" accept="application/pdf" onChange={handleAudatexUpload} disabled={extracting} hidden />
                </label>
                {extractError && <span className="login-error">{extractError}</span>}
              </div>

              <h4>Работы</h4>
              <table className="items-table">
                <thead>
                  <tr><th>Наименование</th><th>Исполнитель</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th></th></tr>
                </thead>
                <tbody>
                  {form.services.map((s) => (
                    <tr key={s.id}>
                      <td><input value={s.name} onChange={(e) => updateService(s.id, { name: e.target.value })} placeholder="напр. Окраска двери" /></td>
                      <td><input value={s.executor} onChange={(e) => updateService(s.id, { executor: e.target.value })} placeholder="мастер" /></td>
                      <td><input type="number" min="0" value={s.qty} onChange={(e) => updateService(s.id, { qty: e.target.value })} /></td>
                      <td><input type="number" min="0" value={s.price} onChange={(e) => updateService(s.id, { price: e.target.value })} /></td>
                      <td className="items-table-sum">{money(lineTotal(s))}</td>
                      <td><button className="danger small" onClick={() => removeService(s.id)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={addService}>+ Добавить услугу</button>

              <h4>Запчасти / материалы</h4>
              <table className="items-table">
                <thead>
                  <tr><th>Код</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th><th></th></tr>
                </thead>
                <tbody>
                  {form.parts.map((p) => (
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

              <textarea placeholder="Рекомендации" value={form.recommendations} onChange={(e) => patch({ recommendations: e.target.value })} />

              <div className="doc-fields-row">
                <label className="doc-field-label">Скидка, ₽
                  <input type="number" min="0" value={form.discount} onChange={(e) => patch({ discount: e.target.value })} />
                </label>
                <label className="doc-field-label">Предоплата, ₽
                  <input type="number" min="0" value={form.prepayment} onChange={(e) => patch({ prepayment: e.target.value })} />
                </label>
              </div>
              <div className="doc-total">Итого по заказ-наряду: {money(total)}</div>
            </>
          )}

          {docType === 'act' && (
            <div className="doc-summary">
              <p>В акт попадут текущие позиции из заказ-наряда:</p>
              <ul>
                <li>Работ: {form.services.length} на сумму {money(servicesSum)}</li>
                <li>Материалов: {form.parts.length} на сумму {money(partsSum)}</li>
              </ul>
              <p className="panel-hint">Чтобы изменить состав работ или цены — перейдите на вкладку «Заказ-наряд».</p>
            </div>
          )}

          {docType === 'handover' && (
            <div className="handover-form">
              <div className="handover-col">
                <h4>При приёме</h4>
                <input placeholder="Пробег, км" value={form.mileage} onChange={(e) => patch({ mileage: e.target.value })} />
                <input placeholder="Комплектация (магнитола, колпаки и т.п.)" value={form.equipment} onChange={(e) => patch({ equipment: e.target.value })} />
                <textarea placeholder="Видимые повреждения / состояние" value={form.condition_in} onChange={(e) => patch({ condition_in: e.target.value })} />
              </div>
              <div className="handover-col">
                <h4>При выдаче</h4>
                <input placeholder="Пробег, км" value={form.mileage_out} onChange={(e) => patch({ mileage_out: e.target.value })} />
                <textarea placeholder="Состояние при выдаче" value={form.condition_out} onChange={(e) => patch({ condition_out: e.target.value })} />
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Закрыть</button>
          <div>
            <button disabled={saving} onClick={save}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
            {docType === 'order' && <button className="primary" disabled={saving} onClick={() => saveAndGenerate(generateOrderPdf)}>⬇ Скачать PDF</button>}
            {docType === 'act' && <button className="primary" disabled={saving} onClick={() => saveAndGenerate(generateActPdf)}>⬇ Скачать PDF</button>}
            {docType === 'handover' && <button className="primary" disabled={saving} onClick={() => saveAndGenerate(generateHandoverPdf)}>⬇ Скачать PDF</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
