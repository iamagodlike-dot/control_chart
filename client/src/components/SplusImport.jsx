import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { mapSplusOrders } from '../splusImport';
import Icon from './Icon';

// Окно переноса заказов из выгрузки «Заказ-наряды» Splus (CSV) в нашу базу.
// Безопасно по построению: показывает предпросмотр, пропускает уже existing
// заказы (по номеру), умеет залить сначала «первые 3» для проверки, и помечает
// каждую запись imported_from:'splus' — чтобы партию можно было найти и откатить.
export default function SplusImport({ onClose, onImported }) {
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);   // { orders, warnings }
  const [existing, setExisting] = useState(null); // Set номеров, уже имеющихся в базе
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [result, setResult] = useState(null);     // { added, skipped, failed }
  const [error, setError] = useState('');

  // Текущие номера заказов в базе — чтобы не создать дубли (в т.ч. при повторном запуске).
  const loadExisting = async () => {
    const jobs = await api.jobs.listAllBrief();
    setExisting(new Set(jobs.map((j) => String(j.order_number ?? '').trim()).filter(Boolean)));
  };
  useEffect(() => { loadExisting().catch((e) => setError(e.message || String(e))); }, []);

  async function onPickFile(e) {
    setError(''); setResult(null); setProgress(null); setParsed(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const res = mapSplusOrders(text);
      setParsed(res);
    } catch (err) {
      setError('Не удалось прочитать файл: ' + (err.message || String(err)));
    }
  }

  // Новые (ещё не заведённые) заказы — их и импортируем.
  const fresh = useMemo(() => {
    if (!parsed || !existing) return [];
    return parsed.orders.filter((o) => !existing.has(String(o.job.order_number).trim()));
  }, [parsed, existing]);

  const dupCount = parsed && existing ? parsed.orders.length - fresh.length : 0;
  const insurerCount = fresh.filter((o) => o._insurer).length;
  const noPlateCount = fresh.filter((o) => !o.job.plate_number).length;

  async function runImport(list) {
    if (!list.length || busy) return;
    setBusy(true); setError(''); setResult(null);
    setProgress({ done: 0, total: list.length });
    let added = 0, failed = 0;
    const done = new Set();
    for (let i = 0; i < list.length; i++) {
      try {
        await api.jobs.importOne(list[i].job);
        added++;
        done.add(String(list[i].job.order_number).trim());
      } catch (err) {
        failed++;
        console.error('Импорт заказа', list[i].job.order_number, 'не удался:', err);
      }
      setProgress({ done: i + 1, total: list.length });
    }
    // Помечаем заведённые как existing — счётчики обновятся, повторный клик не задублит.
    setExisting((prev) => new Set([...(prev || []), ...done]));
    setResult({ added, skipped: dupCount, failed });
    setBusy(false);
    onImported?.();
  }

  const ready = fresh.length > 0 && !busy;
  const shortNote = (s) => (s ? s.replace(/\n/g, ' · ').slice(0, 60) + (s.length > 60 ? '…' : '') : '—');

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <h3 className="cc-title" style={{ margin: 0 }}>Импорт заказов из Splus</h3>
          <button className="cc-close" onClick={onClose} aria-label="Закрыть" disabled={busy}><Icon name="x" size={18} strokeWidth={2} /></button>
        </div>

        <p style={{ marginTop: 0, color: 'var(--text2, #667)' }}>
          Выгрузите в Splus раздел «Заказ-наряды» в CSV и выберите файл ниже. Заказы <b>добавятся</b> к существующим;
          ничего не перезаписывается. Заказы с уже имеющимся номером пропускаются.
        </p>

        <div style={{ margin: '14px 0' }}>
          <input type="file" accept=".csv,text/csv" onChange={onPickFile} disabled={busy} />
          {fileName && <span style={{ marginLeft: 8, color: 'var(--text3, #889)' }}>{fileName}</span>}
        </div>

        {error && <div className="alert-strip" style={{ color: '#c0392b', margin: '8px 0' }}>⚠ {error}</div>}

        {parsed && existing && (
          <>
            {parsed.warnings.length > 0 && (
              <div style={{ color: '#b9770e', margin: '8px 0', fontSize: 13 }}>
                {parsed.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: '12px 0', fontSize: 14 }}>
              <span>В файле: <b>{parsed.orders.length}</b></span>
              <span>Новых к загрузке: <b style={{ color: 'var(--accent, #2d7)' }}>{fresh.length}</b></span>
              <span>Уже есть (пропустим): <b>{dupCount}</b></span>
              <span>Из них страховых: <b>{insurerCount}</b></span>
              <span>Без госномера: <b>{noPlateCount}</b></span>
            </div>

            {fresh.length > 0 && (
              <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border, #e3e3ea)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', position: 'sticky', top: 0, background: 'var(--panel, #fff)' }}>
                      <th style={cellS}>№</th><th style={cellS}>Дата</th><th style={cellS}>Модель</th>
                      <th style={cellS}>Госномер</th><th style={cellS}>Клиент</th><th style={cellS}>Заметка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fresh.slice(0, 12).map((o) => (
                      <tr key={o.job.order_number} style={{ borderTop: '1px solid var(--border, #eee)' }}>
                        <td style={cellS}>{o.job.order_number}</td>
                        <td style={cellS}>{o._date}</td>
                        <td style={cellS}>{o.job.car_model || '—'}</td>
                        <td style={cellS}>{o.job.plate_number || '—'}</td>
                        <td style={cellS}>{o.job.client_name || '—'}{o._insurer ? ' 🛡' : ''}</td>
                        <td style={{ ...cellS, color: 'var(--text3, #889)' }}>{shortNote(o.job.notes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {fresh.length > 12 && <div style={{ padding: '6px 10px', color: 'var(--text3, #889)', fontSize: 12 }}>…и ещё {fresh.length - 12}</div>}
              </div>
            )}
          </>
        )}

        {progress && (
          <div style={{ margin: '14px 0' }}>
            <div style={{ fontSize: 14, marginBottom: 6 }}>Загружаем… {progress.done} из {progress.total}</div>
            <div style={{ height: 8, background: 'var(--border, #eee)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(progress.done / progress.total * 100)}%`, background: 'var(--accent, #2d7)', transition: 'width .2s' }} />
            </div>
          </div>
        )}

        {result && (
          <div className="alert-strip" style={{ margin: '14px 0', color: '#1e7d34' }}>
            ✓ Готово. Добавлено: <b>{result.added}</b>. Пропущено дублей: <b>{result.skipped}</b>.
            {result.failed > 0 && <span style={{ color: '#c0392b' }}> Не удалось: {result.failed} (см. консоль).</span>}
            {' '}Проверьте заказы в программе.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          <button onClick={onClose} disabled={busy}>Закрыть</button>
          <button onClick={() => runImport(fresh.slice(0, 3))} disabled={!ready} title="Залить первые 3 заказа для проверки">
            Проверка: первые 3
          </button>
          <button className="primary" onClick={() => runImport(fresh)} disabled={!ready}>
            {busy ? 'Импортируем…' : `Импортировать все (${fresh.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

const cellS = { padding: '6px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 };
