import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { money, computeDocTotals } from '../orderDoc';
import DocumentsModal from './DocumentsModal';
import '../history.css';

const SORTS = [
  { id: 'date_desc', label: 'Сначала новые' },
  { id: 'date_asc', label: 'Сначала старые' },
  { id: 'amount_desc', label: 'Сумма ↓' },
  { id: 'amount_asc', label: 'Сумма ↑' },
  { id: 'client', label: 'Клиент А-Я' },
  { id: 'car', label: 'Марка А-Я' },
];

const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function invoiceAmount(inv) {
  const t = inv.totals && typeof inv.totals.total === 'number' ? inv.totals.total : computeDocTotals(inv).total;
  return Number(t) || 0;
}

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

  const stats = useMemo(() => {
    const amt = (i) => invoiceAmount(i);
    const billed = invoices.reduce((s, i) => s + amt(i), 0);
    const paidList = invoices.filter((i) => i.paid);
    const paid = paidList.reduce((s, i) => s + amt(i), 0);
    const count = invoices.length;
    const avg = count ? Math.round(billed / count) : 0;
    const nowMonth = dayjs().format('YYYY-MM');
    const paidThisMonth = paidList
      .filter((i) => dayjs(i.paid_at || i.created_at).format('YYYY-MM') === nowMonth)
      .reduce((s, i) => s + amt(i), 0);

    const months = [];
    for (let k = 11; k >= 0; k--) months.push(dayjs().subtract(k, 'month'));
    const byMonth = months.map((m) => ({
      key: m.format('YYYY-MM'),
      label: MONTHS_RU[m.month()],
      isYearStart: m.month() === 0,
      value: paidList
        .filter((i) => dayjs(i.paid_at || i.created_at).format('YYYY-MM') === m.format('YYYY-MM'))
        .reduce((s, i) => s + amt(i), 0),
    }));
    const max = Math.max(1, ...byMonth.map((b) => b.value));
    const unpaid = Math.max(0, billed - paid);
    const unpaidCount = count - paidList.length;
    return { billed, paid, unpaid, unpaidCount, count, avg, paidThisMonth, byMonth, max };
  }, [invoices]);

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
      <h3>Аналитика по счетам</h3>
      <div className="hist-cards">
        <div className="hist-card hist-card-success">
          <div className="hist-card-label">Оплачено</div>
          <div className="hist-card-value">{money(stats.paid)}</div>
        </div>
        <button
          type="button"
          className={`hist-card hist-card-danger${onlyUnpaid ? ' is-active' : ''}`}
          onClick={() => setOnlyUnpaid((v) => !v)}
          title="Показать в списке только неоплаченные"
        >
          <div className="hist-card-label">Не оплачено · долг</div>
          <div className="hist-card-value">{money(stats.unpaid)}</div>
          <div className="hist-card-sub">{stats.unpaidCount} неоплаченных · {onlyUnpaid ? 'показаны в списке' : 'нажмите, чтобы показать'}</div>
        </button>
        <div className="hist-card">
          <div className="hist-card-label">Выставлено</div>
          <div className="hist-card-value">{money(stats.billed)}</div>
          <div className="hist-card-sub">{stats.count} {stats.count === 1 ? 'счёт' : 'счетов'}</div>
        </div>
        <div className="hist-card">
          <div className="hist-card-label">Оплачено в этом месяце</div>
          <div className="hist-card-value">{money(stats.paidThisMonth)}</div>
        </div>
        <div className="hist-card">
          <div className="hist-card-label">Средний чек</div>
          <div className="hist-card-value">{money(stats.avg)}</div>
        </div>
      </div>

      <div className="hist-chart">
        <div className="hist-chart-title">Оплачено по месяцам</div>
        {stats.paid === 0 ? (
          <div className="hist-chart-empty">Пока нет оплаченных счетов — цифры появятся, как отметите оплату.</div>
        ) : (
          <div className="hist-bars">
            {stats.byMonth.map((b) => (
              <div className="hist-bar-col" key={b.key} title={`${b.label}: ${money(b.value)}`}>
                <div className="hist-bar-val">{b.value ? Math.round(b.value / 1000) + 'к' : ''}</div>
                <div className="hist-bar" style={{ height: `${Math.round((b.value / stats.max) * 100)}%` }} />
                <div className={`hist-bar-lbl${b.isYearStart ? ' is-year' : ''}`}>{b.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

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
              <div className="history-item-head">
                <div className="job-item-title">{j.car_model}{j.order_number ? <span className="job-item-order"> №{j.order_number}</span> : ''}</div>
                <div className="history-item-actions">
                  {hasInvoice && (
                    <>
                      <span className="hist-amount">{money(amount)}</span>
                      <button className={`hist-paid-toggle ${paid ? 'is-paid' : 'is-unpaid'}`} onClick={() => toggleJobPaid(j.id)} title={paid ? 'Отметить как неоплаченный' : 'Отметить оплату'}>
                        {paid ? '✓ Оплачено' : '● Не оплачено'}
                      </button>
                    </>
                  )}
                  <button className="job-item-docs" title="Документы: заказ-наряд, акты, счёт" onClick={() => openDocs(j.id)}>📄</button>
                  <button className="history-item-restore" onClick={() => restore(j.id)}>↺ Вернуть в работу</button>
                </div>
              </div>
              <div className="job-item-sub">{j.plate_number || '—'} {j.client_name ? `· ${j.client_name}` : ''}</div>
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
