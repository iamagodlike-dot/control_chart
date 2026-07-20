import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { auth } from '../firebase';
import { uploadPhoto, deletePhotoFile } from '../photos';
import { buildReceiving } from '../receiving';
import ReceivingView from './ReceivingView';

// Container for the экспедитор «Приёмка» screen: subscribes to live jobs, folds
// them into the receiving view-model, and persists status changes. All markup
// lives in <ReceivingView> so the demo can render an identical, Firestore-free copy.
export default function PartsReceiving() {
  const [jobs, setJobs] = useState(null); // null → ещё грузим
  const [filter, setFilter] = useState('arrived'); // экспедитор сразу видит «что забрать»
  const [busy, setBusy] = useState(null);
  const [uploadPart, setUploadPart] = useState(null); // id позиции, чьё фото сейчас грузится
  const [uploadProgress, setUploadProgress] = useState(0);
  const [photoErr, setPhotoErr] = useState(null); // { partId, msg } — ошибка у конкретной позиции
  const [company, setCompany] = useState({});      // настройки компании (флаг requirePickupPhoto)

  useEffect(() => {
    const unsub = api.jobs.subscribeActive((list) => setJobs(list), () => setJobs([]));
    return () => unsub();
  }, []);

  // Настройка «фото обязательно при приёмке» (управленец включает в «Настройках»).
  // Одноразовое чтение — как в остальных экранах (History/Gantt/…).
  useEffect(() => {
    api.settings.getCompany().then(setCompany).catch(() => {});
  }, []);

  const { groups, counts } = useMemo(
    () => buildReceiving(jobs || [], filter),
    [jobs, filter],
  );

  // Change ONE part's status. Take the original part from live jobs so savePart
  // (merges by id) can't wipe its qty/cost/price — we only touch the status.
  async function onSetStatus(jobId, partId, status) {
    const job = (jobs || []).find((j) => j.id === jobId);
    const part = job?.parts?.find((p) => p.id === partId);
    if (!part) return;
    // «Привёз к нам» (arrived → in): если управленец включил обязательное фото —
    // не даём отметить приход без хотя бы одного снимка приёмки у этой позиции.
    if (status === 'in' && company.requirePickupPhoto) {
      const hasReceivingPhoto = (job.photos || []).some(
        (ph) => ph && ph.category === 'receiving' && ph.partId === partId,
      );
      if (!hasReceivingPhoto) {
        setPhotoErr({ partId, msg: 'Сначала прикрепите фото приёмки этой запчасти' });
        return;
      }
    }
    setBusy(partId);
    try { await api.jobs.savePart(jobId, { ...part, status }); }
    catch { /* правила/сеть — живой снапшот вернёт актуальное состояние */ }
    finally { setBusy(null); }
  }

  // Прикрепить одно или несколько фото к конкретной позиции: каждый снимок
  // сжимается на телефоне, уходит на наш фото-сервер, затем его метаданные (с
  // partId и category:'receiving') дописываются в job.photos. Живой снапшот
  // сам обновит миниатюры — локального оптимистичного стейта не держим.
  // Последовательно (не параллельно), чтобы прогресс отражал одну загрузку.
  async function onAddPhoto(jobId, partId, files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setPhotoErr(null);
    setUploadPart(partId);
    try {
      for (const file of list) {
        setUploadProgress(0);
        const up = await uploadPhoto(jobId, file, setUploadProgress);
        const photo = {
          id: crypto.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
          category: 'receiving', // приёмка запчастей — отдельно от «до/после» карточки
          partId,                // к какой позиции относится снимок
          url: up.url,
          path: up.path,
          size: up.size || 0,
          w: up.w || 0,
          h: up.h || 0,
          uploaded_at: Date.now(),
          uploaded_by: auth.currentUser?.email || null,
        };
        await api.jobs.addPhoto(jobId, photo);
      }
    } catch (err) {
      console.error('Ошибка загрузки фото приёмки:', err);
      setPhotoErr({ partId, msg: err?.message || 'Не удалось загрузить фото' });
    } finally {
      setUploadPart(null);
      setUploadProgress(0);
    }
  }

  // Сохранить/очистить комментарий позиции. Берём исходную деталь из живых jobs,
  // чтобы savePart (merge по id) не затёр её qty/cost/price — трогаем только comment.
  async function onSaveComment(jobId, partId, text) {
    const job = (jobs || []).find((j) => j.id === jobId);
    const part = job?.parts?.find((p) => p.id === partId);
    if (!part) return;
    setBusy(partId);
    try { await api.jobs.savePart(jobId, { ...part, comment: (text || '').trim() }); }
    catch { /* правила/сеть — живой снапшот вернёт актуальное состояние */ }
    finally { setBusy(null); }
  }

  async function onDeletePhoto(jobId, photo) {
    if (!window.confirm('Удалить это фото?')) return;
    setPhotoErr(null);
    try {
      await api.jobs.removePhoto(jobId, photo.id);
      deletePhotoFile(photo.path).catch(() => {}); // чистка файла — best-effort
    } catch (err) {
      console.error('Ошибка удаления фото приёмки:', err);
      setPhotoErr({ partId: photo.partId ?? null, msg: 'Не удалось удалить фото' });
    }
  }

  return (
    <ReceivingView
      loading={jobs === null}
      groups={groups}
      counts={counts}
      filter={filter}
      onFilter={setFilter}
      onSetStatus={onSetStatus}
      busy={busy}
      onAddPhoto={onAddPhoto}
      onDeletePhoto={onDeletePhoto}
      uploadPart={uploadPart}
      uploadProgress={uploadProgress}
      photoErr={photoErr}
      onSaveComment={onSaveComment}
    />
  );
}
