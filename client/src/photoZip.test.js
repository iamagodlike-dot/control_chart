// Архив фотографий машины. Zero-dependency —
// run with:  node --test src/photoZip.test.js
//
// Что здесь доказывается:
//  1. архив получается НАСТОЯЩИМ zip (подписи, каталог, имена внутри) — иначе
//     Windows скажет «повреждённый архив», и это выяснится у оценщика;
//  2. одно битое/удалённое фото не лишает человека всех остальных;
//  3. имена внутри архива читаемые и не повторяются;
//  4. внутри ТОЛЬКО фото — файл с текстом письма туда не кладут.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zipEntryName, uniqueNames, archiveName, buildPhotoArchive,
} from './photoZip.js';

const opt = (label, path) => ({ label, path, url: path, id: path });
const FIXED = new Date('2026-08-01T10:00:00Z');
// «Скачивание» без сети: имя файла превращаем в его же байты.
const fakeLoad = async (o) => new TextEncoder().encode(`bytes:${o.path}`);

// Разбор zip своими руками: центральный каталог в конце, у каждой записи подпись
// 0x02014b50, дальше длина имени и само имя (UTF-8).
function zipNames(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let i = 0; i < bytes.length - 4; i += 1) {
    if (dv.getUint32(i, true) !== 0x02014b50) continue;
    const nameLen = dv.getUint16(i + 28, true);
    out.push(new TextDecoder().decode(bytes.slice(i + 46, i + 46 + nameLen)));
  }
  return out;
}

test('на выходе настоящий zip: локальные записи, каталог и хвост на месте', async () => {
  const { blob } = await buildPhotoArchive(
    [opt('Повреждения крупно', '/uploads/jobs/j/1.jpg'), opt('VIN-табличка', '/uploads/jobs/j/2.png')],
    { load: fakeLoad, now: FIXED },
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(bytes.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50, 'нет подписи первой записи');
  assert.equal(blob.type, 'application/zip');
  // Хвост архива (End of central directory) обязателен — по нему архиватор
  // вообще находит содержимое.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  assert.ok(eocd > 0, 'нет хвоста архива');
  assert.equal(dv.getUint16(eocd + 10, true), 2, 'в каталоге не 2 файла');
  assert.deepEqual(zipNames(bytes), ['01 Повреждения крупно.jpg', '02 VIN-табличка.png']);
});

test('битое фото не рушит архив — остальные внутри, пропавшее названо', async () => {
  const load = async (o) => {
    if (o.path.includes('2')) throw new Error('нет такого файла');
    return fakeLoad(o);
  };
  const { blob, missing } = await buildPhotoArchive(
    [opt('Левый борт', '/uploads/jobs/j/1.jpg'), opt('Правый борт', '/uploads/jobs/j/2.jpg')],
    { load, now: FIXED },
  );
  const names = zipNames(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(names, ['01 Левый борт.jpg']);
  assert.deepEqual(missing, ['02 Правый борт.jpg']);
});

test('в архиве только фото — никакого файла с текстом письма', async () => {
  const { blob } = await buildPhotoArchive(
    [opt('Салон', '/uploads/jobs/j/1.jpg')],
    { load: fakeLoad, now: FIXED },
  );
  assert.deepEqual(zipNames(new Uint8Array(await blob.arrayBuffer())), ['01 Салон.jpg']);
});

test('пустой выбор фото даёт пустой архив, а не поломку', async () => {
  const { blob } = await buildPhotoArchive([], { load: fakeLoad, now: FIXED });
  assert.deepEqual(zipNames(new Uint8Array(await blob.arrayBuffer())), []);
});

test('имена внутри архива: номер, подпись, расширение исходника', () => {
  assert.equal(zipEntryName({ label: 'Перед ¾ слева', path: '/u/a.JPG' }, 0), '01 Перед ¾ слева.jpg');
  assert.equal(zipEntryName({ label: 'После ремонта', path: '/u/b.png' }, 9), '10 После ремонта.png');
  assert.equal(zipEntryName({}, 0), '01 Фото.jpg');                       // нет данных → не падаем
  // Слэши и двоеточия в имени файла запрещены — подпись чистится.
  assert.equal(zipEntryName({ label: 'Крыло / бампер', path: '/u/c.jpg' }, 1), '02 Крыло бампер.jpg');
});

test('дубли имён разводятся, а не затирают друг друга', () => {
  assert.deepEqual(
    uniqueNames(['a.jpg', 'a.jpg', 'b.jpg', 'a.jpg']),
    ['a.jpg', 'a (2).jpg', 'b.jpg', 'a (3).jpg'],
  );
});

test('имя архива — модель и госномер', () => {
  assert.equal(archiveName({ car_model: 'Geely Atlas Pro', plate_number: 'А123ВС 96' }), 'Geely Atlas Pro А123ВС 96 — фото');
  assert.equal(archiveName({}), 'Автомобиль — фото');
  assert.equal(archiveName({ car_model: 'Kia Rio', plate_number: 'А1/В2' }), 'Kia Rio А1 В2 — фото');
});
