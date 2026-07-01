import { computeOrderTotals, money, lineTotal, formatDocDate } from '../orderDoc';

// Presentational A4 sheet. Renders purely from a snapshot — never fetches,
// never mutates. Used both for the on-screen preview and for printing.

function KV({ k, v }) {
  return (
    <div className="zn-kv"><span className="zn-k">{k}</span><span className="zn-v">{v || '—'}</span></div>
  );
}

export default function OrderDocument({ snapshot }) {
  const t = computeOrderTotals(snapshot);
  const c = snapshot.company || {};
  const cust = snapshot.customer || {};
  const veh = snapshot.vehicle || {};
  const ins = snapshot.insurance || {};
  const services = snapshot.services || [];
  const parts = snapshot.parts || [];

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
            <div className="zn-mrow"><span>Дата составления:</span><b>{formatDocDate(snapshot.doc_date)}</b></div>
            {snapshot.planned_ready_at && (
              <div className="zn-mrow"><span>Плановая готовность:</span><b>{formatDocDate(snapshot.planned_ready_at)}</b></div>
            )}
          </div>
        </div>

        <div className="zn-title">
          <h1>ЗАКАЗ-НАРЯД</h1>
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
                  {ins.policy_number && <KV k="№ полиса" v={ins.policy_number} />}
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
              {veh.mileage && <KV k="Пробег, км" v={veh.mileage} />}
            </div>
          </div>
        </div>

        {snapshot.reason && (
          <>
            <div className="zn-sec">Причина обращения / заявленные дефекты</div>
            <div className="zn-textblock">{snapshot.reason}</div>
          </>
        )}

        <div className="zn-sec">Перечень работ (услуг)</div>
        <table className="zn-table">
          <thead>
            <tr>
              <th className="zn-c-num">№</th>
              <th>Наименование работы</th>
              <th className="zn-c-qty">Кол-во</th>
              <th className="zn-c-price">Цена, ₽</th>
              <th className="zn-c-sum">Сумма, ₽</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s, i) => (
              <tr key={s.id}>
                <td className="zn-c-num">{i + 1}</td>
                <td>{s.name}</td>
                <td className="zn-c-qty">{s.qty}</td>
                <td className="zn-c-price">{money(s.price)}</td>
                <td className="zn-c-sum">{money(lineTotal(s))}</td>
              </tr>
            ))}
            {!services.length && (
              <tr><td className="zn-c-num">—</td><td colSpan={4} style={{ color: '#777' }}>Работы не добавлены</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr><td colSpan={4} style={{ textAlign: 'right' }}>Итого по работам:</td><td className="zn-c-sum">{money(t.services_sum)}</td></tr>
          </tfoot>
        </table>

        <div className="zn-sec">Запчасти и материалы</div>
        <table className="zn-table">
          <thead>
            <tr>
              <th className="zn-c-num">№</th>
              <th className="zn-c-code">Артикул</th>
              <th>Наименование</th>
              <th className="zn-c-qty">Кол-во</th>
              <th className="zn-c-unit">Ед.</th>
              <th className="zn-c-price">Цена, ₽</th>
              <th className="zn-c-sum">Сумма, ₽</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <tr key={p.id}>
                <td className="zn-c-num">{i + 1}</td>
                <td>{p.code || '—'}</td>
                <td>{p.name}</td>
                <td className="zn-c-qty">{p.qty}</td>
                <td className="zn-c-unit">{p.unit || 'шт.'}</td>
                <td className="zn-c-price">{money(p.price)}</td>
                <td className="zn-c-sum">{money(lineTotal(p))}</td>
              </tr>
            ))}
            {!parts.length && (
              <tr><td className="zn-c-num">—</td><td colSpan={6} style={{ color: '#777' }}>Запчасти не добавлены</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr><td colSpan={6} style={{ textAlign: 'right' }}>Итого по запчастям / материалам:</td><td className="zn-c-sum">{money(t.parts_sum)}</td></tr>
          </tfoot>
        </table>

        <div className="zn-bottom">
          <div className="zn-bottom-left">
            {snapshot.show_recommendations && (
              <>
                <div className="zn-sec">Рекомендации</div>
                <div className="zn-textblock">{snapshot.recommendations || '—'}</div>
              </>
            )}
          </div>
          <div className="zn-totals">
            <div className="zn-tr"><span className="zn-tl">Итого по работам</span><span className="zn-tv">{money(t.services_sum)}</span></div>
            <div className="zn-tr"><span className="zn-tl">Итого по запчастям</span><span className="zn-tv">{money(t.parts_sum)}</span></div>
            {t.discount > 0 && <div className="zn-tr"><span className="zn-tl">Скидка</span><span className="zn-tv">− {money(t.discount)}</span></div>}
            <div className="zn-tr zn-tr-total"><span className="zn-tl">ИТОГО К ОПЛАТЕ</span><span className="zn-tv">{money(t.total)}</span></div>
            <div className="zn-words">{t.total_words}</div>
            {t.prepayment > 0 && <div className="zn-tr"><span className="zn-tl">Предоплата</span><span className="zn-tv">{money(t.prepayment)}</span></div>}
            {t.prepayment > 0 && <div className="zn-tr"><span className="zn-tl">К доплате</span><span className="zn-tv">{money(t.due)}</span></div>}
          </div>
        </div>

        {(snapshot.show_warranty || snapshot.show_consent) && (
          <div className="zn-legal">
            {snapshot.show_warranty && (
              <>
                <span className="zn-lh">Гарантия</span>
                <p>{snapshot.warranty_text}</p>
              </>
            )}
            {snapshot.show_consent && (
              <>
                <span className="zn-lh">Согласие заказчика</span>
                <p>{snapshot.consent_text}</p>
              </>
            )}
          </div>
        )}

        <div className="zn-signs">
          <div className="zn-sign">
            <div className="zn-sl">Исполнитель</div>
            <div className="zn-sigline"><small>подпись</small><small>М.П.</small></div>
            <div className="zn-name">{c.director || '—'}</div>
          </div>
          <div className="zn-sign">
            <div className="zn-sl">Заказчик</div>
            <div className="zn-sigline"><small>подпись</small><small>расшифровка</small></div>
            <div className="zn-name">{cust.name || '—'}</div>
            <div className="zn-date">«___» ______________ 20___ г.</div>
          </div>
        </div>

        <div className="zn-foot">
          <span>{c.name || 'Авто Академия'} · Заказ-наряд № {snapshot.doc_number || '—'} от {formatDocDate(snapshot.doc_date)}</span>
        </div>
      </div>
    </div>
  );
}
