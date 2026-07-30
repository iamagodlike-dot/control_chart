// Тесты экрана «Приёмка авто»: какие машины попадают на экран, правило
// готовности (что блокирует «Завершить приёмку»), выбор шаблона по типу оплаты,
// нормализация кривых настроек и снимок для печатного акта.
// Zero-dependency — run with:  node --test src/intake.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS, DEFAULT_INTAKE_SETTINGS, DEFAULT_PHOTO_SLOTS,
  buildIntakeActSnapshot, buildIntakeList, damageRows, groupZones,
  intakePhotosBySlot, intakeStatus, isIntakeUntouched, isOnIntake,
  normalizeIntakeSettings, photoCategory, photoSlotId, pickTemplate, readIntake,
} from './intake.js';

const NOW = new Date('2026-07-28T12:00:00').getTime();
const daysAgo = (n) => NOW - n * DAY_MS;

// Машина на приёмке со всеми обязательными полями закрытыми — база, от которой
// тесты «отламывают» по одному условию.
const photo = (slot, i = 0) => ({ id: `ph-${slot}-${i}`, category: photoCategory(slot), url: `/p/${slot}.jpg` });
const allPhotos = () => DEFAULT_PHOTO_SLOTS.filter((s) => s.required).map((s) => photo(s.id));
const allChecked = (tplId = 'insurance') => {
  const tpl = DEFAULT_INTAKE_SETTINGS.templates.find((t) => t.id === tplId);
  return tpl.items.filter((i) => i.required).map((i) => i.id);
};

const readyJob = (over = {}) => ({
  id: 'j1',
  car_model: 'Toyota Camry',
  plate_number: 'А123АВ 124',
  client_name: 'Иванов П.',
  payment_type: 'insurance',
  phase: 'approval',
  approval_status: 'inspection',
  created_at: daysAgo(1),
  photos: allPhotos(),
  intake: { status: 'open', mileage: '124500', fuel: 'half', keys: '2', checked: allChecked() },
  ...over,
});

// ─── Какие машины попадают на экран ──────────────────────────────────────────

test('на экран попадает только «Осмотр / дефектовка» на согласовании', () => {
  assert.equal(isOnIntake({ phase: 'approval', approval_status: 'inspection' }), true);
  assert.equal(isOnIntake({ phase: 'approval', approval_status: 'calc' }), false);
  assert.equal(isOnIntake({ phase: 'approval', approval_status: 'approved' }), false);
  assert.equal(isOnIntake({ phase: 'repair' }), false);
  assert.equal(isOnIntake({}), false, 'машина без фазы = ремонт, на приёмку не идёт');
});

test('пустой approval_status трактуется как «Осмотр» — как на доске согласования', () => {
  assert.equal(isOnIntake({ phase: 'approval' }), true);
  assert.equal(isOnIntake({ phase: 'approval', approval_status: '' }), true);
});

test('архивная машина на экран не попадает', () => {
  assert.equal(isOnIntake({ phase: 'approval', approval_status: 'inspection', archived: true }), false);
});

// ─── Правило готовности ──────────────────────────────────────────────────────

test('заполненная машина готова к завершению приёмки', () => {
  const st = intakeStatus(readyJob(), DEFAULT_INTAKE_SETTINGS);
  assert.equal(st.ready, true);
  assert.deepEqual(st.blockers, []);
  assert.equal(st.checklist.done, 10);   // 10 обязательных из 12 пунктов страхового шаблона
  assert.equal(st.checklist.total, 12);
  assert.equal(st.photos.done, 7);       // 7 обязательных рубрик закрыто
  assert.equal(st.photos.total, 8);
});

test('нет пробега → приёмку не закрыть', () => {
  const st = intakeStatus(readyJob({ intake: { mileage: '', fuel: 'half', checked: allChecked() } }), DEFAULT_INTAKE_SETTINGS);
  assert.equal(st.ready, false);
  assert.deepEqual(st.fieldsMissing, ['Пробег']);
  assert.ok(st.blockers.includes('Пробег'));
});

