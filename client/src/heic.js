// Распознавание HEIC/HEIF — вынесено из photos.js, чтобы гонять тестами:
// photos.js тянет за собой Firebase, а эти правила чистые.
//
// ЗАЧЕМ ЭТО ВООБЩЕ. Айфон по умолчанию снимает в HEIC. Safari его понимает, а
// Chrome, Firefox и весь Android — нет. Такой снимок надо перекодировать в JPEG
// (см. compressImage), но сперва его надо УЗНАТЬ, а телефоны и галереи описывают
// файл кто во что горазд:
//   • честно:            type = 'image/heic', имя IMG_0042.HEIC
//   • без типа:          type = '',            имя IMG_0042.HEIC
//   • как попало:        type = 'application/octet-stream', имя img.heif
//   • совсем без всего:  type = '',            имя IMG_0042
// Первые три ловятся по типу и расширению, последний — только по сигнатуре внутри
// файла. Ошибиться тут дорого: не узнали HEIC — приёмщик получит «Это не
// изображение» и не сможет приложить снимок.

const HEIC_NAME_RE = /\.(heic|heif)$/i;

// Марки формата в заголовке HEIF. Их больше, чем кажется: у серий (Live Photo,
// бёрст) марка своя, а файл всё тот же.
export const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

// Быстрая проверка по типу и имени — без чтения содержимого.
export function isHeic(file) {
  const type = String(file?.type || '').toLowerCase();
  if (/^image\/hei[cf]/.test(type)) return true;
  // Тип есть и это картинка (jpeg/png/webp) — точно не наш случай.
  if (type.startsWith('image/')) return false;
  return HEIC_NAME_RE.test(String(file?.name || ''));
}

// Проверка по сигнатуре: в байтах 4..8 стоит «ftyp», следом марка формата.
// Читаем 16 байт, поэтому вызываем только тогда, когда файл и так не похож на
// картинку, — за обычные снимки платить лишним чтением незачем.
export async function looksLikeHeif(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (head.length < 12) return false;
    const str = (a, b) => String.fromCharCode(...head.slice(a, b));
    return str(4, 8) === 'ftyp' && HEIF_BRANDS.includes(str(8, 12).toLowerCase());
  } catch {
    return false;
  }
}
