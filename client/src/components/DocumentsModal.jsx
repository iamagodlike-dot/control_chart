import { useState } from 'react';
import OrderDocumentEditor from './OrderDocumentEditor';
import DocEditor from './DocEditor';

const DOC_TYPES = [
  { id: 'order', label: 'Заказ-наряд' },
  { id: 'act', label: 'Акт выполненных работ' },
  { id: 'invoice', label: 'Счёт на оплату' },
  { id: 'handover', label: 'Акт приёма-передачи' },
];

export default function DocumentsModal({ job, company, onClose }) {
  const [docType, setDocType] = useState('order');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide modal-order" onClick={(e) => e.stopPropagation()}>
        <div className="doc-tabs">
          {DOC_TYPES.map((t) => (
            <button key={t.id} className={docType === t.id ? 'active' : ''} onClick={() => setDocType(t.id)}>{t.label}</button>
          ))}
        </div>

        {docType === 'order'
          ? <OrderDocumentEditor job={job} company={company} onClose={onClose} />
          : <DocEditor key={docType} type={docType} job={job} company={company} onClose={onClose} />}
      </div>
    </div>
  );
}
