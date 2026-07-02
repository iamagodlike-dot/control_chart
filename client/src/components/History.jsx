import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { money, computeDocTotals } from '../orderDoc';
import { isInsurance } from '../insurance';
import DocumentsModal from './DocumentsModal';
import { DocsButton } from './RowActionButtons';
import '../history.css';

const SORTS = [
  { id: 'date_desc', label: 'Сначала новые' },
  { id: 'date_asc', label: 'Сначала старые' },
  { id: 'amount_desc', label: 'Сумма ↓' },
  { id: 'amount_asc', label: 'Сумма ↑' },
  { id: 'client', label: 'Клиент А-Я' },
  { id: 'car', label: 'Марка А-Я' },
];

function invoiceAmount(inv) {
  const t = inv.totals && typeof inv.totals.total === 'number' ? inv.totals.total : computeDocTotals(inv).total;
  return Number(t) || 0;
}

// Closed-orders archive: view/print documents, mark paid, return to work.
// Money analysis lives in the separate «Финансы» tab.
export default function History() {
  const [jobs, setJobs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date_desc');
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [company, setCompany] = useState({});
  const [docsJob, setDocsJob] = useState(null);

  const load = async () => {
    setLoading(true);
    const [j, d] = await Promise.all([
      api.history(),
      api.orderDocuments.listAll().catch(() => []),
    ]);
    setJobs(j);
    setDocs(d);
    setLoading(false);
  };
  const loadDocs = async () => setDocs(await api.orderDocuments.listAll().catch(() => []));

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
    api.settings.getCompany().then(setCompany);
  }, []);

  const invoices = useMemo(() => docs.filter((d) => d.type === 'invoice'), [docs]);
  const invByJob = useMemo(() => {
    const m = {};
    for (const inv of invoices) (m[inv.job_id] ||= []).push(inv);
    return m;
  }, [invoices]);

  const jobAmount = (id) => (invByJob[id] || []).reduce((s, i) => s + invoiceAmount(i), 0);
  const jobPaid = (id) => { const a = invByJob[id] || []; return a.length > 0 && a.every((i) => i.paid); };

  async function toggleJobPaid(id) {
    const arr = invByJob[id] || [];
    if (!arr.length) return;
    const makePaid = !jobPaid(id);
    try {
      await Promise.all(arr.map((i) => api.orderDocuments.setPaid(i.id, makePaid)));
    } catch { /* сеть/правила — просто перечитаем актуальное состояние ниже */ }
    loadDocs();
  }

  async function openDocs(jobId) { setDocsJob(await api.jobs.get(jobId)); }
  async function restore(id) { await api.jobs.unarchive(id); load(); }

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = q
      ? jobs.filter((j) => [j.car_model, j.plate_number, j.client_name, j.order_number].some((v) => (v || '').toLowerCase().includes(q)))
      : [...jobs];
    if (onlyUnpaid) list = list.filter((j) => (invByJob[j.id] || []).some((i) => !i.paid));
    const byStr = (a, b) => a.localeCompare(b, 'ru');
    list.sort((a, b) => {
      switch (sort) {
        case 'date_asc': return (a.archived_at || 0) - (b.archived_at || 0);
        case 'amount_desc': return jobAmount(b.id) - jobAmount(a.id);
        case 'amount_asc': return jobAmount(a.id) - jobAmount(b.id);
        case 'client': return byStr(a.client_name || '', b.client_name || '');
        case 'car': return byStr(a.car_model || '', b.car_model || '');
        default: return (b.archived_at || 0) - (a.archived_at || 0);
      }
    });
    return list;
  }, [jobs, q, sort, onlyUnpaid, invByJob]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="gantt-loading"><div className="spinner" /><span>Загружаем историю…</span></div>;
  }

  return (
    <div className="panel history-panel">
      <div className="hist-list-head">
        <h3>Закрытые заказы</h3>
        <div className="hist-controls">
          <button
            type="button"
            className={`hist-filter${onlyUnpaid ? ' is-active' : ''}`}
            onClick={() => setOnlyUnpaid((v) => !v)}
          >
            {onlyUnpaid ? '✓ Только неоплаченные' : 'Только неоплаченные'}
          </button>
          <div className="hist-sort">
            <span>Сортировка</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <input
        className="job-search"
        placeholder="Поиск по машине, номеру, клиенту…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filtered.length === 0 && <div className="job-empty">{q ? 'Ничего не найдено' : 'Пока нет завершённых заказов'}</div>}
      <div className="history-list">
        {filtered.map((j) => {
          const amount = jobAmount(j.id);
          const hasInvoice = (invByJob[j.id] || []).length > 0;
          const paid = jobPaid(j.id);
          return (
            <div className="history-item" key={j.id}>
              <div className="history-item-head" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="job-item-title" style={{ flex: '1 1 auto', minWidth: 0 }}>{j.car_model}{j.order_number ? <span className="job-item-order"> №{j.order_number}</span> : ''}</div>
                {hasInvoice && <span className="hist-amount">{money(amount)}</span>}
                <div className="history-item-actions" style={{ flexBasis: '100%', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 4 }}>
                  {hasInvoice && (
                    <button className={`hist-paid-toggle ${paid ? 'is-paid' : 'is-unpaid'}`} onClick={() => toggleJobPaid(j.id)} title={paid ? 'Отметить как неоплаченный' : 'Отметить оплату'}>
                      {paid ? '✓ Оплачено' : '● Не оплачено'}
                    </button>
                  )}
                  <DocsButton onClick={() => openDocs(j.id)} />
                  <button className="history-item-restore" onClick={() => restore(j.id)}>↺ Вернуть в работу</button>
                </div>
              </div>
              <div className="job-item-sub">{j.plate_number || '—'} {j.client_name ? `· ${j.client_name}` : ''}</div>
              {isInsurance(j) && j.insurer_name && <div className="job-item-insurer">🛡 {j.insurer_name}{j.claim_number ? ` · убыток ${j.claim_number}` : ''}</div>}
              {j.archived_at && <div className="history-item-date">Завершён {dayjs(j.archived_at).format('DD.MM.YYYY HH:mm')}</div>}
              <div className="history-item-stages">
                {j.stages.map((s) => (
                  <span key={s.id} className="history-stage-chip">{s.post_name || 'Пост'}: {s.status}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {docsJob && (
        <DocumentsModal
          job={docsJob}
          company={company}
          onClose={() => { setDocsJob(null); loadDocs(); }}
        />
      )}
    </div>
  );
}
