import { useMemo, useState } from 'react';
import OrderDocumentEditor from './OrderDocumentEditor';
import DocEditor from './DocEditor';
import { isInsurance } from '../insurance';
import { streamsOf, defaultStream, claimOf, STREAM_CLIENT } from '../billing';
import { useModalEscape } from '../modalEscape';

const DOC_TYPES = [
  { id: 'order', label: 'Заказ-наряд' },
  { id: 'act', label: 'Акт выполненных работ' },
  { id: 'invoice', label: 'Счёт на оплату' },
  { id: 'handover', label: 'Акт приёма-передачи' },
];

export default function DocumentsModal({ job, company, onClose, onJobUpdated }) {
  const [docType, setDocType] = useState('order');
  const insured = isInsurance(job);
  // Потоки страховой машины: по одному на каждый убыток + допродажи клиента.
  // У обычной машины потоков нет → один комплект документов (recipient 'all'),
  // переключатель не показывается (как и до появления убытков).
  const streams = useMemo(() => streamsOf(job), [job]);
  const [recipient, setRecipient] = useState(() => defaultStream(job));

  // Подсказка под переключателем. Для убытка называем его реквизиты прямо — приёмщик
  // должен видеть, ЧЬИ полис/франшиза уйдут в документ, до печати, а не после.
  const hint = useMemo(() => {
    if (recipient === STREAM_CLIENT) {
      return 'Только допродажи клиента — как обычный клиентский документ, без страхового блока.';
    }
    const c = claimOf(job, recipient);
    if (!c) return '';
    const bits = [
      c.claim_number ? `убыток ${c.claim_number}` : null,
      c.insurer_name || null,
      c.order_number ? `№ ${c.order_number}` : null,
      Number(c.franchise) > 0 ? `франшиза ${Number(c.franchise).toLocaleString('ru-RU')} ₽` : null,
    ].filter(Boolean);
    return `Только позиции этого дела. ${bits.join(' · ')}`;
  }, [job, recipient]);

  // Клик мимо окна не закрывает: нативные списки на телефоне отдают странице
  // сквозной клик, и наполовину заполненная форма пропадала (см. modalEscape).
  const backdropRef = useModalEscape(onClose);

  return (
    <div className="modal-backdrop" ref={backdropRef}>
      <div className="modal modal-wide modal-order">
        <div className="doc-tabs">
          {DOC_TYPES.map((t) => (
            <button key={t.id} className={docType === t.id ? 'active' : ''} onClick={() => setDocType(t.id)}>{t.label}</button>
          ))}
        </div>

        {insured && (
          <div className="doc-recipient">
            <span className="doc-recipient-label">Кому документ:</span>
            {streams.map((s) => (
              <button
                key={s.id}
                className={recipient === s.id ? 'active' : ''}
                onClick={() => setRecipient(s.id)}
              >{s.docLabel}</button>
            ))}
            <span className="doc-recipient-hint">{hint}</span>
          </div>
        )}

        {docType === 'order'
          ? <OrderDocumentEditor key={`order-${recipient}`} job={job} company={company} recipient={recipient} onClose={onClose} onJobUpdated={onJobUpdated} />
          : <DocEditor key={`${docType}-${recipient}`} type={docType} job={job} company={company} recipient={recipient} onClose={onClose} onJobUpdated={onJobUpdated} />}
      </div>
    </div>
  );
}
