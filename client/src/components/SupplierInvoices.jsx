import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { uploadInvoiceFile, deletePhotoFile } from '../photos';
import {
  money, itemsAmount, invoicesByPaid, countInvoices, invoiceCarsSummary,
} from '../supplierInvoices';
import Icon from './Icon';

// ЛК учредителя (и управленца) для счетов поставщиков. Учредитель видит счета «к
// оплате», скачивает файл и жмёт «Оплачено» → позиции уходят в «Заказано» и
// оплата попадает в кассовую ленту (без задвоения прибыли, см. finance.js).
// Управленец видит то же + может заменить файл. Запчастист сюда не ходит — он
// выставляет счета на экране «Запчасти».
export default function SupplierInvoices({ role = 'founder', profile = {} }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('unpaid'); // 'unpaid' | 'paid'
  const [busy, setBusy] = useState(null);          // id счёта в процессе оплаты
  const [uploading, setUploading] = useState(null); // id счёта, которому меняем файл
  const [error, setError] = useState('');
  const replaceRef = useRef(null);   // { invId } — какой счёт получит новый файл
  const fileInputEl = useRef(null);  // скрытый <input type=file>

  const canPay = role === 'founder' || role === 'owner';
  const canReplace = role === 'owner' || role === 'partsman';

  useEffect(() => {
    const unsub = api.supplierInvoices.subscribe(
      (rows) => { setList(rows); setLoading(false); },
      () => { setError('Не удалось загрузить счета'); setLoading(false); },
    );
    return unsub;
  }, []);

  const counts = useMemo(() => countInvoices(list), [list]);
  const shown = useMemo(() => invoicesByPaid(list, filter === 'paid'), [list, filter]);

  const onPay = async (inv) => {
    if (!canPay || busy) return;
    if (!window.confirm(`Отметить счёт ${inv.number || ''} на ${money(inv.amount)} как оплаченный? Позиции уйдут в «Заказано».`)) return;
    setBusy(inv.id); setError('');
    try {
      await api.supplierInvoices.markPaid(inv.id, { paid_by_name: profile?.name || null });
    } catch (e) {
      setError('Не удалось отметить оплату: ' + (e?.message || 'ошибка'));
    } finally {
      setBusy(null);
    }
  };

  const pickReplace = (invId) => {
    if (!canReplace) return;
    replaceRef.current = { invId };
    fileInputEl.current?.click();
  };
  const onFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // позволить выбрать тот же файл повторно
    const ctx = replaceRef.current;
    if (!file || !ctx) return;
    const inv = list.find((i) => i.id === ctx.invId);
    if (!inv) return;
    setUploading(ctx.invId); setError('');
    try {
      const up = await uploadInvoiceFile(file);
      const oldPath = inv.file_url;
      await api.supplierInvoices.setFile(inv.id, { file_url: up.url, file_name: up.name, file_size: up.size });
      if (oldPath && oldPath !== up.url) deletePhotoFile(oldPath).catch(() => {});
    } catch (err) {
      setError('Не удалось загрузить файл: ' + (err?.message || 'ошибка'));
    } finally {
      setUploading(null);
      replaceRef.current = null;
    }
  };

  return (
    <div className="req">
      <input ref={fileInputEl} type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }} onChange={onFileChosen} />

      <div className="req-head">
        <div className="req-title">
          <h2>Счета поставщиков</h2>
          <p>
            {canPay
              ? 'Счета за запчасти к оплате. Скачайте счёт, оплатите и отметьте «Оплачено» — позиции уйдут в «Заказано».'
              : 'Счета за запчасти: к оплате и оплаченные.'}
          </p>
        </div>
        <div className="si-summary">
          <div className="si-sum-num">{counts.unpaid}</div>
          <div className="si-sum-lbl">к оплате{counts.unpaidAmount > 0 ? ` · ${money(counts.unpaidAmount)}` : ''}</div>
        </div>
      </div>

      <div className="si-tabs">
        <button className={filter === 'unpaid' ? 'active' : ''} onClick={() => setFilter('unpaid')}>
          К оплате{counts.unpaid ? ` · ${counts.unpaid}` : ''}
        </button>
        <button className={filter === 'paid' ? 'active' : ''} onClick={() => setFilter('paid')}>
          Оплаченные{counts.paid ? ` · ${counts.paid}` : ''}
        </button>
      </div>

      {error ? <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div> : null}

      {loading ? (
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      ) : shown.length === 0 ? (
        <div className="req-empty">
          <Icon name="receipt" size={26} />
          <p>{filter === 'unpaid' ? 'Нет неоплаченных счетов.' : 'Оплаченных счетов пока нет.'}</p>
        </div>
      ) : (
        <ul className="req-list">
          {shown.map((inv) => {
            const paid = filter === 'paid';
            const sum = Number(inv.amount) || itemsAmount(inv.items);
            return (
              <li key={inv.id} className={`req-item si-item${paid ? ' is-done' : ''}`}>
                <div className="req-main">
                  <div className="req-name">
                    {inv.supplier || 'Поставщик'} <span className="req-num">{inv.number || '—'}</span>
                  </div>
                  <div className="req-meta">
                    {invoiceCarsSummary(inv) ? <span>{invoiceCarsSummary(inv)}</span> : <span>{(inv.items || []).length} поз.</span>}
                    {inv.created_by_name || inv.created_by ? <span>· выставил {inv.created_by_name || inv.created_by}</span> : null}
                    {paid && inv.paid_by_name ? <span>· оплатил {inv.paid_by_name}</span> : null}
                    {inv.comment ? <span>· {inv.comment}</span> : null}
                  </div>
                  {(inv.items || []).length > 0 && (
                    <details className="si-items">
                      <summary>Позиции · {(inv.items || []).length}</summary>
                      <ul>
                        {(inv.items || []).map((it, i) => (
                          <li key={it.part_id || i}>
                            {it.name || 'Запчасть'}{it.code ? ` · ${it.code}` : ''} — {it.qty || 1} шт × {money(it.cost)}
                            {it.car_model || it.plate ? <span className="si-item-car"> · {[it.car_model, it.plate].filter(Boolean).join(' ')}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="si-file">
                    {inv.file_url ? (
                      <a className="si-file-link" href={inv.file_url} target="_blank" rel="noreferrer" download={inv.file_name || undefined}>
                        <Icon name="receipt" size={15} />{inv.file_name || 'Скачать счёт'}
                      </a>
                    ) : (
                      <span className="si-file-none"><Icon name="warning" size={14} />файл не приложен</span>
                    )}
                    {canReplace && (
                      <button className="si-replace" disabled={uploading === inv.id} onClick={() => pickReplace(inv.id)}>
                        {uploading === inv.id ? 'Загрузка…' : (inv.file_url ? 'Заменить' : 'Приложить')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="si-right">
                  <span className="si-amount">{money(sum)}</span>
                  {paid ? (
                    <span className="req-badge req-badge--done">оплачен</span>
                  ) : canPay ? (
                    <button className="si-pay" disabled={busy === inv.id} onClick={() => onPay(inv)}>
                      <Icon name="check" size={16} />{busy === inv.id ? 'Отмечаем…' : 'Оплачено'}
                    </button>
                  ) : (
                    <span className="req-badge">не оплачен</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