test('не хватает обязательного фото → приёмку не закрыть, видно какого', () => {
  const photos = allPhotos().filter((p) => photoSlotId(p.category) !== 'vin');
  const st = intakeStatus(readyJob({ photos }), DEFAULT_INTAKE_SETTINGS);
  assert.equal(st.ready, false);
  assert.deepEqual(st.photosMissing.map((s) => s.id), ['vin']);
  assert.ok(st.blockers.includes('Фото: VIN-табличка'));
});

test('необязательная рубрика фото готовности не блокирует', () => {
  // 'interior' — единственная необязательная рубрика в дефолтах; её и не снимали.
  const st = intakeStatus(readyJob(), DEFAULT_INTAKE_SETTINGS);
  assert.equal(st.photos.done, 7);
  assert.equal(st.ready, true);
});

test('не отмечен обязательный пункт чек-листа → приёмку не закрыть', () => {
  const checked = allChecked().filter((id) => id !== 'act');
  const st = intakeStatus(readyJob({ intake: { mileage: '100', fuel: 'full', checked } }), DEFAULT_INTAKE_SETTINGS);
  assert.equal(st.ready, false);
  assert.deepEqual(st.checklistMissing.map((i) => i.id), ['act']);
  assert.ok(st.blockers.includes('Распечатать акт приёмки и подписать у клиента'));
});

test('необязательные пункты чек-листа не блокируют', () => {
  const st = intakeStatus(readyJob(), DEFAULT_INTAKE_SETTINGS);
  const optional = st.items.filter((i) => !i.required).map((i) => i.id);
  assert.deepEqual(optional, ['upsell', 'term'], 'в страховом шаблоне два необязательных пункта');
  assert.equal(st.ready, true);
});

test('выключенное требование фото снимает блокировку целиком', () => {
  const settings = { ...DEFAULT_INTAKE_SETTINGS, require_photos: false };
  const st = intakeStatus(readyJob({ photos: [] }), settings);
  assert.deepEqual(st.photosMissing, []);
  assert.equal(st.ready, true);
});

test('нетронутая машина: untouched, ничего не отмечено, всё в блокерах', () => {
  const job = { id: 'x', phase: 'approval', approval_status: 'inspection' };
  const st = intakeStatus(job, DEFAULT_INTAKE_SETTINGS);
  assert.equal(st.untouched, true);
  assert.equal(st.done, false);
  assert.equal(st.ready, false);
  assert.equal(st.checklist.done, 0);
  assert.equal(st.photos.done, 0);
  assert.equal(isIntakeUntouched(job), true);
});

test('закрытая приёмка помечается done, пропущенная — skipped', () => {
  assert.equal(intakeStatus(readyJob({ intake: { status: 'done' } }), DEFAULT_INTAKE_SETTINGS).done, true);
  assert.equal(intakeStatus(readyJob({ intake: { status: 'skipped' } }), DEFAULT_INTAKE_SETTINGS).skipped, true);
});

// ─── Шаблоны ─────────────────────────────────────────────────────────────────

test('шаблон подбирается по типу оплаты', () => {
  assert.equal(pickTemplate({ payment_type: 'insurance' }, DEFAULT_INTAKE_SETTINGS).id, 'insurance');
  assert.equal(pickTemplate({ payment_type: 'cash' }, DEFAULT_INTAKE_SETTINGS).id, 'client');
  assert.equal(pickTemplate({ payment_type: 'legal' }, DEFAULT_INTAKE_SETTINGS).id, 'client');
});

test('машина без типа оплаты считается клиентской', () => {
  assert.equal(pickTemplate({}, DEFAULT_INTAKE_SETTINGS).id, 'client');
});

test('явно выбранный приёмщиком шаблон важнее типа оплаты', () => {
  const job = { payment_type: 'insurance', intake: { template_id: 'client' } };
  assert.equal(pickTemplate(job, DEFAULT_INTAKE_SETTINGS).id, 'client');
});

