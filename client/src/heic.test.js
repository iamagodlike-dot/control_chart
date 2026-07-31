// Тесты распознавания HEIC. Запуск:  node --test src/heic.test.js
//
// Ловят ровно то, из-за чего снимок с айфона может не приложиться: телефоны и
// галереи описывают один и тот же файл по-разному, и промах здесь означает
// «Это не изображение» у приёмщика, стоящего с телефоном у машины.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEIF_BRANDS, isHeic, looksLikeHeif } from './heic.js';

// Заголовок настоящего HEIF: 4 байта длины бокса, «ftyp», марка формата.
// Собираем на Uint8Array, а не на Buffer: тот же файл читает и eslint с браузерным
// окружением, и node.
const ascii = (s) => new TextEncoder().encode(s);
function heifHead(brand = 'heic', extra = 64) {
  return new Blob([new Uint8Array([0, 0, 0, 0x24]), ascii('ftyp'), ascii(brand), new Uint8Array(extra)]);
}

test('по типу: heic и heif узнаются, обычные картинки — нет', () => {
  assert.ok(isHeic({ type: 'image/heic', name: 'IMG_0042.HEIC' }));
  assert.ok(isHeic({ type: 'image/heif', name: 'x' }));
  assert.ok(isHeic({ type: 'image/heic-sequence', name: 'live.heic' }));
  assert.ok(!isHeic({ type: 'image/jpeg', name: 'IMG_0042.jpg' }));
  assert.ok(!isHeic({ type: 'image/png', name: 'shot.png' }));
  // Расширение .heic при честном типе картинки — верим типу, а не имени.
  assert.ok(!isHeic({ type: 'image/jpeg', name: 'странное.heic' }));
});

test('без типа: узнаём по расширению — так отдают файл многие галереи', () => {
  assert.ok(isHeic({ type: '', name: 'IMG_0042.HEIC' }));
  assert.ok(isHeic({ type: '', name: 'photo.heif' }));
  assert.ok(isHeic({ type: 'application/octet-stream', name: 'img.heic' }));
  assert.ok(!isHeic({ type: '', name: 'notes.txt' }));
  assert.ok(!isHeic({ type: '', name: '' }));
  assert.ok(!isHeic(null));
});

test('по сигнатуре: файл без типа и без расширения всё равно узнаётся', async () => {
  assert.ok(await looksLikeHeif(heifHead('heic')));
  assert.ok(await looksLikeHeif(heifHead('mif1')));   // так помечены снимки iPhone
  assert.ok(await looksLikeHeif(heifHead('msf1')));   // серии и Live Photo
  assert.ok(!await looksLikeHeif(new Blob([ascii('обычный текст, не картинка')])));
  // JPEG: сигнатура FF D8 FF, никакого ftyp.
  assert.ok(!await looksLikeHeif(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46])])));
  // MP4 — тоже ISO-контейнер с ftyp, но марка чужая: перекодировать нечего.
  assert.ok(!await looksLikeHeif(heifHead('isom')));
});

test('обрывок файла не роняет проверку', async () => {
  assert.ok(!await looksLikeHeif(new Blob([new Uint8Array([0, 0, 0])])));
  assert.ok(!await looksLikeHeif(new Blob([])));
});

test('список марок покрывает и одиночные снимки, и серии', () => {
  for (const b of ['heic', 'mif1', 'msf1', 'hevc']) assert.ok(HEIF_BRANDS.includes(b));
});
