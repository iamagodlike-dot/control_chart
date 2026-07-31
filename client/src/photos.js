// Загрузка фото автомобилей на СВОЙ сервер (не Firebase Storage — российские
// карты не проходят для Blaze). Схема: телефон сжимает снимок → шлём файл на
// /api/photos с токеном входа Firebase → сервер проверяет токен и сохраняет
// файл, возвращает ссылку → ссылку кладём в job.photos (см. api.jobs.addPhoto).
import { auth } from './firebase';
import { isHeic, looksLikeHeif } from './heic';

export { isHeic, looksLikeHeif };

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

// ─── HEIC с айфонов ──────────────────────────────────────────────────────────
// Съёмка на iPhone по умолчанию даёт HEIC. Safari его понимает (системный кодек),
// а Chrome, Firefox и весь Android — НЕТ: createImageBitmap падает, и <img> такой
// файл не рисует. Раньше он уезжал на сервер как есть и потом не открывался ни у
// кого, кроме владельца айфона. Теперь такие снимки перекодируем в обычный JPEG
// прямо в браузере.
//
// Декодер (libheif в wasm) весит около мегабайта, поэтому подключается ЛЕНИВО —
// отдельным файлом и только тем, кому он реально нужен.

// Двухпиксельный HEIC (509 байт) — им проверяем, умеет ли браузер такие файлы
// сам. Пробу гоняем один раз за сеанс: на айфоне она пройдёт, и мегабайтный
// декодер качать незачем.
const HEIC_PROBE = 'data:image/heic;base64,AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABh21ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAOdpcHJwAAAAxmlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAAAAgAAAAIAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcmh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAJEIBAQNwAAADALAAAAMAAAMAHqAUIEHAoQQYh7kWVTcCAgYAgKIAAQAJRAHAYXLIQFMkAAAAGWlwbWEAAAAAAAAAAQABBoECAwWGhAAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAG7AAAAQgAAAAFtZGF0AAAAAAAAAFIAAAA+KAGvo2MNKx0Fv5S4rHtKpukoU54tX//6sBACgWPNlCOH/46XADeBQI9UNeNR/5eAZrOh8r+8oDRlXqPxRoA=';

let nativeHeicPromise = null;
export function canDecodeHeicNatively() {
  if (!nativeHeicPromise) {
    nativeHeicPromise = fetch(HEIC_PROBE)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((bmp) => { bmp.close?.(); return true; })
      .catch(() => false);
  }
  return nativeHeicPromise;
}

let decoderPromise = null;
// Заранее подтянуть декодер — зовём при открытии дефектовки, пока связь ещё есть:
// на площадке её может не стать, а докачать мегабайт офлайн неоткуда.
export function preloadHeicDecoder() {
  if (!decoderPromise) {
    decoderPromise = import('heic-to').catch((e) => { decoderPromise = null; throw e; });
  }
  return decoderPromise;
}

async function heicToJpeg(file, quality) {
  let mod;
  try {
    mod = await preloadHeicDecoder();
  } catch {
    throw new Error('Не удалось загрузить конвертер HEIC — нужна связь. Снимок не сохранён.');
  }
  try {
    // Промежуточный JPEG берём качеством повыше: его ещё раз пережмёт наш
    // собственный проход, и двойная потеря качества ни к чему.
    return await mod.heicTo({ blob: file, type: 'image/jpeg', quality: Math.min(0.95, quality + 0.1) });
  } catch {
    throw new Error('Не удалось прочитать HEIC-снимок. Снимите ещё раз или переключите камеру на JPEG.');
  }
}

// Сжатие в браузере через <canvas>. imageOrientation:'from-image' разворачивает
// снимок по EXIF, иначе фото с телефона висят боком. HEIC сначала перекодируется
// в JPEG (см. выше). Если формат не по зубам вовсе — отдаём оригинал как есть,
// пусть сервер сохранит: потерять снимок хуже, чем сохранить неудобный.
export async function compressImage(file, { maxDim = MAX_DIM, quality = QUALITY, targetBytes = TARGET_MAX_BYTES } = {}) {
  if (!file) throw new Error('Файл не выбран');
  let heic = isHeic(file);
  if (!heic && !file.type?.startsWith('image/')) {
    // Ни тип, ни имя на картинку не похожи — прежде чем отказать, заглянем в байты:
    // так спасаются снимки из галерей, которые отдают файл без всего.
    heic = await looksLikeHeif(file);
    if (!heic) throw new Error('Это не изображение');
  }

  let source = file;
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Формат не по зубам этому браузеру — bitmap остаётся null, разбираемся ниже.
  }
  // Сюда попадают Chrome/Android с айфоновским снимком: сам файл браузер не
  // осилил, но это HEIC — значит, дело поправимое.
  if (!bitmap && heic) {
    source = await heicToJpeg(file, quality);
    try {
      bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch {
      // Перекодировали, но уменьшить не смогли — уже победа: это обычный JPEG.
      return { blob: source, w: 0, h: 0 };
    }
  }
  if (!bitmap) return { blob: file, w: 0, h: 0 };
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
  // Запасной вариант — `source`, а не исходный файл: у перекодированного HEIC это
  // уже JPEG, и откатываться к нечитаемому оригиналу было бы шагом назад.
  return { blob: out.blob || source, w: out.w, h: out.h };
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

// Отправить УЖЕ сжатый снимок. Нужен очереди отправки (photoQueue.js): она жмёт
// файл в момент съёмки, чтобы в хранилище телефона не лежали оригиналы по 10 МБ,
// и хранит готовый Blob до появления связи. Второй раз сжимать нечего.
export async function uploadBlob(jobId, blob, name = 'photo.jpg', onProgress) {
  const form = new FormData();
  form.append('file', blob, name);
  const res = await xhrUpload(
    `${PHOTO_API}/upload/${encodeURIComponent(jobId)}`,
    form,
    await authHeader(),
    onProgress,
  );
  return { url: res.url, path: res.path, size: res.size || blob.size || 0, w: res.w || 0, h: res.h || 0 };
}

// Загрузить файл счёта поставщика (PDF / фото / документ) на свой сервер.
// В отличие от фото машин НЕ сжимаем (счёт нужен как есть) и не привязываем к
// машине — счёт может охватывать несколько машин. Возвращает { url, name, size }.
export async function uploadInvoiceFile(file, onProgress) {
  if (!file) throw new Error('Файл не выбран');
  const form = new FormData();
  form.append('file', file, file.name || 'invoice');
  const res = await xhrUpload(
    `${PHOTO_API}/upload-invoice`,
    form,
    await authHeader(),
    onProgress,
  );
  return { url: res.url, path: res.path, name: res.name || file.name || 'Счёт', size: res.size || file.size || 0 };
}

// Удалить файл с сервера. Best-effort: запись из job.photos уже убрана вызывающим
// кодом, поэтому сбой чистки файла не критичен (останется «сирота» на диске).
export async function deletePhotoFile(path) {
  if (!path) return;
  const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
  await fetch(`${PHOTO_API}/delete`, { method: 'POST', headers, body: JSON.stringify({ path }) });
}
