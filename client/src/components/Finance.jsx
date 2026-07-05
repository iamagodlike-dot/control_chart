import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { money, computeDocTotals } from '../orderDoc';
import { computeCosting } from '../costing';
import {
  PERIODS, computeFinance, computeCashFlow, buildFinanceCsv,
  periodRange, inRange, jobDate,
} from '../finance';
import { PAYMENT_SHORT, isInsurance } from '../insurance';
import FinancePanel from './FinancePanel';
import MoneyFeed from './MoneyFeed';
import CostingModal from './CostingModal';
import DocumentsModal from './DocumentsModal';
import Icon from './Icon';
import { DocsButton } from './RowActionButtons';
import '../history.css';

const VIEWS = [
  { id: 'overview', label: 'Обзор', icon: 'chart' },
  { id: 'feed', label: 'Лента', icon: 'receipt' },
  { id: 'cars', label: 'Машины', icon: 'car' },
];

const SORTS = [
  { id: 'profit_desc', label: 'Прибыль ↓' },
  { id: 'profit_asc', label: 'Прибыль ↑' },
  { id: 'date_desc', label: 'Сначала новые' },
  { id: 'date_asc', label: 'Сначала старые' },
];

function invoiceAmount(inv) {
  const t = inv.totals && typeof inv.totals.total === 'number' ? inv.totals.total : computeDocTotals(inv).total;
  return Number(t) || 0;
}

