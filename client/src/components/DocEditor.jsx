import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import QRCode from 'qrcode';
import { api } from '../api';
import DocSheet from './DocSheet';
import DocLineItems from './DocLineItems';
import DocPreviewPane from './DocPreviewPane';
import CollapsibleSection from './CollapsibleSection';
import DocTotal from './DocTotal';
import DiscountField from './DiscountField';
import DateTimeField from './DateTimeField';
import { printFitted } from '../printDoc';
import {
  buildActSnapshot, buildInvoiceSnapshot, buildHandoverSnapshot, pickSeedItems,
  computeDocTotals, buildPaymentQrString, qrIsComplete, uid,
  formatDocDate, buildPartsConsentText, orderMatchesRecipient, DEFAULT_ACT_TEXT, DEFAULT_WARRANTY, DEFAULT_INVOICE_NOTE, DEFAULT_HANDOVER_TEXT, DEFAULT_INTAKE_TEXT,
} from '../orderDoc';
import { applyDocToCar } from '../docToCar';
import { downloadDocExcel } from '../docExcel';
import {
  countedInvoiceIds, invoiceRole, invoiceStatus,
  ROLE_AUTO, ROLE_EXTRA, ROLE_VOID, INVOICE_STATUS_HINT,
} from '../invoices';
import '../orderDoc.css';

// Короткая метка счёта в списке «Ранее выданные».
const INVOICE_TAG = { main: 'считается', extra: 'доп.', replaced: 'версия', void: 'не учит.' };

// Как счёт участвует в деньгах. Правило по умолчанию — «считается последний
// выставленный» — снимает главную беду: перевыставленный счёт больше не удваивает
// сумму ремонта. Две ручные пометки закрывают случаи, где правило не подходит.
const ROLES = [
  { id: ROLE_AUTO, label: 'Обычный счёт', hint: 'По каждому убытку в деньгах участвует последний выставленный счёт. Если перевыставите — этот станет предыдущей версией и считаться перестанет.' },
  { id: ROLE_EXTRA, label: 'Доп. счёт (часть суммы)', hint: 'Счёт на часть суммы — аванс или доплата. Считается всегда и складывается с основным счётом.' },
  { id: ROLE_VOID, label: 'Не учитывать', hint: 'Дубль или аннулированный счёт: в сумме по машине, в долге и в денежной ленте не участвует.' },
];

function buildInitial(type, job, company, recipient, direction = 'intake') {
  if (type === 'act') return buildActSnapshot(job, company, null, recipient);
  if (type === 'invoice') return buildInvoiceSnapshot(job, company, null, recipient);
  return buildHandoverSnapshot(job, company, recipient, direction);
}

function seedFromExisting(existingDoc) {
  const { id, created_at, updated_at, created_by, ...rest } = existingDoc; // eslint-disable-line no-unused-vars
  return rest;
}

// Пробег в акте приёма-передачи один (см. patchMileage). У ранее сохранённых актов
// одна из двух клеток обычно пустая — её нечем было заполнить; подставляем соседнюю,
// чтобы в акте не печаталось «—». Два разных вписанных вручную числа не трогаем:
// это уже выданный документ.
function withSyncedMileage(snap) {
  const cond = snap.condition || {};
  const one = String(cond.mileage_in || '').trim() || String(cond.mileage_out || '').trim();
  if (!one) return snap;
  return { ...snap, condition: { ...cond, mileage_in: cond.mileage_in || one, mileage_out: cond.mileage_out || one } };
}

