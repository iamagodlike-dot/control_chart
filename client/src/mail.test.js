// Черновик письма «На просчёт» и разбор адресов. Zero-dependency —
// run with:  node --test src/mail.test.js
//
// Что здесь доказывается:
//  1. в письме оказываются данные, без которых оценщик не посчитает (модель,
//     госномер, VIN, убыток) — иначе кнопка бесполезна;
//  2. доаварийные повреждения НЕ смешаны с аварийными (ровно то требование
//     владельца, ради которого в дефектовке есть scope) ;
//  3. на выбор попадают только фото, реально лежащие на сервере, и «после
//     ремонта» по умолчанию не отмечено.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalcDraft, buildDraft, mailPhotoOptions, exportLogText, fmtSize,
  MAIL_TEMPLATES, mailTemplate,
} from './mail.js';

const JOB = {
  id: 'job1',
  car_model: 'Toyota Camry',
  year: '2019',
  color: 'серый',
  plate_number: 'А123ВС124',
  vin: 'XW8ZZZ61ZJG000001',
  order_number: 'ЗН-2026-0042',
  payment_type: 'insurance',
  insurer_name: 'ВСК',
  policy_type: 'kasko',
  claim_number: '24-123456',
  intake: {
    mileage: '123456',
    fuel: 'half',
    notes: 'Машина на ходу, ключ один',
    damages: [
      { zone: 'hood', kind: 'dent', scope: 'case', note: 'слева' },
      { zone: 'bumper_front', kind: 'replace', scope: 'case' },
      { zone: 'door_rear_left', kind: 'scratch', scope: 'old' },
    ],
  },
};
const COMPANY = { name: 'ООО «Авто Академия»', phone: '+7 391 000-00-00', address: 'Красноярск' };

test('тема письма несёт машину, номер и убыток — по ней письмо находят в переписке', () => {
  const { subject } = buildCalcDraft(JOB, { company: COMPANY });
  assert.match(subject, /Просчёт/);
  assert.match(subject, /Toyota Camry/);
  assert.match(subject, /А123ВС124/);
  assert.match(subject, /24-123456/);
});

test('в тексте есть всё, без чего просчёт не сделать', () => {
  const { text } = buildCalcDraft(JOB, { company: COMPANY, senderName: 'Иван', photoCount: 12 });
  for (const needle of [
    'Toyota Camry', 'А123ВС124', 'XW8ZZZ61ZJG000001', '123456 км',
    'ВСК', 'КАСКО', '24-123456', 'ЗН-2026-0042',
    'Бампер передний', 'Капот', 'Во вложении фото: 12',
    'Иван', 'ООО «Авто Академия»', '+7 391 000-00-00',
  ]) assert.ok(text.includes(needle), `в письме нет: ${needle}`);
});

test('доаварийные повреждения вынесены отдельно и не выглядят как аварийные', () => {
  const { text } = buildCalcDraft(JOB, { company: COMPANY });
  const caseIdx = text.indexOf('Повреждения по осмотру:');
  const oldIdx = text.indexOf('Не по этому случаю');
  assert.ok(caseIdx > -1 && oldIdx > caseIdx, 'нет раздела «не по этому случаю» после аварийных');
  // Аварийные пронумерованы, доаварийные — тире, и «Дверь задняя левая» только в старых.
  assert.match(text.slice(caseIdx, oldIdx), /1\. Бампер передний — Требует замены/);
  assert.ok(!text.slice(caseIdx, oldIdx).includes('Дверь задняя левая'));
  assert.match(text.slice(oldIdx), /— Дверь задняя левая — Царапина/);
});

test('пустая дефектовка не ломает письмо — честно отправляет к фотографиям', () => {
  const { subject, text } = buildCalcDraft({ car_model: 'Kia Rio' }, {});
  assert.match(subject, /Kia Rio/);
  assert.match(text, /см\. фотографии/);
  assert.ok(!text.includes('Страховая:'), 'у наличной машины строки страховой быть не должно');
  assert.match(text, /Авто Академия/);          // подпись есть и без настроек компании
});

test('пробег берётся из дефектовки, а если её нет — из карточки', () => {
  assert.match(buildCalcDraft({ mileage: '90000' }, {}).text, /Пробег: 90000 км/);
  assert.match(buildCalcDraft({ mileage: '90000', intake: { mileage: '91500 км' } }, {}).text, /Пробег: 91500 км/);
});

test('buildDraft отдаёт тот же черновик, что и шаблон напрямую', () => {
  assert.deepEqual(buildDraft('calc', JOB, { company: COMPANY }), buildCalcDraft(JOB, { company: COMPANY }));
  assert.equal(mailTemplate('нет такого').id, MAIL_TEMPLATES[0].id);   // неизвестный шаблон → первый, без падения
});

test('на выбор идут фото с сервера: дефектовка по порядку осмотра, «после» не отмечено', () => {
  const job = {
    photos: [
      { id: 'p1', path: '/uploads/jobs/j/1.jpg', url: '/uploads/jobs/j/1.jpg', category: 'intake:damage', size: 300000 },
      { id: 'p2', path: '/uploads/jobs/j/2.jpg', url: '/uploads/jobs/j/2.jpg', category: 'intake:front_left' },
      { id: 'p3', path: '/uploads/jobs/j/3.jpg', url: '/uploads/jobs/j/3.jpg' },              // старое фото без категории = «до»
      { id: 'p4', path: '/uploads/jobs/j/4.png', url: '/uploads/jobs/j/4.png', category: 'after' },
      { id: 'p5', category: 'intake:vin' },                                                    // ещё не загружено на сервер
      // Фото приёмки запчасти: коробка на складе. Оценщику не нужна, в письмо не идёт.
      { id: 'p6', path: '/uploads/jobs/j/6.jpg', url: '/uploads/jobs/j/6.jpg', category: 'receiving', partId: 'pt1' },
    ],
  };
  const opts = mailPhotoOptions(job);
  assert.deepEqual(
    opts.map((o) => o.path),
    ['/uploads/jobs/j/2.jpg', '/uploads/jobs/j/1.jpg', '/uploads/jobs/j/3.jpg', '/uploads/jobs/j/4.png'],
    'порядок = ракурсы осмотра, потом «до», потом «после»',
  );
  // id обязан быть уникальным даже если два снимка пришли с одинаковым id/путём:
  // на нём держатся галочки в окне письма.
  assert.equal(new Set(opts.map((o) => o.id)).size, opts.length);
  assert.equal(
    new Set(mailPhotoOptions({ photos: [
      { id: 'dup', path: '/uploads/jobs/j/9.jpg', category: 'before' },
      { id: 'dup', path: '/uploads/jobs/j/9.jpg', category: 'before' },
    ] }).map((o) => o.id)).size,
    2,
  );
  assert.deepEqual(opts.map((o) => o.checked), [true, true, true, false]);
  assert.equal(opts[1].label, 'Повреждения крупно');
  assert.deepEqual(mailPhotoOptions({}), []);
});

test('запись в журнал читается человеком', () => {
  assert.equal(exportLogText({ template: 'calc', photos: 12 }), 'Архив фото «На просчёт» скачан · 12 фото');
  assert.equal(exportLogText({}), 'Архив фото «На просчёт» скачан');
});

test('размер вложений показывается по-человечески', () => {
  assert.equal(fmtSize(0), '0 Б');
  assert.equal(fmtSize(2048), '2 КБ');
  assert.equal(fmtSize(3_500_000), '3.3 МБ');
});
