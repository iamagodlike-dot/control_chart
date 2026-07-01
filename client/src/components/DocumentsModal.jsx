import { useState } from 'react';
import { api } from '../api';
import { generateActPdf, generateHandoverPdf } from '../pdf';
import { money, lineTotal } from '../orderDoc';
import OrderDocumentEditor from './OrderDocumentEditor';

const DOC_TYPES = [
  { id: 'order', label: 'Заказ-наряд' },
  { id: 'act', label: 'Акт выполненных работ' },
  { id: 'handover', label: 'Акт приёма-передачи' },
];

export default function DocumentsModal({ job, company, onClose, onJobUpdated }) {
  const [docType, setDocType] = useState('order');
  const [saving, setSaving] = useState(false);
  // Only the act/handover tabs still use this shared form. The заказ-наряд has
  // its own isolated editor (OrderDocumentEditor) that never writes to the job.
  const [form, setForm] = useState({
    mileage: job.mileage || '',
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

  async function saveDoc() {
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal modal-wide ${docType === 'order' ? 'modal-order' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="doc-tabs">
          {DOC_TYPES.map((t) => (
            <button key={t.id} className={docType === t.id ? 'active' : ''} onClick={() => setDocType(t.id)}>{t.label}</button>
          ))}
        </div>

        {docType === 'order' && (
          <OrderDocumentEditor job={job} company={company} onClose={onClose} />
        )}

        {docType !== 'order' && (
          <>
            <div className="doc-modal-body">
              {docType === 'act' && (
                <div className="doc-summary">
                  <p>В акт попадут позиции из данных машины:</p>
                  <ul>
                    <li>Работ: {form.services.length} на сумму {money(servicesSum)}</li>
                    <li>Материалов: {form.parts.length} на сумму {money(partsSum)}</li>
                  </ul>
                  <p className="panel-hint">Заказ-наряд теперь оформляется на вкладке «Заказ-наряд» — с предпросмотром, правками и печатью.</p>
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
                <button disabled={saving} onClick={saveDoc}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
                {docType === 'act' && <button className="primary" disabled={saving} onClick={() => saveAndGenerate(generateActPdf)}>⬇ Скачать PDF</button>}
                {docType === 'handover' && <button className="primary" disabled={saving} onClick={() => saveAndGenerate(generateHandoverPdf)}>⬇ Скачать PDF</button>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
