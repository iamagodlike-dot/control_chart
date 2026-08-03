// Архив фотографий машины: «⤓ Архив фото» в карточке. Так фото уезжают оценщику:
// скачали архив → вложили в письмо в Яндекс.Почте → отправили. Текст письма в архив
// НЕ кладём (решение владельца) — его забирают кнопкой «Копировать текст».
//
// Zip собираем сами, в браузере, БЕЗ библиотек — упаковщик уже есть в проекте
// (им же собирается .xlsx). Сжатие не нужно: JPEG уже сжат, «store» быстрее и
// даёт тот же вес. Фото качаем прямо с nginx (/uploads/…) — сервер и его
// заблокированный SMTP тут вообще не участвуют.
import { zipStore, safeFileName } from './xlsx.js';

// Имя файла ВНУТРИ архива: «01 Повреждения крупно.jpg». Кириллица тут уместна —
// человек распаковывает архив глазами (в почтовых вложениях, наоборот, латиница:
// см. mailPhotoOptions).
export function zipEntryName(option, index) {
  const num = String(index + 1).padStart(2, '0');
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(option?.path || '');
  const ext = (m ? m[1] : 'jpg').toLowerCase();
  const label = safeFileName(option?.label || 'Фото');
  return `${num} ${label}.${ext}`;
}

// Одинаковых подписей бывает много («Повреждения крупно» ×5). Номер впереди уже
// делает имена разными, но если zip когда-нибудь начнут собирать без нумерации —
// дубли молча съедят файлы, поэтому страхуемся здесь.
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((raw) => {
    const n = seen.get(raw) || 0;
    seen.set(raw, n + 1);
    if (!n) return raw;
    const m = /^(.*?)(\.[A-Za-z0-9]{1,8})$/.exec(raw);
    return m ? `${m[1]} (${n + 1})${m[2]}` : `${raw} (${n + 1})`;
  });
}

// Имя самого архива: «Geely Atlas Pro А123ВС 96 — фото».
export function archiveName(job) {
  const bits = [job?.car_model, job?.plate_number].map((s) => String(s || '').trim()).filter(Boolean);
  return safeFileName(`${bits.join(' ') || 'Автомобиль'} — фото`);
}

// Скачать один снимок с nginx. Отдельной функцией, чтобы её можно было подменить
// в тестах (там сети нет).
export async function loadPhoto(option) {
  const res = await fetch(option.url || option.path);
  if (!res.ok) throw new Error(`Не удалось скачать фото (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Собрать архив. Пропавший снимок (кто-то удалил его, пока человек выбирал) НЕ
 * рушит архив: он просто не попадёт внутрь, а его имя вернётся в `missing` —
 * иначе одно битое фото лишало бы человека всех остальных.
 *
 * @returns {{ blob: Blob, names: string[], missing: string[] }}
 */
export async function buildPhotoArchive(options, {
  load = loadPhoto, onProgress = null, now = undefined,
} = {}) {
  const names = uniqueNames(options.map((o, i) => zipEntryName(o, i)));
  const files = [];
  const missing = [];
  for (const [i, option] of options.entries()) {
    try {
      files.push({ name: names[i], data: await load(option) });
    } catch {
      missing.push(names[i]);
    }
    if (onProgress) onProgress(i + 1, options.length);
  }
  const bytes = zipStore(files, now || new Date());
  return { blob: new Blob([bytes], { type: 'application/zip' }), names, missing };
}

// Отдать готовый архив пользователю. Revoke с задержкой — Safari отменяет
// скачивание, если ссылку освободить раньше, чем он забрал данные (тот же
// подводный камень, что в downloadXlsx).
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