test('неизвестный тип оплаты падает на универсальный шаблон', () => {
  const settings = {
    templates: [
      { id: 'ins', label: 'Страховая', payment_types: ['insurance'], items: [{ id: 'a', text: 'A' }] },
      { id: 'any', label: 'Общий', payment_types: [], items: [{ id: 'b', text: 'B' }] },
    ],
  };
  assert.equal(pickTemplate({ payment_type: 'barter' }, settings).id, 'any');
});

// ─── Настройки ───────────────────────────────────────────────────────────────

test('пустые настройки = дефолты', () => {
  const s = normalizeIntakeSettings(null);
  assert.equal(s.templates.length, 2);
  assert.equal(s.photo_slots.length, DEFAULT_PHOTO_SLOTS.length);
  assert.equal(s.require_photos, true);
  assert.equal(s.require_mileage, true);
});

test('битый раздел настроек откатывается к дефолту целиком', () => {
  const s = normalizeIntakeSettings({ photo_slots: [{ label: 'без id' }, null, 42] });
  assert.equal(s.photo_slots.length, DEFAULT_PHOTO_SLOTS.length, 'иначе правило «без фото не закрыть» тихо отключилось бы');
});

test('шаблон без пунктов отбрасывается, оставшиеся сохраняются', () => {
  const s = normalizeIntakeSettings({
    templates: [
      { id: 'empty', label: 'Пустой', items: [] },
      { id: 'ok', label: 'Рабочий', items: [{ id: 'a', text: 'Проверить' }] },
    ],
  });
  assert.deepEqual(s.templates.map((t) => t.id), ['ok']);
  assert.equal(s.templates[0].items[0].required, true, 'пункт без флага считается обязательным');
});

test('все шаблоны негодные → возвращаются дефолтные', () => {
  const s = normalizeIntakeSettings({ templates: [{ id: 'x', label: 'X', items: [] }] });
  assert.deepEqual(s.templates.map((t) => t.id), ['insurance', 'client']);
});

test('пороги светофора чистятся от мусора', () => {
  const s = normalizeIntakeSettings({ warn_days: -5, alert_days: 'ага' });
  assert.equal(s.warn_days, 0);
  assert.equal(s.alert_days, 2);
});

// ─── Фото ────────────────────────────────────────────────────────────────────

test('фото приёмки отделяются от фото «до/после» по категории', () => {
  const job = {
    photos: [
      { id: '1', category: 'before' },
      { id: '2', category: 'after' },
      { id: '3', category: photoCategory('vin') },
      { id: '4', category: photoCategory('vin') },
      { id: '5' },                                   // старое фото без категории
    ],
  };
  const bySlot = intakePhotosBySlot(job);
  assert.deepEqual(Object.keys(bySlot), ['vin']);
  assert.equal(bySlot.vin.length, 2);
});

test('photoSlotId разбирает только свои категории', () => {
  assert.equal(photoSlotId('intake:vin'), 'vin');
  assert.equal(photoSlotId('before'), null);
  assert.equal(photoSlotId(undefined), null);
});

// ─── Повреждения ─────────────────────────────────────────────────────────────

test('повреждения в акте идут в порядке справочника зон, а не кликов', () => {
  const intake = readIntake({
    intake: {
      damages: [
        { id: 'd1', zone: 'trunk', kind: 'dent' },
        { id: 'd2', zone: 'hood', kind: 'scratch', note: 'по всей длине' },
      ],
    },
  });
  const rows = damageRows(intake, DEFAULT_INTAKE_SETTINGS.damage_zones);
  assert.deepEqual(rows.map((r) => r.zone), ['Капот', 'Крышка багажника']);
  assert.equal(rows[0].kind, 'Царапина');
  assert.equal(rows[0].note, 'по всей длине');
});

test('повреждение без характера получает «Царапина» по умолчанию', () => {
  const intake = readIntake({ intake: { damages: [{ zone: 'roof' }] } });
  assert.equal(intake.damages[0].kind, 'scratch');
  assert.equal(intake.damages[0].id, 'roof', 'id подставляется из зоны');
});

