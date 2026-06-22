import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import DocumentsModal from './DocumentsModal';

const STATUS_LABELS = {
  planned: 'Запланировано',
  in_progress: 'В работе',
  done: 'Готово',
  delayed: 'Задержка',
};

export default function History() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [company, setCompany] = useState({});
  const [docsJob, setDocsJob] = useState(null);

  const load = async () => {
    setLoading(true);
    setJobs(await api.history());
    setLoading(false);
  };

  useEffect(() => {
    load();
    api.settings.getCompany().then(setCompany);
  }, []);

  async function openDocs(jobId) {
    setDocsJob(await api.jobs.get(jobId));
  }

  async function restore(id) {
    await api.jobs.unarchive(id);
    load();
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? jobs.filter((j) =>
        [j.car_model, j.plate_number, j.client_name, j.order_number].some((v) => (v || '').toLowerCase().includes(q))
      )
    : jobs;

  if (loading) {
    return (
      <div className="gantt-loading">
        <div className="spinner" />
        <span>Загружаем историю…</span>
      </div>
    );
  }

  return (
    <div className="panel history-panel">
      <h3>История завершённых заказов</h3>
      <input
        className="job-search"
        placeholder="Поиск по машине, номеру, клиенту…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {filtered.length === 0 && <div className="job-empty">{q ? 'Ничего не найдено' : 'Пока нет завершённых заказов'}</div>}
      <div className="history-list">
        {filtered.map((j) => (
          <div className="history-item" key={j.id}>
            <div className="history-item-head">
              <div className="job-item-title">{j.car_model}{j.order_number ? <span className="job-item-order"> №{j.order_number}</span> : ''}</div>
              <div className="history-item-actions">
                <button className="job-item-docs" title="Документы: заказ-наряд, акты" onClick={() => openDocs(j.id)}>📄</button>
                <button className="history-item-restore" onClick={() => restore(j.id)}>↺ Вернуть в работу</button>
              </div>
            </div>
            <div className="job-item-sub">{j.plate_number || '—'} {j.client_name ? `· ${j.client_name}` : ''}</div>
            {j.archived_at && <div className="history-item-date">Завершён {dayjs(j.archived_at).format('DD.MM.YYYY HH:mm')}</div>}
            <div className="history-item-stages">
              {j.stages.map((s) => (
                <span key={s.id} className="history-stage-chip">
                  {s.post_name || 'Пост'}: {STATUS_LABELS[s.status] || s.status}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {docsJob && (
        <DocumentsModal
          job={docsJob}
          company={company}
          onClose={() => setDocsJob(null)}
          onJobUpdated={async () => setDocsJob(await api.jobs.get(docsJob.id))}
        />
      )}
    </div>
  );
}
