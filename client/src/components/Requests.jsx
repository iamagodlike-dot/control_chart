import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { auth } from '../firebase';
import { sortRequestsNewest, jobLabel } from '../requests';
import RequestsView from './RequestsView';

// Container for «Заявки на закупку». Staff (мастер/экспедитор) create requests and
// see their own; the owner sees every request and approves/rejects them. No money is
// touched here — buying happens on the «Закупки» screen. Markup lives in the view.
const EMPTY_FORM = { item_name: '', qty: '1', unit: 'шт', for_job_id: '', urgent: false, comment: '' };

export default function Requests({ role }) {
  const isOwner = role === 'owner';
  const email = auth.currentUser?.email || '';
  const [requests, setRequests] = useState(null); // null → грузим
  const [jobs, setJobs] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try { setRequests(isOwner ? await api.requests.listAll() : await api.requests.listMine(email)); }
    catch { setRequests([]); }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  // Активные машины для необязательного поля «для какой машины».
  useEffect(() => {
    let alive = true;
    api.jobs.listAllBrief()
      .then((list) => { if (alive) setJobs(list.filter((j) => !j.archived)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const list = useMemo(() => sortRequestsNewest(requests || []), [requests]);

  async function onAdd() {
    setError('');
    const name = form.item_name.trim();
    if (!name) { setError('Напишите, что нужно купить.'); return; }
    if ((Number(form.qty) || 0) <= 0) { setError('Укажите количество больше нуля.'); return; }
    setBusy('add');
    try {
      const job = jobs.find((j) => j.id === form.for_job_id);
      await api.requests.create({
        item_name: name,
        qty: Number(form.qty) || 1,
        unit: form.unit,
        for_job_id: form.for_job_id || null,
        for_job_label: job ? jobLabel(job) : null,
        urgent: form.urgent,
        comment: form.comment.trim(),
        created_by_name: auth.currentUser?.displayName || undefined,
      });
      setForm(EMPTY_FORM);
      await load();
    } catch {
      setError('Не удалось отправить заявку. Проверьте связь и попробуйте ещё раз.');
    } finally { setBusy(null); }
  }

  async function onApprove(id) {
    setBusy(id);
    try { await api.requests.approve(id); await load(); }
    catch { /* правила/сеть */ }
    finally { setBusy(null); }
  }

  async function onReject(id) {
    const reason = prompt('Причина отказа (необязательно):') ?? '';
    setBusy(id);
    try { await api.requests.reject(id, reason); await load(); }
    catch { /* правила/сеть */ }
    finally { setBusy(null); }
  }

  async function onCancel(id) {
    if (!confirm('Удалить эту заявку?')) return;
    setBusy(id);
    try { await api.requests.remove(id); await load(); }
    catch { /* правила/сеть */ }
    finally { setBusy(null); }
  }

  return (
    <RequestsView
      isOwner={isOwner}
      loading={requests === null}
      requests={list}
      jobs={jobs}
      form={form}
      onFormChange={setForm}
      onAdd={onAdd}
      onApprove={onApprove}
      onReject={onReject}
      onCancel={onCancel}
      busy={busy}
      error={error}
      myEmail={(email || '').toLowerCase()}
    />
  );
}