test('мусор в списке повреждений выбрасывается', () => {
  const intake = readIntake({ intake: { damages: [null, {}, { zone: '' }, { zone: 'hood' }] } });
  assert.equal(intake.damages.length, 1);
});

test('зоны группируются в порядке первого появления', () => {
  const groups = groupZones(DEFAULT_INTAKE_SETTINGS.damage_zones);
  assert.deepEqual(groups.map((g) => g.group), ['Перед', 'Левый борт', 'Правый борт', 'Зад', 'Прочее']);
});

// ─── Список машин ────────────────────────────────────────────────────────────

test('список: сортировка по срочности, счётчики, дни стояния', () => {
  const jobs = [
    readyJob({ id: 'ready', created_at: daysAgo(0) }),                                    // 0 дней → 🟢
    { id: 'stale', phase: 'approval', approval_status: 'inspection', car_model: 'Kia Rio', created_at: daysAgo(5) },
    { id: 'warn', phase: 'approval', approval_status: 'inspection', car_model: 'Lada', created_at: daysAgo(1) },
    { id: 'other', phase: 'approval', approval_status: 'calc', car_model: 'BMW' },        // не «Осмотр» — мимо
    { id: 'repair', phase: 'repair', car_model: 'Audi' },                                 // в ремонте — мимо
  ];
  const { rows, counts } = buildIntakeList(jobs, DEFAULT_INTAKE_SETTINGS, { nowMs: NOW });
  assert.deepEqual(rows.map((r) => r.id), ['stale', 'warn', 'ready'], 'сначала те, кто дольше стоит без приёмки');
  assert.equal(rows[0].daysWaiting, 5);
  assert.equal(rows[0].severity, 'alert');
  assert.equal(rows[1].severity, 'warn');
  assert.equal(rows[2].severity, 'ok');
  assert.equal(counts.total, 3);
  assert.equal(counts.ready, 1);
  assert.equal(counts.alert, 1);
});

test('список: поиск по номеру, модели и клиенту', () => {
  const jobs = [readyJob(), { id: 'j2', phase: 'approval', approval_status: 'inspection', car_model: 'Kia Rio' }];
  const byPlate = buildIntakeList(jobs, DEFAULT_INTAKE_SETTINGS, { query: 'а123', nowMs: NOW });
  assert.deepEqual(byPlate.rows.map((r) => r.id), ['j1']);
  const byClient = buildIntakeList(jobs, DEFAULT_INTAKE_SETTINGS, { query: 'иванов', nowMs: NOW });
  assert.deepEqual(byClient.rows.map((r) => r.id), ['j1']);
  const byModel = buildIntakeList(jobs, DEFAULT_INTAKE_SETTINGS, { query: 'kia', nowMs: NOW });
  assert.deepEqual(byModel.rows.map((r) => r.id), ['j2']);
});

test('список: закрытая приёмка перестаёт быть срочной', () => {
  const jobs = [readyJob({ id: 'closed', created_at: daysAgo(9), intake: { status: 'done' } })];
  const { rows, counts } = buildIntakeList(jobs, DEFAULT_INTAKE_SETTINGS, { nowMs: NOW });
  assert.equal(rows[0].severity, 'done');
  assert.equal(counts.alert, 0);
  assert.equal(counts.done, 1);
});

// ─── Печатный акт ────────────────────────────────────────────────────────────

