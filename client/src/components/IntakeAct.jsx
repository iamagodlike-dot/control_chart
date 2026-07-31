import { formatDocDate } from '../orderDoc';
import { policyTypeLabel } from '../insurance';

// Печатный лист «Акт приёмки транспортного средства» (ПР-ГГГГ-NNNN).
//
// Как и остальные документы проекта — ЧИСТО презентационный компонент поверх
// замороженного снимка (buildIntakeActSnapshot): ничего не дочитывает и ничего не
// меняет. Классы `zn-*` общие с заказ-нарядом/актом/счётом, поэтому лист сам
// ужимается под один лист A4 через printFitted() (см. printDoc.js).
//
// НЕ ПУТАТЬ с «Актом приёма-передачи» (ПП): тот подписывают при ВЫДАЧЕ готовой
// машины, этот — при ЗАЕЗДЕ, до ремонта.

function KV({ k, v }) {
  return (
    <div className="zn-kv"><span className="zn-k">{k}</span><span className="zn-v">{v || '—'}</span></div>
  );
}

// Комплектность и документы печатаем ПОЛНЫМ списком с отметкой есть/нет.
// «Запаски не было» защищает сервис ровно так же, как «запаска была», — поэтому
// отсутствующие позиции не выбрасываем, а помечаем.
function Checks({ items }) {
  if (!items.length) return <div className="zn-textblock">—</div>;
  return (
    <div className="zn-checks">
      {items.map((it) => (
        <span key={it.label} className={it.present ? 'is-yes' : 'is-no'}>
          {it.present ? '✓' : '✕'} {it.label}
        </span>
      ))}
    </div>
  );
}

export default function IntakeAct({ snapshot }) {
  const c = snapshot.company || {};
  const cust = snapshot.customer || {};
  const veh = snapshot.vehicle || {};
  const ins = snapshot.insurance || {};
  const cond = snapshot.condition || {};
  const damages = snapshot.damages || [];

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
            <div className="zn-mrow"><span>Дата приёмки:</span><b>{formatDocDate(snapshot.doc_date)}</b></div>
            {ins.order_number && (
              <div className="zn-mrow"><span>Заказ-наряд:</span><b>{ins.order_number}</b></div>
            )}
          </div>
        </div>

        <div className="zn-title">
          <h1>АКТ ПРИЁМКИ ТРАНСПОРТНОГО СРЕДСТВА</h1>
          <div className="zn-num">№ {snapshot.doc_number || '—'}</div>
        </div>

        <div className="zn-info">
          <div className="zn-card">
            <div className="zn-card-h">Заказчик</div>
            <div className="zn-card-b">
              <KV k="ФИО / наименование" v={cust.name} />
              <KV k="Телефон" v={cust.phone} />
              {ins.payment_type === 'insurance' && (
                <>
                  <KV k="Оплата" v={`Страховая${ins.insurer_name ? ` — ${ins.insurer_name}` : ''}`} />
                  {ins.claim_number && <KV k="№ убытка" v={ins.claim_number} />}
                  {ins.policy_type && <KV k="Тип полиса" v={policyTypeLabel(ins.policy_type)} />}
                </>
              )}
              {ins.payment_type === 'legal' && <KV k="Оплата" v="Юридическое лицо" />}
            </div>
          </div>
          <div className="zn-card">
            <div className="zn-card-h">Транспортное средство</div>
            <div className="zn-card-b">
              <KV k="Марка и модель" v={veh.car_model} />
              <KV k="Гос. номер" v={veh.plate_number} />
              {veh.vin && <KV k="VIN" v={veh.vin} />}
              {veh.year && <KV k="Год выпуска" v={veh.year} />}
              {veh.color && <KV k="Цвет" v={veh.color} />}
            </div>
          </div>
        </div>

        <div className="zn-sec">Состояние на момент приёмки</div>
        <div className="zn-checks">
          <span>Пробег: <b>{cond.mileage ? `${cond.mileage} км` : '—'}</b></span>
          <span>Топливо: <b>{cond.fuel_label || '—'}</b></span>
          <span>Ключи, комплектов: <b>{cond.keys || '—'}</b></span>
          <span>Фотофиксация, снимков: <b>{snapshot.photos_count || 0}</b></span>
        </div>

        <div className="zn-sec">Переданные документы</div>
        <Checks items={snapshot.docs || []} />

        <div className="zn-sec">Комплектность</div>
        <Checks items={snapshot.equipment || []} />

        <div className="zn-sec">Зафиксированные повреждения</div>
        {/* Колонка «Отношение» — то, за что платит страховая, и то, что было на
            машине до случая. Без неё на калькуляции разбирают заново, уже без
            машины перед глазами; на бумаге клиент подписывает это разделение. */}
        <table className="zn-table">
          <thead>
            <tr>
              <th className="zn-c-num">№</th>
              <th>Элемент / зона</th>
              <th className="zn-c-code">Характер</th>
              <th className="zn-c-code">Отношение</th>
              <th>Примечание</th>
            </tr>
          </thead>
          <tbody>
            {damages.map((d, i) => (
              <tr key={`${d.zone}-${i}`}>
                <td className="zn-c-num">{i + 1}</td>
                <td>{d.zone}</td>
                <td>{d.kind}</td>
                <td>{d.scope}</td>
                <td>{d.note || '—'}</td>
              </tr>
            ))}
            {!damages.length && (
              <tr>
                <td className="zn-c-num">—</td>
                <td colSpan={4} style={{ color: '#777' }}>Видимых повреждений при осмотре не зафиксировано</td>
              </tr>
            )}
          </tbody>
        </table>

        {snapshot.notes && (
          <>
            <div className="zn-sec">Примечания</div>
            <div className="zn-textblock">{snapshot.notes}</div>
          </>
        )}

        {snapshot.act_text && (
          <div className="zn-legal">
            <span className="zn-lh">Условия приёмки</span>
            <p>{snapshot.act_text}</p>
          </div>
        )}

        <div className="zn-signs">
          <div className="zn-sign">
            <div className="zn-sl">ТС сдал (Заказчик)</div>
            <div className="zn-sigline"><small>подпись</small><small>расшифровка</small></div>
            <div className="zn-name">{cust.name || '—'}</div>
            <div className="zn-date">«___» ______________ 20___ г.</div>
          </div>
          <div className="zn-sign">
            <div className="zn-sl">ТС принял (Мастер-приёмщик)</div>
            <div className="zn-sigline"><small>подпись</small><small>расшифровка</small></div>
            <div className="zn-name">{snapshot.accepted_by || '—'}</div>
            <div className="zn-date">«___» ______________ 20___ г.</div>
          </div>
        </div>

        <div className="zn-foot">
          <span>
            {c.name || 'Авто Академия'} · Акт приёмки ТС № {snapshot.doc_number || '—'}
            {' '}от {formatDocDate(snapshot.doc_date)}
            {veh.plate_number ? ` · ${veh.plate_number}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
