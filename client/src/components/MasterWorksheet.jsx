import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { money, formatDocDate } from '../orderDoc';
import Icon from './Icon';
import '../orderDoc.css';

// «Наряд мастера» — внутренний печатный А4-лист: какие работы по машине
// закреплены за мастером и сколько ему причитается (сдельный % + доплата).
// Чисто презентационный, рендерится из снапшота, который собирает
// buildWorksheet() (см. ../worksheet.js) из job.costing — ничего не сохраняет
// и не запрашивает.

function KV({ k, v }) {
  return <div className="zn-kv"><span className="zn-k">{k}</span><span className="zn-v">{v || '—'}</span></div>;
}

export function WorksheetSheet({ sheet }) {
  const c = sheet.company || {};
  const veh = sheet.vehicle || {};
  const idBits = [c.inn && `ИНН ${c.inn}`, c.ogrn && `ОГРНИП ${c.ogrn}`].filter(Boolean).join(' · ');
  return (
    <div className="zn-root">
      <div className="zn-sheet">
        <div className="zn-top">
          <div className="zn-brand">
            <img className="zn-logo" src="/logo-mark.png" alt="" />
            <div>
              <div className="zn-co-name">{c.name || 'Авто Академия'}</div>
              <div className="zn-co-sub">
                {idBits && <>{idBits}<br /></>}
                {c.address && <>{c.address}<br /></>}
                {c.phone && <>Тел.: <b>{c.phone}</b></>}
              </div>
            </div>
          </div>
          <div className="zn-doc-meta">
            <div className="zn-mrow"><span>Дата:</span><b>{formatDocDate(sheet.doc_date)}</b></div>
            {sheet.doc_number && <div className="zn-mrow"><span>К заказ-наряду №:</span><b>{sheet.doc_number}</b></div>}
          </div>
        </div>

        <div className="zn-title"><h1>НАРЯД МАСТЕРА</h1><div className="zn-num">внутренний документ</div></div>

        <div className="zn-info">
          <div className="zn-card">
            <div className="zn-card-h">Исполнитель (мастер)</div>
            <div className="zn-card-b">
              <KV k="ФИО" v={sheet.master?.name} />
              <KV k="Сумма к выплате" v={money(sheet.total)} />
            </div>
          </div>
          <div className="zn-card">
            <div className="zn-card-h">Транспортное средство</div>
            <div className="zn-card-b">
              <KV k="Марка и модель" v={veh.car_model} />
              <KV k="Гос. номер" v={veh.plate_number} />
              {veh.vin && <KV k="VIN" v={veh.vin} />}
            </div>
          </div>
        </div>

        <div className="zn-sec">Работы, закреплённые за мастером</div>
        <table className="zn-table">
          <thead>
            <tr><th className="zn-c-num">№</th><th>Наименование работы</th><th className="zn-c-qty">Кол-во</th><th className="zn-c-sum">Сумма, ₽</th></tr>
          </thead>
          <tbody>
            {sheet.works.map((w, i) => (
              <tr key={w.id}><td className="zn-c-num">{i + 1}</td><td>{w.name}</td><td className="zn-c-qty">{w.qty}</td><td className="zn-c-sum">{money(w.qty * w.price)}</td></tr>
            ))}
            {!sheet.works.length && <tr><td className="zn-c-num">—</td><td colSpan={3} style={{ color: '#777' }}>Работы не распределены</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3} style={{ textAlign: 'right' }}>Итого по работам:</td><td className="zn-c-sum">{money(sheet.works_sum)}</td></tr></tfoot>
        </table>

        <div className="zn-bottom">
          <div className="zn-bottom-left" />
          <div className="zn-totals">
            <div className="zn-tr"><span className="zn-tl">Стоимость работ по наряду</span><span className="zn-tv">{money(sheet.works_sum)}</span></div>
            <div className="zn-tr zn-tr-total"><span className="zn-tl">К ВЫПЛАТЕ МАСТЕРУ</span><span className="zn-tv">{money(sheet.total)}</span></div>
          </div>
        </div>

        <div className="zn-signs">
          <div className="zn-sign">
            <div className="zn-sl">Работы поручил / принял</div>
            <div className="zn-sigline"><small>подпись</small><small>дата</small></div>
            <div className="zn-name">{c.director || '—'}</div>
          </div>
          <div className="zn-sign">
            <div className="zn-sl">Мастер (работы выполнил)</div>
            <div className="zn-sigline"><small>подпись</small><small>дата</small></div>
            <div className="zn-name">{sheet.master?.name || '—'}</div>
          </div>
        </div>

        <div className="zn-foot">
          <span>{c.name || 'Авто Академия'} · Наряд мастера{sheet.doc_number ? ` к ЗН № ${sheet.doc_number}` : ''} от {formatDocDate(sheet.doc_date)} · для внутреннего учёта</span>
        </div>
      </div>
    </div>
  );
}

const A4_WIDTH_PX = 794;

// Предпросмотр наряда + печать. Печатается через общий #zn-print-mount —
// print-CSS из orderDoc.css скрывает всё приложение и оставляет только лист.
export default function MasterWorksheetModal({ sheet, onClose }) {
  const paneRef = useRef(null);
  const [scale, setScale] = useState(0.6);

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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide worksheet-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cc-header">
          <div className="cc-header-main">
            <div className="cc-header-text">
              <div className="cc-doc-label">Наряд мастера</div>
              <h3 className="cc-title">{sheet.master?.name || 'Мастер'}</h3>
              <div className="cc-header-meta">
                <span className="cc-header-sub">
                  {sheet.vehicle?.car_model || 'Без модели'}{sheet.vehicle?.plate_number ? ` · ${sheet.vehicle.plate_number}` : ''}
                </span>
              </div>
            </div>
          </div>
          <button className="cc-close" onClick={onClose} aria-label="Закрыть"><Icon name="x" size={18} strokeWidth={2} /></button>
        </div>

        <div className="worksheet-preview" ref={paneRef}>
          <div style={{ zoom: scale, display: 'inline-block' }}>
            <WorksheetSheet sheet={sheet} />
          </div>
        </div>

        <div className="cc-footer">
          <button onClick={onClose}>Закрыть</button>
          <button className="primary" onClick={() => window.print()}>🖨 Печать</button>
        </div>
      </div>

      {createPortal(<div id="zn-print-mount"><WorksheetSheet sheet={sheet} /></div>, document.body)}
    </div>
  );
}