test('снимок акта замораживает состояние машины', () => {
  const job = readyJob({
    vin: 'XW8ZZZ61ZJG000123',
    client_phone: '+7 999 000-11-22',
    insurer_name: 'Ингосстрах',
    claim_number: 'У-123/26',
    intake: {
      mileage: '124500', fuel: 'half', keys: '2',
      docs: ['sts', 'policy'],
      equipment: ['jack', 'spare'],
      damages: [{ zone: 'hood', kind: 'dent', note: 'слева' }],
      notes: 'Машина не на ходу',
      act_number: 'ПР-2026-0007',
      act_date: NOW,
    },
  });
  const snap = buildIntakeActSnapshot(job, DEFAULT_INTAKE_SETTINGS, { name: 'Авто Академия' }, { acceptedBy: 'Петров С.' });

  assert.equal(snap.doc_number, 'ПР-2026-0007');
  // Дата — местная, в формате formatDocDate ('ГГГГ-ММ-ДД'), а не UTC-слепок:
  // ночная приёмка по Красноярску не должна печататься вчерашним числом.
  assert.equal(snap.doc_date, '2026-07-28');
  assert.equal(snap.accepted_by, 'Петров С.');
  assert.equal(snap.company.name, 'Авто Академия');
  assert.equal(snap.customer.name, 'Иванов П.');
  assert.equal(snap.vehicle.vin, 'XW8ZZZ61ZJG000123');
  assert.equal(snap.insurance.claim_number, 'У-123/26');
  assert.equal(snap.condition.mileage, '124500');
  assert.equal(snap.condition.fuel_label, '½');
  assert.equal(snap.notes, 'Машина не на ходу');
  assert.equal(snap.photos_count, 7);

  // Комплектность и документы печатаются ПОЛНЫМ списком с отметкой «есть/нет» —
  // «запаски не было» защищает не хуже, чем «запаска была».
  assert.equal(snap.docs.length, DEFAULT_INTAKE_SETTINGS.docs.length);
  assert.deepEqual(snap.docs.filter((d) => d.present).map((d) => d.label), ['СТС', 'Полис (ОСАГО/КАСКО)']);
  assert.equal(snap.equipment.filter((e) => e.present).length, 2);
  assert.deepEqual(snap.damages, [{ zone: 'Капот', kind: 'Вмятина', note: 'слева' }]);
});

test('акт печатается даже с поздним временем — дата остаётся местной', () => {
  // 23:40 по местному времени: UTC-слепок дал бы предыдущий день в UTC+7.
  const late = new Date('2026-07-28T23:40:00').getTime();
  const snap = buildIntakeActSnapshot({}, null, null, { docDate: late });
  assert.equal(snap.doc_date, '2026-07-28');
});

test('снимок акта у нетронутой машины не падает', () => {
  const snap = buildIntakeActSnapshot({ car_model: 'Kia Rio' }, null, null);
  assert.equal(snap.doc_number, '');
  assert.equal(snap.doc_date, '', 'нет даты → formatDocDate напечатает прочерк');
  assert.equal(snap.vehicle.car_model, 'Kia Rio');
  assert.equal(snap.condition.fuel_label, '—');
  assert.deepEqual(snap.damages, []);
  assert.equal(snap.photos_count, 0);
});

// ===== Пробег: одно число на машину =====
// Пробег, вписанный на экране приёмки, api.jobs.saveIntake кладёт и в карточку;
// обратный ход — здесь: пока приёмщик не вписал свой, показываем пробег карточки
// (мог прийти из Audatex или из документа), чтобы экран, акт приёмки и акт
// приёма-передачи не расходились.
test('пробег из карточки подставляется в приёмку, пока свой не вписан', () => {
  assert.equal(readIntake({ mileage: '84000', intake: { status: 'open' } }).mileage, '84000');
  assert.equal(readIntake({ mileage: '84000' }).mileage, '84000', 'машина без приёмки вообще');
  // Вписанное на экране приёмки сильнее карточки.
  assert.equal(readIntake({ mileage: '84000', intake: { mileage: '124500' } }).mileage, '124500');
  assert.equal(readIntake({}).mileage, '');
});

test('пробег в карточке снимает блокировку «Пробег» на закрытии приёмки', () => {
  const job = readyJob({ mileage: '84000', intake: { status: 'open', mileage: '', fuel: 'half', keys: '2', checked: allChecked() } });
  const st = intakeStatus(job, DEFAULT_INTAKE_SETTINGS);
  assert.deepEqual(st.fieldsMissing, []);
  // И в печатный акт приёмки попадает то же число.
  assert.equal(buildIntakeActSnapshot(job, DEFAULT_INTAKE_SETTINGS, {}).condition.mileage, '84000');
});
