import { money, formatDocDate } from '../orderDoc';
import '../orderDoc.css';
import '../masterOrder.css';

// «Наряд-задание» — ВНУТРЕННИЙ печатный лист: что мастер делает по этой машине и
// сколько ему за это причитается. Лист на каждого мастера (для подписи).
//
// Здесь НЕТ страховых цен, юр-блоков и маржи: наружу такой документ не уходит.
// Компонент чисто презентационный — получает готовый снимок из
// buildMasterOrderSheets() (masterOrder.js) и ничего не грузит.

function KV({ k, v }) {
  return <div className="zn-kv"><span className="zn-k">{k}</span><span className="zn-v">{v || '—'}</span></div>;
}

export function MasterOrderSheet({ sheet }) {
  const c = sheet.company || {};
  const veh = sheet.vehicle || {};
  const idBits = [c.inn && `ИНН ${c.inn}`, c.ogrn && `ОГРНИП ${c.ogrn}`].filter(Boolean).join(' · ');
  return (
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
          {sheet.doc_number && <div className="zn-mrow"><span>Заказ-наряд №:</span><b>{sheet.doc_number}</b></div>}
        </div>
      </div>

      <div className="zn-title">
        <h1>НАРЯД-ЗАДАНИЕ</h1>
        <div className="zn-num">внутренний документ</div>
      </div>

      <div className="zn-info">
        <div className="zn-card">
          <div className="zn-card-h">Исполнитель</div>
          <div className="zn-card-b">
            <KV k="Мастер" v={sheet.master_name} />
            <KV k="Работ в наряде" v={String(sheet.rows.length)} />
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

      <div className="zn-sec">Работы</div>
      <table className="zn-table">
        <thead>
          <tr>
            <th className="zn-c-num">№</th>
            <th>Наименование работы</th>
            <th className="zn-c-qty">Кол-во</th>
            <th className="zn-c-sum">Сумма, ₽</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((w, i) => (
            <tr key={w.id}>
              <td className="zn-c-num">{i + 1}</td>
              <td>{w.name || '—'}</td>
              <td className="zn-c-qty">{w.qty}</td>
              <td className="zn-c-sum">{money(w.sum)}</td>
            </tr>
          ))}
          {!sheet.rows.length && (
            <tr><td className="zn-c-num">—</td><td colSpan={3} style={{ color: '#777' }}>Работы не назначены</td></tr>
          )}
        </tbody>
      </table>

      <div className="zn-bottom">
        <div className="zn-bottom-left" />
        <div className="zn-totals">
          <div className="zn-tr zn-tr-total"><span className="zn-tl">К ОПЛАТЕ МАСТЕРУ</span><span className="zn-tv">{money(sheet.subtotal)}</span></div>
        </div>
      </div>

      <div className="zn-signs">
        <div className="zn-sign">
          <div className="zn-sl">Работы поручил</div>
          <div className="zn-sigline"><small>подпись</small><small>дата</small></div>
          <div className="zn-name">{c.director || '—'}</div>
        </div>
        <div className="zn-sign">
          <div className="zn-sl">Мастер (работы принял)</div>
          <div className="zn-sigline"><small>подпись</small><small>дата</small></div>
          <div className="zn-name">{sheet.master_name || '—'}</div>
        </div>
      </div>

      <div className="zn-foot">
        <span>
          {c.name || 'Авто Академия'} · Наряд-задание{sheet.doc_number ? ` к ЗН № ${sheet.doc_number}` : ''} от {formatDocDate(sheet.doc_date)} · для внутреннего учёта
        </span>
      </div>
    </div>
  );
}

// Пачка листов — по одному на мастера. Разрыв страницы между ними задаёт
// masterOrder.css; масштаб под страницу printDoc.printFitted ставит каждому листу
// отдельно.
export default function MasterOrderSheets({ sheets = [] }) {
  return (
    <div className="zn-root">
      {sheets.map((s) => <MasterOrderSheet key={s.master_id} sheet={s} />)}
    </div>
  );
}
