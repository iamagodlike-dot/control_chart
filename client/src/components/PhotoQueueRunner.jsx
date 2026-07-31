import { useEffect } from 'react';
import { api } from '../api';
import { auth } from '../firebase';
import { uploadBlob } from '../photos';
import { installSender, kick } from '../photoQueue';
import { photoCategory } from '../intake';

// Досылает снимки дефектовки, снятые без связи (см. photoQueue.js). Компонент
// ничего не рисует — он лишь объясняет очереди, КАК отправлять снимок: сам модуль
// очереди про Firebase и адрес фотосервера не знает, иначе его нельзя было бы
// гонять тестами.
//
// Живёт на уровне приложения, а не внутри экрана дефектовки: приёмщик закрывает
// мастер сразу после осмотра, а фотографии в этот момент могут ещё уходить.
// Пока приложение открыто — очередь разбирается.
export default function PhotoQueueRunner() {
  useEffect(() => {
    installSender(async (item) => {
      const up = await uploadBlob(item.jobId, item.blob, item.name);
      await api.jobs.addPhoto(item.jobId, {
        // id снимка = id записи в очереди: если отправка прошла, а вычеркнуть из
        // очереди не успели, повторная попытка добавит запись с тем же id, и в
        // карточке машины не появится двойник.
        id: item.id,
        category: photoCategory(item.slot),
        url: up.url,
        path: up.path,
        size: up.size,
        w: up.w || item.w || 0,
        h: up.h || item.h || 0,
        // Время СЪЁМКИ, а не отправки: снимок, пролежавший в телефоне полдня,
        // должен встать в ленту фотографий там, где его сделали.
        uploaded_at: item.created_at,
        uploaded_by: auth.currentUser?.email || null,
      });
    });
    kick();
  }, []);

  return null;
}