export default function DocEditor({ type, job, company, recipient = 'all', onClose, onJobUpdated }) {
  // Направление акта приёма-передачи: 'intake' (приём в сервис) / 'issue' (выдача клиенту).
  const [direction, setDirection] = useState('intake');
  const [snapshot, setSnapshot] = useState(() => buildInitial(type, job, company, recipient, 'intake'));
  const [docId, setDocId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedToCar, setSavedToCar] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [history, setHistory] = useState([]);
  // id счетов машины, участвующих в деньгах. Считаем по ВСЕМ её счетам (а не по
  // отфильтрованной истории), чтобы метка «считается» не зависела от того, какая
  // вкладка получателя сейчас открыта.
  const [countedIds, setCountedIds] = useState(() => new Set());
  const [qrDataUrl, setQrDataUrl] = useState('');
  const touchedRef = useRef(false);

  const isAct = type === 'act';
  const isInvoice = type === 'invoice';
  const isHandover = type === 'handover';
  const hasItems = isAct || isInvoice;

  useEffect(() => { const img = new Image(); img.src = '/logo-mark.png'; }, []);

  async function refresh() {
    if (!job?.id) return [];
    try {
      const all = await api.orderDocuments.listByJob(job.id);
      // Ранее выданные — только этого типа И этого получателя (страховой/клиент),
      // чтобы страховые и клиентские документы не смешивались.
      setHistory(all.filter((d) => d.type === type && (recipient === 'all' || orderMatchesRecipient(d, recipient))));
      setCountedIds(countedInvoiceIds(all.filter((d) => d.type === 'invoice')));
      return all;
    } catch {
      setHistory([]);
      setCountedIds(new Set());
      return [];
    }
  }

  // On mount: load history and (act/invoice) seed items from the last заказ-наряд.
  useEffect(() => {
    (async () => {
      const all = await refresh();
      if (hasItems && !touchedRef.current) {
        const seed = pickSeedItems(job, all, recipient);
        if (seed.source === 'order') {
          setSnapshot((s) => (touchedRef.current ? s : (isAct ? buildActSnapshot(job, company, seed, recipient) : buildInvoiceSnapshot(job, company, seed, recipient))));
        }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Regenerate the payment QR for the счёт whenever the snapshot changes.
  // (DocSheet only shows it when show_qr, so no need to clear it here.)
  useEffect(() => {
    if (!isInvoice || !snapshot.show_qr) return undefined;
    let cancelled = false;
    QRCode.toDataURL(buildPaymentQrString(snapshot), { margin: 1, width: 256 })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(''); });
    return () => { cancelled = true; };
  }, [isInvoice, snapshot]);

  function patch(fields) { touchedRef.current = true; setSnapshot((s) => ({ ...s, ...fields })); setSaved(false); }
  function patchGroup(group, fields) { touchedRef.current = true; setSnapshot((s) => ({ ...s, [group]: { ...s[group], ...fields } })); setSaved(false); setSavedToCar(false); }

  // Пробег в акте приёма-передачи ОДИН на оба блока: между приёмом и выдачей машина
  // не ездит, а раздельные поля расходились и печатались разными числами. Правка в
  // любом из них меняет оба и шапку ТС — чтобы «↩ Обновить карточку машины» унесла
  // исправленный пробег в карточку.
  function patchMileage(v) {
    touchedRef.current = true;
    setSnapshot((s) => ({
      ...s,
      condition: { ...s.condition, mileage_in: v, mileage_out: v },
      vehicle: { ...s.vehicle, mileage: v },
    }));
    setSaved(false);
    setSavedToCar(false);
  }

  // Opt-in: push the document's vehicle + client data AND услуги/запчасти back onto
  // the car card. Услуги/запчасти — «добавить и обновить, не удалять» по получателю;
  // совпадающие запчасти сохраняют закупку/приёмку. Общий путь с заказ-нарядом —
  // см. docToCar.
  async function saveToCar() {
    try {
      const res = await applyDocToCar({ job, snapshot, recipient, docId, setSnapshot });
      if (res !== 'ok') return;
      setSavedToCar(true);
      if (onJobUpdated) onJobUpdated();
    } catch {
      alert('Не удалось обновить карточку машины.');
    }
  }
  function patchBank(fields) { touchedRef.current = true; setSnapshot((s) => ({ ...s, company: { ...s.company, bank: { ...(s.company.bank || {}), ...fields } } })); setSaved(false); }

  function addService() { patch({ services: [...(snapshot.services || []), { id: uid(), name: '', qty: 1, price: 0 }] }); }
  function updateService(id, f) { patch({ services: snapshot.services.map((s) => (s.id === id ? { ...s, ...f } : s)) }); }
  function removeService(id) { patch({ services: snapshot.services.filter((s) => s.id !== id) }); }
  function addPart() { patch({ parts: [...(snapshot.parts || []), { id: uid(), code: '', name: '', qty: 1, unit: 'шт.', price: 0 }] }); }
  function updatePart(id, f) { patch({ parts: snapshot.parts.map((p) => (p.id === id ? { ...p, ...f } : p)) }); }
  function removePart(id) { patch({ parts: snapshot.parts.filter((p) => p.id !== id) }); }

  function openExisting(d) { touchedRef.current = true; const seed = seedFromExisting(d); setSnapshot(isHandover ? withSyncedMileage(seed) : seed); setDocId(d.id); setSaved(true); if (isHandover) setDirection(d.direction || 'issue'); }
  function newDoc() { touchedRef.current = true; setSnapshot(buildInitial(type, job, company, recipient, direction)); setDocId(null); setSaved(false); }

  // Смена направления акта: заголовок, подписи и стандартный текст берутся из направления.
  function changeDirection(dir) {
    setDirection(dir);
    patch({
      direction: dir,
      handover_text: dir === 'intake' ? DEFAULT_INTAKE_TEXT : DEFAULT_HANDOVER_TEXT,
      show_handover_text: true,
      show_intake: true,
      show_issue: dir === 'issue',
    });
  }

  // Возвращает АКТУАЛЬНЫЙ снапшот — с номером, который счётчик присвоил при создании.
  // Это нужно выгрузке в Excel: она берёт данные из переменной, а не из DOM, и на
  // свежесозданном документе видела бы ещё пустой номер (setSnapshot асинхронен).
  async function save() {
    setSaving(true);
    setSaveError('');
    let fresh = snapshot;
    try {
      const n = (v) => Number(v) || 0;
      const payload = { ...snapshot };
      if (hasItems) {
        const t = computeDocTotals(snapshot);
        payload.services = (snapshot.services || []).map((s) => ({ ...s, qty: n(s.qty), price: n(s.price) }));
        payload.parts = (snapshot.parts || []).map((p) => ({ ...p, qty: n(p.qty), price: n(p.price) }));
        // discount ПЕРСИСТИМ рублями (эффективную сумму) — costing/печать читают рублями;
        // режим/процент сохраняем отдельно для повторного открытия.
        payload.discount = t.discount;
        payload.discount_mode = snapshot.discount_mode === 'pct' ? 'pct' : 'rub';
        payload.discount_pct = n(snapshot.discount_pct);
        payload.prepayment = n(snapshot.prepayment);
        payload.totals = t;
      }
      if (isInvoice) {
        payload.paid = !!snapshot.paid;
        payload.paid_at = payload.paid ? (snapshot.paid_at || Date.now()) : null;
        // Как счёт участвует в деньгах (см. invoices.js). Пишем всегда — иначе у
        // счёта, которому сняли пометку, осталось бы старое значение.
        payload.billing_role = invoiceRole(snapshot);
      }
      fresh = payload;
      if (docId) await api.orderDocuments.update(docId, payload);
      else {
        const created = await api.orderDocuments.create(payload);
        setDocId(created.id);
        if (created.doc_number) fresh = { ...payload, doc_number: created.doc_number };
        // Показать присвоенный счётчиком номер в редакторе и на печатном листе.
        // flushSync — чтобы номер попал в DOM до печати, когда сохранение вызвано
        // кнопкой «Печать» для нового документа (см. printDoc).
        if (created.doc_number && created.doc_number !== snapshot.doc_number) {
          flushSync(() => setSnapshot((s) => ({ ...s, doc_number: created.doc_number })));
        }
      }
      setSaved(true);
      refresh();
    } catch {
      setSaveError('Не удалось сохранить. Похоже, ещё не обновлены правила доступа Firestore. Печать при этом работает.');
    } finally {
      setSaving(false);
    }
    return fresh;
  }

  // Печать: у нового документа номер присваивается при сохранении, поэтому сначала
  // сохраняем (save() сам показывает ошибку и не бросает исключение), затем печатаем —
  // так на лист никогда не попадёт пустой номер. Уже сохранённый просто печатаем.
  async function printDoc() {
    if (!docId) await save();
    printFitted();
  }

  // Excel-версия документа. Сохраняем по той же причине, что и перед печатью:
  // у нового документа номер присваивается при сохранении, а файл уезжает
  // бухгалтеру/страховой — с пустым номером он бесполезен. Не сохранилось
  // (например, не обновлены правила доступа) — файл всё равно отдаём.
  async function exportExcel() {
    const fresh = docId ? snapshot : await save();
    downloadDocExcel(fresh || snapshot);
  }

  const totals = hasItems ? computeDocTotals(snapshot) : null;
  const role = invoiceRole(snapshot);
  const cust = snapshot.customer;
  const veh = snapshot.vehicle;
  const c = snapshot.company;
  const bank = c.bank || {};
  const cond = snapshot.condition || {};

  return (
    <div className="order-editor-root">
      {history.length > 0 && (
        <div className="oe-history">
          <span className="oe-history-label">Ранее выданные:</span>
          {history.map((d) => {
            // У счетов подписываем, какой из них идёт в деньги. Пока счёт один,
            // объяснять нечего — метку не показываем.
            const st = isInvoice && history.length > 1 ? invoiceStatus(d, countedIds) : null;
            const off = st === 'replaced' || st === 'void';
            return (
              <button
                key={d.id}
                className={`${d.id === docId ? 'active' : ''}${off ? ' is-off' : ''}`}
                onClick={() => openExisting(d)}
                title={st ? INVOICE_STATUS_HINT[st] : ''}
              >
                {d.doc_number} · {formatDocDate(d.doc_date)}
                {st && <span className="oe-history-tag">{INVOICE_TAG[st]}</span>}
              </button>
            );
          })}
          <button className="oe-history-new" onClick={newDoc}>+ Новый</button>
        </div>
      )}
      <div className="order-editor">
        <div className="order-editor-left">
          <div className="oe-section">
            <h4>Документ</h4>
            <div className="oe-grid">
              <label className="oe-field">№ документа
                <input value={snapshot.doc_number} onChange={(e) => patch({ doc_number: e.target.value })} placeholder="присвоится при сохранении" />
              </label>
              <label className="oe-field">Дата
                <DateTimeField mode="date" value={snapshot.doc_date} onChange={(v) => patch({ doc_date: v })} />
              </label>
              {hasItems && (
                <label className="oe-field oe-full">Основание — заказ-наряд №
                  <input value={snapshot.order_ref || ''} onChange={(e) => patch({ order_ref: e.target.value })} placeholder="номер заказ-наряда" />
                </label>
              )}
            </div>
            {hasItems && snapshot.order_ref && <div className="oe-hint">Позиции подтянуты из заказ-наряда № {snapshot.order_ref}.</div>}
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
            </div>
          </div>

          {hasItems && (
            <>
              <div className="oe-section">
                <h4>Работы</h4>
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
                <div className="oe-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                  Правки здесь остаются в документе. Кнопка «↩ Обновить карточку машины» внизу переносит их в карточку:
                  позиция, пришедшая из карточки, обновится (в том числе переименуется), новая — добавится.
                </div>
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
                    effective={totals ? totals.discount : 0}
                    subtotal={totals ? totals.subtotal : 0}
                    onPatch={patch}
                  />
                  {(isAct || isInvoice) && (
                    <label className="oe-field">Предоплата, ₽
                      <input type="number" min="0" value={snapshot.prepayment} onChange={(e) => patch({ prepayment: e.target.value })} />
                    </label>
                  )}
                  {isInvoice && (
                    <label className="oe-field">НДС
                      <select value={snapshot.vat_mode} onChange={(e) => patch({ vat_mode: e.target.value })}>
                        <option value="none">Без НДС</option>
                        <option value="vat20">НДС 20%</option>
                      </select>
                    </label>
                  )}
                </div>
                {totals && <DocTotal totals={totals} insurer={isInvoice} />}
              </div>
            </>
          )}

          {isInvoice && (
            <>
              <div className="oe-section">
                <label className="oe-toggle">
                  <input type="checkbox" checked={snapshot.show_qr} onChange={(e) => patch({ show_qr: e.target.checked })} />
                  QR-код для оплаты
                </label>
                {snapshot.show_qr && !qrIsComplete(snapshot) && <div className="oe-hint">Заполните банковские реквизиты и ИНН — тогда QR будет рабочим.</div>}
              </div>

              <div className="oe-section">
                <label className="oe-toggle">
                  <input type="checkbox" checked={!!snapshot.paid} onChange={(e) => patch({ paid: e.target.checked })} />
                  Счёт оплачен
                </label>
                <div className="oe-hint">Оплаченные счета попадают в «Оплачено» на борде аналитики (вкладка «История»).</div>
              </div>

              <div className="oe-section">
                <h4>Учёт в деньгах</h4>
                <div className="doc-recipient" style={{ marginTop: 0 }}>
                  {ROLES.map((r) => (
                    <button key={r.id} className={role === r.id ? 'active' : ''} onClick={() => patch({ billing_role: r.id })}>{r.label}</button>
                  ))}
                </div>
                <div className="oe-hint">{ROLES.find((r) => r.id === role)?.hint}</div>
                {/* Прямой ответ на «а этот счёт вообще считается?» — по сохранённому
                    документу, а не по правилу вообще. */}
                {docId && role === ROLE_AUTO && (
                  <div className="oe-hint">
                    {countedIds.has(docId)
                      ? 'Сейчас этот счёт учитывается в деньгах по машине.'
                      : 'Сейчас этот счёт НЕ учитывается: по этому убытку есть более поздний счёт.'}
                  </div>
                )}
              </div>

              <div className="oe-group-label"><span>Дополнительно · реквизиты и тексты</span></div>

              <CollapsibleSection title="Банковские реквизиты (для этого счёта)" hint="По умолчанию из «Реквизиты компании». Правки здесь остаются только в этом счёте." defaultOpen={!(bank.bank_name || bank.account)}>
                <div className="oe-grid">
                  <label className="oe-field oe-full">Банк получателя
                    <input value={bank.bank_name || ''} onChange={(e) => patchBank({ bank_name: e.target.value })} />
                  </label>
                  <label className="oe-field">БИК
                    <input value={bank.bik || ''} onChange={(e) => patchBank({ bik: e.target.value })} />
                  </label>
                  <label className="oe-field">КПП
                    <input value={c.kpp || ''} onChange={(e) => patchGroup('company', { kpp: e.target.value })} />
                  </label>
                  <label className="oe-field oe-full">Расчётный счёт (р/с)
                    <input value={bank.account || ''} onChange={(e) => patchBank({ account: e.target.value })} />
                  </label>
                  <label className="oe-field oe-full">Корр. счёт (к/с)
                    <input value={bank.corr_account || ''} onChange={(e) => patchBank({ corr_account: e.target.value })} />
                  </label>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Примечание об оплате" toggle={{ checked: snapshot.show_invoice_note, onChange: (v) => patch({ show_invoice_note: v }) }}>
                <div className="oe-collapse-actions">
                  {/* Заодно включаем блок: иначе при снятой галочке клик «ничего не делает» */}
                  <button className="small" onClick={() => patch({ invoice_note: DEFAULT_INVOICE_NOTE, show_invoice_note: true })}>Вернуть стандартный текст</button>
                </div>
                <textarea className="oe-textarea" value={snapshot.invoice_note} disabled={!snapshot.show_invoice_note} onChange={(e) => patch({ invoice_note: e.target.value })} />
              </CollapsibleSection>
            </>
          )}

          {isAct && (
            <>
              <div className="oe-group-label"><span>Дополнительно · тексты и реквизиты</span></div>

              <CollapsibleSection title="Рекомендации" toggle={{ checked: snapshot.show_recommendations, onChange: (v) => patch({ show_recommendations: v }) }}>
                <textarea className="oe-textarea" value={snapshot.recommendations} disabled={!snapshot.show_recommendations} onChange={(e) => patch({ recommendations: e.target.value })} placeholder="Рекомендации мастера" />
              </CollapsibleSection>

              <CollapsibleSection title="Текст акта (выполнено, претензий нет)" toggle={{ checked: snapshot.show_act_text, onChange: (v) => patch({ show_act_text: v }) }}>
                <div className="oe-collapse-actions">
                  <button className="small" onClick={() => patch({ act_text: DEFAULT_ACT_TEXT, show_act_text: true })}>Вернуть стандартный текст</button>
                </div>
                <textarea className="oe-textarea" value={snapshot.act_text} disabled={!snapshot.show_act_text} onChange={(e) => patch({ act_text: e.target.value })} />
              </CollapsibleSection>

              <CollapsibleSection title="Гарантия" toggle={{ checked: snapshot.show_warranty, onChange: (v) => patch({ show_warranty: v }) }}>
                <div className="oe-collapse-actions">
                  <button className="small" onClick={() => patch({ warranty_text: DEFAULT_WARRANTY, show_warranty: true })}>Вернуть стандартный текст</button>
                </div>
                <textarea className="oe-textarea" value={snapshot.warranty_text} disabled={!snapshot.show_warranty} onChange={(e) => patch({ warranty_text: e.target.value })} />
              </CollapsibleSection>

              <CollapsibleSection title="Согласование по запчастям (Б/У и замены)" toggle={{ checked: snapshot.show_parts_consent, onChange: (v) => patch({ show_parts_consent: v }) }}>
                <div className="oe-collapse-actions">
                  <button className="small" onClick={() => patch({ parts_consent_text: buildPartsConsentText(snapshot.parts), show_parts_consent: true })}>Собрать из запчастей</button>
                </div>
                <textarea className="oe-textarea" value={snapshot.parts_consent_text || ''} disabled={!snapshot.show_parts_consent} onChange={(e) => patch({ parts_consent_text: e.target.value })} placeholder="Отметки о Б/У и заменах на аналог — по одной в строке" />
              </CollapsibleSection>
            </>
          )}

          {isHandover && (
            <>
              <div className="oe-section">
                <h4>Тип акта</h4>
                <div className="doc-recipient" style={{ marginTop: 0 }}>
                  <button className={direction === 'intake' ? 'active' : ''} onClick={() => changeDirection('intake')}>Приём в сервис</button>
                  <button className={direction === 'issue' ? 'active' : ''} onClick={() => changeDirection('issue')}>Выдача клиенту</button>
                  <span className="doc-recipient-hint">
                    {direction === 'intake'
                      ? 'Приём: ТС сдаёт клиент, принимает сервис. Фиксируем пробег и состояние на входе.'
                      : 'Выдача: ТС сдаёт сервис, принимает клиент. Фиксируем состояние на выходе.'}
                  </span>
                </div>
              </div>
              <div className="oe-section">
                <label className="oe-toggle">
                  <input type="checkbox" checked={snapshot.show_intake} onChange={(e) => patch({ show_intake: e.target.checked })} />
                  При приёме ТС
                </label>
                <div className="oe-grid" style={{ opacity: snapshot.show_intake ? 1 : 0.45 }}>
                  <label className="oe-field oe-full">Пробег при приёме, км
                    <input value={cond.mileage_in} disabled={!snapshot.show_intake} onChange={(e) => patchMileage(e.target.value)} />
                  </label>
                  <label className="oe-field oe-full">Комплектация
                    <input value={cond.equipment} disabled={!snapshot.show_intake} onChange={(e) => patchGroup('condition', { equipment: e.target.value })} />
                  </label>
                </div>
                <textarea className="oe-textarea" value={cond.condition_in} disabled={!snapshot.show_intake} onChange={(e) => patchGroup('condition', { condition_in: e.target.value })} placeholder="Видимые повреждения / состояние при приёме" />
              </div>
              <div className="oe-section">
                <label className="oe-toggle">
                  <input type="checkbox" checked={snapshot.show_issue} onChange={(e) => patch({ show_issue: e.target.checked })} />
                  При выдаче ТС
                </label>
                <label className="oe-field oe-full" style={{ opacity: snapshot.show_issue ? 1 : 0.45 }}>Пробег при выдаче, км
                  <input value={cond.mileage_out} disabled={!snapshot.show_issue} onChange={(e) => patchMileage(e.target.value)} />
                </label>
                <div className="oe-hint">Всегда совпадает с пробегом при приёме — правьте в любом из двух полей.</div>
                <textarea className="oe-textarea" value={cond.condition_out} disabled={!snapshot.show_issue} onChange={(e) => patchGroup('condition', { condition_out: e.target.value })} placeholder="Состояние при выдаче" />
              </div>
              <div className="oe-section">
                <div className="oe-toggle-row">
                  <label className="oe-toggle">
                    <input type="checkbox" checked={snapshot.show_handover_text} onChange={(e) => patch({ show_handover_text: e.target.checked })} />
                    Текст приёма-передачи
                  </label>
                  <button className="small" onClick={() => patch({ handover_text: direction === 'intake' ? DEFAULT_INTAKE_TEXT : DEFAULT_HANDOVER_TEXT, show_handover_text: true })}>Вернуть стандартный текст</button>
                </div>
                <textarea className="oe-textarea" value={snapshot.handover_text} disabled={!snapshot.show_handover_text} onChange={(e) => patch({ handover_text: e.target.value })} />
              </div>
              <div className="oe-group-label"><span>Дополнительно · реквизиты</span></div>
            </>
          )}

          <CollapsibleSection title="Реквизиты компании (для этого документа)" hint="По умолчанию из «Посты и мастера → Реквизиты». Правки здесь остаются только в этом документе.">
            <div className="oe-grid">
              <label className="oe-field oe-full">Наименование
                <input value={c.name} onChange={(e) => patchGroup('company', { name: e.target.value })} />
              </label>
              <label className="oe-field">ИНН
                <input value={c.inn} onChange={(e) => patchGroup('company', { inn: e.target.value })} />
              </label>
              <label className="oe-field">Руководитель (подпись)
                <input value={c.director} onChange={(e) => patchGroup('company', { director: e.target.value })} />
              </label>
            </div>
          </CollapsibleSection>
        </div>

        <DocPreviewPane show={showPreview}>
          <DocSheet snapshot={snapshot} qrDataUrl={qrDataUrl} />
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
          <button onClick={exportExcel} title="Скачать этот документ таблицей Excel (.xlsx) — позиции и суммы числами, можно править и считать">⤓ Excel</button>
          <button className="primary" onClick={printDoc}>🖨 Печать</button>
        </div>
      </div>

      {createPortal(<div id="zn-print-mount"><DocSheet snapshot={snapshot} qrDataUrl={qrDataUrl} /></div>, document.body)}
    </div>
  );
}
