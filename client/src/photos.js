// Загрузка фото автомобилей на СВОЙ сервер (не Firebase Storage — российские
// карты не проходят для Blaze). Схема: телефон сжимает снимок → шлём файл на
// /api/photos с токеном входа Firebase → сервер проверяет токен и сохраняет
// файл, возвращает ссылку → ссылку кладём в job.photos (см. api.jobs.addPhoto).
import { auth } from './firebase';

// База адреса приёмника. В проде nginx проксирует /api/photos на программу-приёмник
// (та же машина, тот же домен). Для локальной разработки можно задать VITE_PHOTO_API.
const PHOTO_API = import.meta.env.VITE_PHOTO_API || '/api/photos';

// Фото с телефона — 3–10 МБ. Незачем хранить и гонять оригинал: ужимаем длинную
// сторону до 1600px, JPEG q≈0.82 → обычно 150–400 КБ без видимой потери качества.
const MAX_DIM = 1600;
const QUALITY = 0.82;
// «Слишком тяжёлым» считаем результат крупнее ~1.3 МБ. Если после обычного сжатия
// снимок всё равно тяжелее (очень детальная картинка / камера на 100+ Мп) —
// автоматически дожимаем: сначала понижаем качество, потом уменьшаем размер.
const TARGET_MAX_BYTES = 1_300_000;

// Отрисовать bitmap в JPEG с ограничением длинной стороны и качеством.
function encodeScaled(bitmap, maxDim, quality) {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return new Promise((res) => canvas.toBlob((b) => res({ blob: b, w, h }), 'image/jpeg', quality));
}

// Сжатие в браузере через <canvas>. imageOrientation:'from-image' разворачивает
// снимок по EXIF, иначе фото с телефона висят боком. Если формат не по зубам
// (напр. HEIC на не-Safari) — отдаём оригинал как есть, пусть сервер сохранит.
export async function compressImage(file, { maxDim = MAX_DIM, quality = QUALITY, targetBytes = TARGET_MAX_BYTES } = {}) {
  if (!file || !file.type?.startsWith('image/')) throw new Error('Это не изображение');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { blob: file, w: 0, h: 0 }; // не смогли декодировать — шлём оригинал
  }
  let dim = maxDim;
  let q = quality;
  let out = await encodeScaled(bitmap, dim, q);
  // Дожим: пока тяжелее цели — сначала роняем качество (до 0.5), затем размер.
  // guard ограничивает число проходов, чтобы точно не зациклиться.
  for (let guard = 0; out.blob && out.blob.size > targetBytes && guard < 6; guard++) {
    if (q > 0.5) q = Math.max(0.5, q - 0.12);
    else dim = Math.max(640, Math.round(dim * 0.82));
    out = await encodeScaled(bitmap, dim, q);
  }
  bitmap.close?.();
  return { blob: out.blob || file, w: out.w, h: out.h };
}

// Заголовок с токеном входа — сервер по нему убеждается, что человек залогинен
// в приложении. Токен живёт ~1 час, getIdToken сам обновляет протухший.
async function authHeader() {
  const u = auth.currentUser;
  if (!u) throw new Error('Не выполнен вход');
  return { Authorization: `Bearer ${await u.getIdToken()}` };
}

// XHR (а не fetch) — ради прогресса загрузки: на слабой мобильной сети важно
// видеть, что фото уходит, а не гадать, завис ли интерфейс.
function xhrUpload(url, form, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Сервер вернул непонятный ответ')); }
      } else if (xhr.status === 401) {
        reject(new Error('Сессия истекла — войдите заново'));
      } else if (xhr.status === 413) {
        reject(new Error('Файл слишком большой'));
      } else {
        reject(new Error(`Ошибка загрузки (${xhr.status || 'нет связи'})`));
      }
    };
    xhr.onerror = () => reject(new Error('Нет связи с сервером'));
    xhr.send(form);
  });
}

// Сжать и загрузить один снимок к машине jobId. Возвращает { url, path, size }.
export async function uploadPhoto(jobId, file, onProgress) {
  const { blob, w, h } = await compressImage(file);
  const form = new FormData();
  const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
  form.append('file', blob, `${base}.jpg`);
  const res = await xhrUpload(
    `${PHOTO_API}/upload/${encodeURIComponent(jobId)}`,
    form,
    await authHeader(),
    onProgress,
  );
  return { url: res.url, path: res.path, size: res.size || blob.size || 0, w: res.w || w, h: res.h || h };
}

// Удалить файл с сервера. Best-effort: запись из job.photos уже убрана вызывающим
// кодом, поэтому сбой чистки файла не критичен (останется «сирота» на диске).
export async function deletePhotoFile(path) {
  if (!path) return;
  const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
  await fetch(`${PHOTO_API}/delete`, { method: 'POST', headers, body: JSON.stringify({ path }) });
}
