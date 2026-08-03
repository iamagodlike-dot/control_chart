import { useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { uploadInvoiceFile } from '../photos';
import { buildInvoiceItems, itemsAmount, money } from '../supplierInvoices';
import Icon from './Icon';
import { useModalEscape } from '../modalEscape';

// Модалка «Выставить счёт» для запчастиста. Показывает все позиции в статусе
// «Требуется» (кандидаты, можно с разных машин), даёт выбрать их галочками, ввести
// поставщика, приложить файл счёта и авто-сумму (правится вручную). По «Выставить
// счёт» создаётся счёт поставщика (api.supplierInvoices.create), а выбранные позиции
// уходят в «Выставлен счёт». Экран запчастей не трогаем — вся логика здесь.
export default function SupplierInvoiceModal({ jobs = [], supplierNames = [], profileName = '', onClose, onCreated }) {
  const carsById = useMemo(
    () => Object.fromEntries(jobs.map((j) => [j.id, { model: j.car_model, plate: j.plate_number }])),
    [jobs],
  );
  // «Требуется» = явный статус 'need' ИЛИ вообще без статуса. Позиции без статуса
  // (импорт Audatex / ручной ввод при создании машины) на экране «Запчасти»
  // показываются как «Требуется» (normalizePart подставляет 'need'), поэтому и в
  // счёт их берём так же — иначе большинство позиций «пропадало» из модалки.
  const candidates = useMemo(
    () => jobs.flatMap((j) => (j.parts || [])
      .filter((p) => p && p.id && (p.status || 'need') === 'need')
      .map((p) => ({ ...p, carId: j.id, car_model: j.car_model, plate: j.plate_number }))),
    [jobs],
  );
  const byCar = useMemo(() => {
    const m = new Map();
    for (const c of candidates) { if (!m.has(c.carId)) m.set(c.carId, []); m.get(c.carId).push(c); }
    return [...m.entries()];
  }, [candidates]);

  const [selected, setSelected] = useState(() => new Set());
  const [supplier, setSupplier] = useState('');
  const [amountOverride, setAmountOverride] = useState(''); // ручная правка суммы
  const [amountTouched, setAmountTouched] = useState(false);
  const [file, setFile] = useState(null); // { url, name, size }
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const items = useMemo(() => buildInvoiceItems(candidates, selected, carsById), [candidates, selected, carsById]);
  const autoAmount = itemsAmount(items);
  // Сумма — производная: пока не правили руками, показываем авто-сумму выбранных
  // позиций (без useEffect, чтобы не плодить каскадные ре-рендеры).
  const amount = amountTouched ? amountOverride : (autoAmount ? String(autoAmount) : '');
  const effectiveAmount = amountTouched ? (Number(amountOverride) || autoAmount) : autoAmount;

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleCar = (carId, on) => setSelected((s) => {
    const n = new Set(s);
    candidates.filter((c) => c.carId === carId).forEach((c) => (on ? n.add(c.id) : n.delete(c.id)));
    return n;
  });

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true); setError('');
    try { setFile(await uploadInvoiceFile(f)); }
    catch (err) { setError('Не удалось загрузить файл: ' + (err?.message || 'ошибка')); }
    finally { setUploading(false); }
  };

  const submit = async () => {
    if (submitting) return;
    if (selected.size === 0) { setError('Выберите хотя бы одну позицию'); return; }
    if (!supplier.trim()) { setError('Укажите поставщика'); return; }
    if (!file?.url) { setError('Приложите файл счёта'); return; }
    setSubmitting(true); setError('');
    try {
      await api.supplierInvoices.create({
        supplier: supplier.trim(),
        amount: effectiveAmount,
        items,
        file_url: file.url, file_name: file.name, file_size: file.size,
        created_by_name: profileName || null,
      });
      onCreated?.();
      onClose?.();
    } catch (err) {
      setError('Не удалось создать счёт: ' + (err?.message || 'ошибка'));
      setSubmitting(false);
    }
  };

  const noCost = items.filter((it) => !(Number(it.cost) > 0)).length;

  // Клик мимо окна не закрывает: нативные списки на телефоне отдают странице
  // сквозной клик, и наполовину заполненная форма пропадала (см. modalEscape).
  const backdropRef = useModalEscape(onClose);

  return (
    <div className="si-modal-overlay" ref={backdropRef}>
      <div className="si-modal">
        <div className="si-modal-head">
          <h3>Выставить счёт поставщика</h3>
          <button className="si-modal-x" onClick={onClose} title="Закрыть"><Icon name="x" size={18} /></button>
        </div>

        <input ref={fileRef} type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }} onChange={onFile} />
        <datalist id="si-modal-suppliers">{supplierNames.map((n) => <option key={n} value={n} />)}</datalist>

        <div className="si-modal-body">
          {candidates.length === 0 ? (
            <div className="req-empty"><Icon name="receipt" size={26} /><p>Нет позиций «Требуется» — выставлять счёт не из чего.</p></div>
          ) : (
            <>
              <div className="si-modal-hint">Отметьте позиции этого счёта (можно с разных машин):</div>
              <div className="si-modal-list">
                {byCar.map(([carId, parts]) => {
                  const allOn = parts.every((p) => selected.has(p.id));
                  const c = carsById[carId] || {};
                  return (
                    <div key={carId} className="si-modal-car">
                      <label className="si-modal-carhead">
                        <input type="checkbox" checked={allOn} onChange={(e) => toggleCar(carId, e.target.checked)} />
                        <span>{[c.model, c.plate].filter(Boolean).join(' · ') || 'Машина'}</span>
                      </label>
                      {parts.map((p) => (
                        <label key={p.id} className="si-modal-part">
                          <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                          <span className="si-modal-pname">{p.name || 'Запчасть'}{p.code ? ` · ${p.code}` : ''}</span>
                          <span className="si-modal-pqty">{p.qty || 1} шт</span>
                          <span className={`si-modal-pcost${Number(p.cost) > 0 ? '' : ' is-warn'}`}>
                            {Number(p.cost) > 0 ? money(Number(p.cost) * (Number(p.qty) || 1)) : 'нет цены'}
                          </span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>

              <div className="si-modal-fields">
                <label className="si-modal-field">
                  <span>Поставщик</span>
                  <input list="si-modal-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Exist, Emex…" />
                </label>
                <label className="si-modal-field si-modal-field--sum">
                  <span>Сумма счёта, ₽</span>
                  <input
                    type="number" inputMode="numeric" min="0" value={amount}
                    onChange={(e) => { setAmountOverride(e.target.value); setAmountTouched(true); }}
                    placeholder="0"
                  />
                  {amountTouched && autoAmount > 0 && Number(amount) !== autoAmount && (
                    <button type="button" className="si-modal-reset" onClick={() => setAmountTouched(false)}>
                      по позициям: {money(autoAmount)}
                    </button>
                  )}
                </label>
              </div>

              <div className="si-modal-file">
                <button type="button" className="si-modal-filebtn" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  <Icon name="receipt" size={15} />{uploading ? 'Загрузка…' : (file ? 'Заменить файл' : 'Приложить файл счёта')}
                </button>
                {file ? <span className="si-modal-filename"><Icon name="check" size={14} />{file.name}</span> : <span className="si-modal-filereq">обязательно</span>}
              </div>

              {noCost > 0 && selected.size > 0 && (
                <div className="si-modal-warn"><Icon name="warning" size={14} />{noCost} поз. без закупочной цены — сумма может быть занижена. Проставьте цену на экране «Запчасти».</div>
              )}
            </>
          )}

          {error ? <div className="auth-error" style={{ marginTop: 12 }}>{error}</div> : null}
        </div>

        <div className="si-modal-foot">
          <button className="si-modal-cancel" onClick={onClose}>Отмена</button>
          <button className="si-modal-submit" disabled={submitting || candidates.length === 0} onClick={submit}>
            <Icon name="check" size={16} />
            {submitting ? 'Создаём…' : `Выставить счёт${selected.size ? ` · ${money(effectiveAmount)}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