export default function Finance() {
  const [view, setView] = useState('overview');
  const [period, setPeriod] = useState('all');
  const [allJobs, setAllJobs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [company, setCompany] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('profit_desc');
  const [costingJob, setCostingJob] = useState(null);
  const [docsJob, setDocsJob] = useState(null);

  const load = async () => {
    setLoading(true);
    const [all, d, tx, comp] = await Promise.all([
      api.jobs.listAllBrief().catch(() => []),
      api.orderDocuments.listAll().catch(() => []),
      api.transactions.list().catch(() => []),
      api.settings.getCompany().catch(() => ({})),
    ]);
    setAllJobs(all);
    setDocs(d);
    setTransactions(tx);
    setCompany(comp);
    setLoading(false);
  };
  const loadJobs = async () => setAllJobs(await api.jobs.listAllBrief().catch(() => []));
  const loadDocs = async () => setDocs(await api.orderDocuments.listAll().catch(() => []));
  const loadTx = async () => setTransactions(await api.transactions.list().catch(() => []));

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/set-state-in-effect

  const invoices = useMemo(() => docs.filter((d) => d.type === 'invoice'), [docs]);
  const invByJob = useMemo(() => {
    const m = {};
    for (const inv of invoices) (m[inv.job_id] ||= []).push(inv);
    return m;
  }, [invoices]);

  // Newest заказ-наряд per job — source of the agreed prepayment amount.
  const lastOrderByJob = useMemo(() => {
    const m = new Map();
    for (const d of docs) {
      if (d.type !== 'order' || !d.job_id) continue;
      const prev = m.get(d.job_id);
      if (!prev || (d.created_at || 0) > (prev.created_at || 0)) m.set(d.job_id, d);
    }
    return m;
  }, [docs]);

  const fin = useMemo(
    () => computeFinance({ jobs: allJobs, invoices, transactions, company, period }),
    [allJobs, invoices, transactions, company, period],
  );
  const cash = useMemo(
    () => computeCashFlow({ jobs: allJobs, invoices, transactions, period }),
    [allJobs, invoices, transactions, period],
  );
  const periodLabel = PERIODS.find((p) => p.id === period)?.label || '';

  // Per-car finance cards: every car with any financial footprint —
  // себестоимость, счёт или предоплата — within the selected period.
  const cars = useMemo(() => {
    const range = periodRange(period);
    const q = search.trim().toLowerCase();
    let list = allJobs
      .map((j) => {
        const invs = invByJob[j.id] || [];
        const lastOrder = lastOrderByJob.get(j.id);
        const prepayAgreed = Number(lastOrder?.prepayment) || 0;
        return {
          job: j,
          c: j.costing ? computeCosting(j.costing, company) : null,
          invAmount: invs.reduce((s, i) => s + invoiceAmount(i), 0),
          hasInvoice: invs.length > 0,
          paid: invs.length > 0 && invs.every((i) => i.paid),
          prepayAgreed,
        };
      })
      .filter((x) => (x.c || x.hasInvoice || x.prepayAgreed > 0 || x.job.prepayment_paid) && inRange(jobDate(x.job), range));
    if (q) list = list.filter(({ job: j }) => [j.car_model, j.plate_number, j.client_name, j.order_number].some((v) => (v || '').toLowerCase().includes(q)));
    const profitOf = (x) => x.c?.profit ?? -Infinity;
    list.sort((a, b) => {
      switch (sort) {
        case 'profit_asc': return profitOf(a) - profitOf(b);
        case 'date_asc': return jobDate(a.job) - jobDate(b.job);
        case 'date_desc': return jobDate(b.job) - jobDate(a.job);
        default: return profitOf(b) - profitOf(a);
      }
    });
    return list;
  }, [allJobs, invByJob, lastOrderByJob, company, period, search, sort]);

  async function toggleJobPaid(id) {
    const arr = invByJob[id] || [];
    if (!arr.length) return;
    const makePaid = !(arr.length > 0 && arr.every((i) => i.paid));
    try {
      await Promise.all(arr.map((i) => api.orderDocuments.setPaid(i.id, makePaid)));
    } catch { alert('Не удалось сохранить отметку оплаты. Проверьте соединение и попробуйте ещё раз.'); }
    loadDocs();
  }

  // Confirm / undo receipt of the prepayment agreed in the заказ-наряд.
  // The amount is snapshotted at confirmation time so the лента keeps the
  // real figure even if the заказ-наряд is edited later.
  async function togglePrepay(j, prepayAgreed) {
    try {
      if (j.prepayment_paid) {
        if (!window.confirm('Отменить получение предоплаты?')) return;
        await api.jobs.update(j.id, { prepayment_paid: false, prepayment_paid_at: null, prepayment_paid_amount: null });
      } else {
        await api.jobs.update(j.id, { prepayment_paid: true, prepayment_paid_at: Date.now(), prepayment_paid_amount: prepayAgreed });
      }
      loadJobs();
    } catch { alert('Не удалось сохранить отметку предоплаты. Проверьте соединение и попробуйте ещё раз.'); }
  }

  async function openCosting(id) { setCostingJob(await api.jobs.get(id)); }
  async function openDocs(id) { setDocsJob(await api.jobs.get(id)); }

  function exportCsv() {
    const csv = buildFinanceCsv(fin, periodLabel, cash);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Финансы_${periodLabel}_${dayjs().format('YYYY-MM-DD')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <div className="gantt-loading"><div className="spinner" /><span>Загружаем финансы…</span></div>;
  }

  return (
    <div className="panel history-panel">
      <div className="fin-toolbar">
        <div className="hist-viewtabs fin-views">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}><Icon name={v.icon} size={15} />{v.label}</button>
          ))}
        </div>
        <div className="fin-periods">
          {PERIODS.map((p) => (
            <button key={p.id} className={period === p.id ? 'active' : ''} onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
        <button className="fin-export cc-btn-ico" onClick={exportCsv} title="Скачать сводку в Excel (CSV)"><Icon name="download" size={15} />Для бухгалтера</button>
      </div>

      {view === 'overview' && <FinancePanel fin={fin} periodLabel={periodLabel} />}

      {view === 'feed' && <MoneyFeed cash={cash} onTxChanged={loadTx} />}

      {view === 'cars' && (
        <>
          <div className="hist-list-head">
            <h3>Экономика по машинам</h3>
            <div className="hist-controls">
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

          {cars.length === 0 && (
            <div className="job-empty">
              {search ? 'Ничего не найдено' : 'Пока нет машин с финансами за этот период. Заполните себестоимость на графике или в карточке машины.'}
            </div>
          )}

          <div className="history-list">
            {cars.map(({ job: j, c, invAmount, hasInvoice, paid, prepayAgreed }) => (
              <div className="history-item fin-car" key={j.id}>
                <div className="history-item-head" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                  <div className="job-item-title" style={{ flex: '1 1 auto', minWidth: 0 }}>
                    {j.car_model || 'Без модели'}{j.order_number ? <span className="job-item-order"> №{j.order_number}</span> : ''}
                  </div>
                  <span className={`fin-car-status ${j.archived ? 'is-closed' : 'is-active'}`}>{j.archived ? 'Закрыт' : 'В работе'}</span>
                  {c
                    ? <span className={`hist-profit ${c.profit >= 0 ? 'is-gain' : 'is-loss'}`}>{c.profit >= 0 ? '▲' : '▼'} {money(c.profit)} · {c.margin_pct}%</span>
                    : <span className="fin-car-nocost">себестоимость не заполнена</span>}
                </div>

                <div className="job-item-sub">
                  {j.plate_number || '—'}{j.client_name ? ` · ${j.client_name}` : ''}
                  {j.payment_type ? ` · ${isInsurance(j) && j.insurer_name ? j.insurer_name : (PAYMENT_SHORT[j.payment_type] || '')}` : ''}
                </div>

                {c && (
                  <div className="fin-car-breakdown">
                    <span>Выручка {money(c.revenue)}</span>
                    <span>Себест. {money(c.cost_total)}</span>
                    <span className="fin-car-chip"><em>Запчасти</em> {money(c.parts_cost)}</span>
                    <span className="fin-car-chip"><em>Материалы</em> {money(c.materials_cost)}</span>
                    <span className="fin-car-chip"><em>Мастера</em> {money(c.labor_cost)}</span>
                    {c.overhead_cost > 0 && <span className="fin-car-chip"><em>Накладные</em> {money(c.overhead_cost)}</span>}
                  </div>
                )}

                {(hasInvoice || prepayAgreed > 0 || j.prepayment_paid) && (
                  <div className="fin-car-pay">
                    {hasInvoice && (
                      <button
                        className={`hist-paid-toggle ${paid ? 'is-paid' : 'is-unpaid'}`}
                        onClick={() => toggleJobPaid(j.id)}
                        title={paid ? 'Нажмите, чтобы отменить оплату' : 'Нажмите, чтобы подтвердить оплату счёта'}
                      >
                        {paid ? '✓ Счёт оплачен' : '● Счёт не оплачен'} · {money(invAmount)}
                      </button>
                    )}
                    {(prepayAgreed > 0 || j.prepayment_paid) && (
                      <button
                        className={`fin-prepay-toggle ${j.prepayment_paid ? 'is-paid' : 'is-unpaid'}`}
                        onClick={() => togglePrepay(j, prepayAgreed)}
                        title={j.prepayment_paid ? 'Нажмите, чтобы отменить получение предоплаты' : 'Нажмите, чтобы подтвердить получение предоплаты'}
                      >
                        {j.prepayment_paid
                          ? `✓ Предоплата получена · ${money(j.prepayment_paid_amount)}`
                          : `Предоплата ${money(prepayAgreed)} — подтвердить`}
                      </button>
                    )}
                  </div>
                )}

                <div className="history-item-actions" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                  <button className="primary small cc-btn-ico" onClick={() => openCosting(j.id)}><Icon name="wallet" size={14} />Себестоимость</button>
                  <DocsButton onClick={() => openDocs(j.id)} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {costingJob && (
        <CostingModal
          job={costingJob}
          onSaved={() => loadJobs()}
          onClose={() => { setCostingJob(null); loadJobs(); }}
        />
      )}
      {docsJob && (
        <DocumentsModal
          job={docsJob}
          company={company}
          onClose={() => { setDocsJob(null); loadJobs(); loadDocs(); }}
        />
      )}
    </div>
  );
}
