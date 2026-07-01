import { computeDocTotals, money, lineTotal, formatDocDate } from '../orderDoc';

// Presentational A4 sheet for акт выполненных работ / акт приёма-передачи / счёт.
// Renders purely from a snapshot (never fetches, never mutates). Reuses the
// заказ-наряд .zn-* styles so all documents look like siblings.

function KV({ k, v }) {
  return <div className="zn-kv"><span className="zn-k">{k}</span><span className="zn-v">{v || '—'}</span></div>;
}

// Payer / insurance rows shared by every document's customer card.
function InsuranceRows({ ins }) {
  const i = ins || {};
  if (i.payment_type === 'legal') return <KV k="Оплата" v="Юридическое лицо" />;
  if (i.payment_type !== 'insurance') return null;
  return (
    <>
      <KV k="Оплата" v={`Страховая${i.insurer_name ? ` — ${i.insurer_name}` : ''}`} />
      {i.claim_number && <KV k="№ убытка" v={i.claim_number} />}
      {i.policy_number && <KV k="№ полиса" v={i.policy_number} />}
    </>
  );
}

function money2(v) {
  return `${(Number(v) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

function DocHeader({ c, meta }) {
  const idBits = [c.inn && `ИНН ${c.inn}`, c.kpp && `КПП ${c.kpp}`, c.ogrn && `ОГРНИП ${c.ogrn}`].filter(Boolean).join(' · ');
  return (
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
      <div className="zn-doc-meta">{meta}</div>
    </div>
  );
}

function CustomerCard({ cust, rows }) {
  return (
    <div className="zn-card">
      <div className="zn-card-h">Заказчик</div>
      <div className="zn-card-b">
        <KV k="ФИО / наименование" v={cust.name} />
        <KV k="Телефон" v={cust.phone} />
        {rows}
      </div>
    </div>
  );
}

function VehicleCard({ veh }) {
  return (
    <div className="zn-card">
      <div className="zn-card-h">Транспортное средство</div>
      <div className="zn-card-b">
        <KV k="Марка и модель" v={veh.car_model} />
        <KV k="Гос. номер" v={veh.plate_number} />
        {veh.vin && <KV k="VIN" v={veh.vin} />}
        {veh.year && <KV k="Год выпуска" v={veh.year} />}
      </div>
    </div>
  );
}

function WorksTable({ services, totals }) {
  return (
    <>
      <div className="zn-sec">Перечень работ (услуг)</div>
      <table className="zn-table">
        <thead>
          <tr><th className="zn-c-num">№</th><th>Наименование работы</th><th className="zn-c-qty">Кол-во</th><th className="zn-c-price">Цена, ₽</th><th className="zn-c-sum">Сумма, ₽</th></tr>
        </thead>
        <tbody>
          {services.map((s, i) => (
            <tr key={s.id}><td className="zn-c-num">{i + 1}</td><td>{s.name}</td><td className="zn-c-qty">{s.qty}</td><td className="zn-c-price">{money(s.price)}</td><td className="zn-c-sum">{money(lineTotal(s))}</td></tr>
          ))}
          {!services.length && <tr><td className="zn-c-num">—</td><td colSpan={4} style={{ color: '#777' }}>Работы не добавлены</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={4} style={{ textAlign: 'right' }}>Итого по работам:</td><td className="zn-c-sum">{money(totals.services_sum)}</td></tr></tfoot>
      </table>
    </>
  );
}

function PartsTable({ parts, totals }) {
  return (
    <>
      <div className="zn-sec">Запчасти и материалы</div>
      <table className="zn-table">
        <thead>
          <tr><th className="zn-c-num">№</th><th className="zn-c-code">Артикул</th><th>Наименование</th><th className="zn-c-qty">Кол-во</th><th className="zn-c-unit">Ед.</th><th className="zn-c-price">Цена, ₽</th><th className="zn-c-sum">Сумма, ₽</th></tr>
        </thead>
        <tbody>
          {parts.map((p, i) => (
            <tr key={p.id}><td className="zn-c-num">{i + 1}</td><td>{p.code || '—'}</td><td>{p.name}</td><td className="zn-c-qty">{p.qty}</td><td className="zn-c-unit">{p.unit || 'шт.'}</td><td className="zn-c-price">{money(p.price)}</td><td className="zn-c-sum">{money(lineTotal(p))}</td></tr>
          ))}
          {!parts.length && <tr><td className="zn-c-num">—</td><td colSpan={6} style={{ color: '#777' }}>Запчасти не добавлены</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={6} style={{ textAlign: 'right' }}>Итого по запчастям / материалам:</td><td className="zn-c-sum">{money(totals.parts_sum)}</td></tr></tfoot>
      </table>
    </>
  );
}

function TotalsBox({ totals, showPrepayment }) {
  return (
    <div className="zn-totals">
      <div className="zn-tr"><span className="zn-tl">Итого по работам</span><span className="zn-tv">{money(totals.services_sum)}</span></div>
      <div className="zn-tr"><span className="zn-tl">Итого по запчастям</span><span className="zn-tv">{money(totals.parts_sum)}</span></div>
      {totals.discount > 0 && <div className="zn-tr"><span className="zn-tl">Скидка</span><span className="zn-tv">− {money(totals.discount)}</span></div>}
      <div className="zn-tr zn-tr-total"><span className="zn-tl">ИТОГО</span><span className="zn-tv">{money(totals.total)}</span></div>
      <div className="zn-words">{totals.total_words}</div>
      {showPrepayment && totals.prepayment > 0 && <div className="zn-tr"><span className="zn-tl">Предоплата</span><span className="zn-tv">{money(totals.prepayment)}</span></div>}
      {showPrepayment && totals.prepayment > 0 && <div className="zn-tr"><span className="zn-tl">К доплате</span><span className="zn-tv">{money(totals.due)}</span></div>}
    </div>
  );
}

function Signatures({ leftTitle, leftName, rightTitle, rightName, stamp = true }) {
  return (
    <div className="zn-signs">
      <div className="zn-sign">
        <div className="zn-sl">{leftTitle}</div>
        <div className="zn-sigline"><small>подпись</small>{stamp && <small>М.П.</small>}</div>
        <div className="zn-name">{leftName || '—'}</div>
      </div>
      <div className="zn-sign">
        <div className="zn-sl">{rightTitle}</div>
        <div className="zn-sigline"><small>подпись</small><small>расшифровка</small></div>
        <div className="zn-name">{rightName || '—'}</div>
      </div>
    </div>
  );
}

function Foot({ c, title, snapshot }) {
  return (
    <div className="zn-foot">
      <span>{c.name || 'Авто Академия'} · {title} № {snapshot.doc_number || '—'} от {formatDocDate(snapshot.doc_date)}</span>
    </div>
  );
}

// ---------------- АКТ ВЫПОЛНЕННЫХ РАБОТ ----------------
function ActSheet({ snapshot }) {
  const t = computeDocTotals(snapshot);
  const c = snapshot.company || {};
  return (
    <div className="zn-sheet">
      <DocHeader c={c} meta={<>
        <div className="zn-mrow"><span>Дата:</span><b>{formatDocDate(snapshot.doc_date)}</b></div>
        {snapshot.order_ref && <div className="zn-mrow"><span>К заказ-наряду №:</span><b>{snapshot.order_ref}</b></div>}
      </>} />
      <div className="zn-title"><h1>АКТ ВЫПОЛНЕННЫХ РАБОТ</h1><div className="zn-num">№ {snapshot.doc_number || '—'}</div></div>
      <div className="zn-info"><CustomerCard cust={snapshot.customer || {}} rows={<InsuranceRows ins={snapshot.insurance} />} /><VehicleCard veh={snapshot.vehicle || {}} /></div>
      <WorksTable services={snapshot.services || []} totals={t} />
      <PartsTable parts={snapshot.parts || []} totals={t} />
      <div className="zn-bottom">
        <div className="zn-bottom-left">
          {snapshot.show_recommendations && <><div className="zn-sec">Рекомендации</div><div className="zn-textblock">{snapshot.recommendations || '—'}</div></>}
        </div>
        <TotalsBox totals={t} showPrepayment />
      </div>
      {(snapshot.show_act_text || snapshot.show_warranty) && (
        <div className="zn-legal">
          {snapshot.show_act_text && <p>{snapshot.act_text}</p>}
          {snapshot.show_warranty && <><span className="zn-lh">Гарантия</span><p>{snapshot.warranty_text}</p></>}
        </div>
      )}
      <Signatures leftTitle="Исполнитель" leftName={c.director} rightTitle="Заказчик" rightName={(snapshot.customer || {}).name} />
      <Foot c={c} title="Акт выполненных работ" snapshot={snapshot} />
    </div>
  );
}

// ---------------- АКТ ПРИЁМА-ПЕРЕДАЧИ ----------------
function HandoverSheet({ snapshot }) {
  const c = snapshot.company || {};
  const cond = snapshot.condition || {};
  return (
    <div className="zn-sheet">
      <DocHeader c={c} meta={<div className="zn-mrow"><span>Дата составления:</span><b>{formatDocDate(snapshot.doc_date)}</b></div>} />
      <div className="zn-title"><h1>АКТ ПРИЁМА-ПЕРЕДАЧИ ТРАНСПОРТНОГО СРЕДСТВА</h1><div className="zn-num">№ {snapshot.doc_number || '—'}</div></div>
      <div className="zn-info"><CustomerCard cust={snapshot.customer || {}} rows={<InsuranceRows ins={snapshot.insurance} />} /><VehicleCard veh={snapshot.vehicle || {}} /></div>
      <div className="zn-info">
        {snapshot.show_intake && (
          <div className="zn-card">
            <div className="zn-card-h">При приёме ТС</div>
            <div className="zn-card-b">
              <KV k="Пробег при приёме, км" v={cond.mileage_in} />
              <KV k="Комплектация" v={cond.equipment} />
              <KV k="Повреждения / состояние" v={cond.condition_in} />
            </div>
          </div>
        )}
        {snapshot.show_issue && (
          <div className="zn-card">
            <div className="zn-card-h">При выдаче ТС</div>
            <div className="zn-card-b">
              <KV k="Пробег при выдаче, км" v={cond.mileage_out} />
              <KV k="Состояние при выдаче" v={cond.condition_out} />
            </div>
          </div>
        )}
      </div>
      {snapshot.show_handover_text && <div className="zn-legal"><p>{snapshot.handover_text}</p></div>}
      <Signatures leftTitle="Исполнитель (ТС сдал)" leftName={c.director} rightTitle="Заказчик (ТС принял)" rightName={(snapshot.customer || {}).name} />
      <Foot c={c} title="Акт приёма-передачи" snapshot={snapshot} />
    </div>
  );
}

// ---------------- СЧЁТ НА ОПЛАТУ ----------------
function InvoiceSheet({ snapshot, qrDataUrl }) {
  const t = computeDocTotals(snapshot);
  const c = snapshot.company || {};
  const bank = c.bank || {};
  const veh = snapshot.vehicle || {};
  const items = [
    ...(snapshot.services || []).map((s) => ({ ...s, unit: 'усл.' })),
    ...(snapshot.parts || []).map((p) => ({ ...p })),
  ];
  return (
    <div className="zn-sheet">
      <DocHeader c={c} meta={<>
        <div className="zn-mrow"><span>Дата счёта:</span><b>{formatDocDate(snapshot.doc_date)}</b></div>
        {snapshot.order_ref && <div className="zn-mrow"><span>Основание:</span><b>Заказ-наряд № {snapshot.order_ref}</b></div>}
      </>} />

      <table className="zn-bank">
        <thead><tr><th colSpan={4}>Реквизиты для оплаты</th></tr></thead>
        <tbody>
          <tr><td className="zn-bank-l">Банк получателя</td><td className="zn-bank-v">{bank.bank_name || '—'}</td><td className="zn-bank-l">БИК</td><td className="zn-bank-v">{bank.bik || '—'}</td></tr>
          <tr><td className="zn-bank-l" rowSpan={2}>Получатель</td><td className="zn-bank-v" rowSpan={2}>{c.name || '—'}{c.inn ? `, ИНН ${c.inn}` : ''}{c.kpp ? `, КПП ${c.kpp}` : ''}</td><td className="zn-bank-l">Сч. № (к/с)</td><td className="zn-bank-v">{bank.corr_account || '—'}</td></tr>
          <tr><td className="zn-bank-l">Сч. № (р/с)</td><td className="zn-bank-v">{bank.account || '—'}</td></tr>
        </tbody>
      </table>

      <div className="zn-title"><h1>СЧЁТ НА ОПЛАТУ</h1><div className="zn-num">№ {snapshot.doc_number || '—'} от {formatDocDate(snapshot.doc_date)}</div></div>

      <div className="zn-info">
        <div className="zn-card">
          <div className="zn-card-h">Поставщик (Исполнитель)</div>
          <div className="zn-card-b">
            <KV k="Наименование" v={c.name} />
            <KV k="ИНН / ОГРНИП" v={[c.inn, c.ogrn].filter(Boolean).join(' / ')} />
            <KV k="Адрес" v={c.address} />
            <KV k="Телефон" v={c.phone} />
          </div>
        </div>
        <div className="zn-card">
          <div className="zn-card-h">Покупатель (Заказчик)</div>
          <div className="zn-card-b">
            <KV k="ФИО / наименование" v={snapshot.customer?.name} />
            <KV k="Телефон" v={snapshot.customer?.phone} />
            {(veh.car_model || veh.plate_number) && <KV k="Автомобиль" v={[veh.car_model, veh.plate_number].filter(Boolean).join(', ')} />}
            <InsuranceRows ins={snapshot.insurance} />
          </div>
        </div>
      </div>

      <div className="zn-sec">Товар (работы, услуги)</div>
      <table className="zn-table">
        <thead>
          <tr><th className="zn-c-num">№</th><th>Наименование</th><th className="zn-c-qty">Кол-во</th><th className="zn-c-unit">Ед.</th><th className="zn-c-price">Цена, ₽</th><th className="zn-c-sum">Сумма, ₽</th></tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id}><td className="zn-c-num">{i + 1}</td><td>{it.name}</td><td className="zn-c-qty">{it.qty}</td><td className="zn-c-unit">{it.unit || 'шт.'}</td><td className="zn-c-price">{money(it.price)}</td><td className="zn-c-sum">{money(lineTotal(it))}</td></tr>
          ))}
          {!items.length && <tr><td className="zn-c-num">—</td><td colSpan={5} style={{ color: '#777' }}>Позиции не добавлены</td></tr>}
        </tbody>
        <tfoot>
          {t.discount > 0 && <tr><td colSpan={5} style={{ textAlign: 'right' }}>Скидка:</td><td className="zn-c-sum">− {money(t.discount)}</td></tr>}
          <tr><td colSpan={5} style={{ textAlign: 'right' }}>Итого:</td><td className="zn-c-sum">{money(t.total)}</td></tr>
          <tr><td colSpan={5} style={{ textAlign: 'right' }}>{t.vat_mode === 'vat20' ? 'В том числе НДС 20%:' : 'НДС:'}</td><td className="zn-c-sum">{t.vat_mode === 'vat20' ? money2(t.vat_amount) : 'Без НДС'}</td></tr>
        </tfoot>
      </table>

      <div className="zn-invoice-total">
        Всего наименований {items.length}, на сумму <b>{money(t.total)}</b>
        <div className="zn-words">{t.total_words}</div>
      </div>

      {snapshot.show_qr && qrDataUrl && (
        <div className="zn-qr">
          <img src={qrDataUrl} alt="QR для оплаты" width={128} height={128} />
          <div className="zn-qr-cap">Отсканируйте в приложении банка<br />для оплаты счёта</div>
        </div>
      )}

      {snapshot.show_invoice_note && <div className="zn-legal"><p>{snapshot.invoice_note}</p></div>}

      <Signatures leftTitle="Руководитель" leftName={c.director} rightTitle="Бухгалтер" rightName={c.director} />
      <Foot c={c} title="Счёт" snapshot={snapshot} />
    </div>
  );
}

export default function DocSheet({ snapshot, qrDataUrl }) {
  return (
    <div className="zn-root">
      {snapshot.type === 'act' && <ActSheet snapshot={snapshot} />}
      {snapshot.type === 'handover' && <HandoverSheet snapshot={snapshot} />}
      {snapshot.type === 'invoice' && <InvoiceSheet snapshot={snapshot} qrDataUrl={qrDataUrl} />}
    </div>
  );
}
