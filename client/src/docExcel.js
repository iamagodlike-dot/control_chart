// Выгрузка документа машины (заказ-наряд / акт / счёт / акт приёма-передачи) в Excel.
//
// Зачем: печатный лист А4 хорош для клиента, но бухгалтеру и страховой нужен файл,
// в котором позиции можно отсортировать, дописать и посчитать. Поэтому лист собирается
// из ТОГО ЖЕ снапшота документа (см. orderDoc.js), что и печатная форма: что напечатано,
// то и в файле — никакого второго источника правды.
//
// Суммы кладём ЧИСЛАМИ с денежным форматом (а не строками «12 300 ₽»): иначе в Excel
// по колонке нельзя посчитать итог, и вся затея теряет смысл.
//
// Модуль ЧИСТЫЙ (кроме downloadDocExcel): buildDocSheet можно гонять в тестах без DOM.

import { computeDocTotals, formatDocDate, lineTotal } from './orderDoc.js';
import { policyTypeLabel } from './insurance.js';
import { downloadXlsx, colName } from './xlsx.js';

// Колонки листа общие для всех таблиц документа — чтобы работы и запчасти
// читались как один реестр: № · Наименование · Артикул · Кол-во · Ед. · Цена · Сумма
const COLS = [{ w: 5 }, { w: 46 }, { w: 18 }, { w: 9 }, { w: 8 }, { w: 15 }, { w: 15 }];
const LAST = colName(COLS.length - 1); // 'G'
const TABLE_HEAD = ['№', 'Наименование', 'Артикул', 'Кол-во', 'Ед.', 'Цена, ₽', 'Сумма, ₽'];

export const DOC_TITLE = {
  order: 'ЗАКАЗ-НАРЯД',
  act: 'АКТ ВЫПОЛНЕННЫХ РАБОТ',
  invoice: 'СЧЁТ НА ОПЛАТУ',
  handover: 'АКТ ПРИЁМА-ПЕРЕДАЧИ ТС',
};

// Короткое имя для названия файла и вкладки листа.
export const DOC_SHORT = {
  order: 'Заказ-наряд',
  act: 'Акт выполненных работ',
  invoice: 'Счёт на оплату',
  handover: 'Акт приёма-передачи',
};

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function str(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

// Заголовок акта приёма-передачи зависит от направления — как на печатном листе.
function handoverTitle(snapshot) {
  if (snapshot.direction === 'intake') return 'АКТ ПРИЁМА-ПЕРЕДАЧИ ТС (ПРИЁМ В РЕМОНТ)';
  if (snapshot.direction === 'issue') return 'АКТ ПРИЁМА-ПЕРЕДАЧИ ТС (ВЫДАЧА ИЗ РЕМОНТА)';
  return 'АКТ ПРИЁМА-ПЕРЕДАЧИ ТРАНСПОРТНОГО СРЕДСТВА';
}

// Мелкий сборщик листа: копит строки и объединения, считает номера строк сам.
function sheetBuilder() {
  const rows = [];
  const merges = [];
  const api = {
    rows,
    merges,
    // Возвращает 1-based номер добавленной строки — по нему строятся объединения.
    push(cells, h) {
      rows.push(h ? { cells, h } : cells);
      return rows.length;
    },
    blank() { return api.push([]); },
    wide(cells, from = 'A', to = LAST, h) {
      const r = api.push(cells, h);
      merges.push(`${from}${r}:${to}${r}`);
      return r;
    },
    title(text) { return api.wide([{ v: text, s: 'title' }], 'A', LAST, 24); },
    sect(text) { return api.wide([{ v: text, s: 'sect' }], 'A', LAST); },
    // Поле «подпись → значение»: подпись в колонке B, значение растянуто до конца.
    kv(k, v) {
      if (!str(v)) return 0;
      return api.wide([null, { v: k, s: 'label' }, { v: str(v) }], 'C', LAST);
    },
    // Длинный текст (гарантия, согласие) — с переносом и прикидкой высоты строки.
    text(t) {
      const s = str(t);
      if (!s) return 0;
      const lines = s.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 105)), 0);
      return api.wide([{ v: s, s: 'wrap' }], 'A', LAST, Math.min(260, lines * 14 + 4));
    },
    // Строка итога под таблицей: подпись справа (A:F), сумма в последней колонке.
    totalRow(label, value, bold = false) {
      const r = api.push([{ v: label, s: bold ? 'bold' : 'right' }, null, null, null, null, null, { v: num(value), s: 'total' }]);
      merges.push(`A${r}:F${r}`);
      return r;
    },
  };
  return api;
}

function addCompany(b, c) {
  const idBits = [c.inn && `ИНН ${c.inn}`, c.kpp && `КПП ${c.kpp}`, c.ogrn && `ОГРНИП ${c.ogrn}`].filter(Boolean).join(' · ');
  b.wide([{ v: str(c.name) || 'Авто Академия', s: 'bold' }]);
  if (idBits) b.wide([{ v: idBits, s: 'sub' }]);
  const contacts = [str(c.address), c.phone ? `тел. ${c.phone}` : ''].filter(Boolean).join(' · ');
  if (contacts) b.wide([{ v: contacts, s: 'sub' }]);
}

// Блок плательщика: тот же, что печатается в карточке «Заказчик».
function addInsurance(b, ins) {
  const i = ins || {};
  if (i.payment_type === 'legal') { b.kv('Оплата', 'Юридическое лицо'); return; }
  if (i.payment_type !== 'insurance') return;
  b.kv('Оплата', `Страховая${i.insurer_name ? ` — ${i.insurer_name}` : ''}`);
  b.kv('№ убытка', i.claim_number);
  b.kv('Тип полиса', policyTypeLabel(i.policy_type));
}

function addCustomer(b, snapshot) {
  const cust = snapshot.customer || {};
  b.sect('Заказчик');
  b.kv('ФИО / наименование', cust.name);
  b.kv('Телефон', cust.phone);
  addInsurance(b, snapshot.insurance);
}

function addVehicle(b, snapshot) {
  const v = snapshot.vehicle || {};
  b.sect('Транспортное средство');
  b.kv('Марка и модель', v.car_model);
  b.kv('Гос. номер', v.plate_number);
  b.kv('VIN', v.vin);
  b.kv('Год выпуска', v.year);
  b.kv('Пробег, км', v.mileage);
}

// Таблица позиций. `unitOf` — чем заполнять «Ед.» (у работ единицы нет).
function addItems(b, items, { unitOf, withCode }) {
  b.push(TABLE_HEAD.map((h) => ({ v: h, s: 'th' })));
  if (!items.length) {
    const r = b.push([{ v: '—', s: 'tdc' }, { v: 'Позиции не добавлены', s: 'td' }]);
    b.merges.push(`B${r}:${LAST}${r}`);
    return;
  }
  items.forEach((it, i) => {
    b.push([
      { v: i + 1, s: 'tdc' },
      { v: str(it.name), s: 'td' },
      { v: withCode ? str(it.code) : '', s: 'td' },
      { v: num(it.qty, 1), s: 'tdc' },
      { v: unitOf(it), s: 'tdc' },
      { v: num(it.price), s: 'money' },
      { v: num(lineTotal(it)), s: 'money' },
    ]);
  });
}

// Итоги — те же строки и в том же порядке, что в печатной форме (TotalsBox).
function addTotals(b, t, { showPrepayment = true, invoice = false } = {}) {
  b.blank();
  b.sect('Итоги');
  b.totalRow('Итого по работам', t.services_sum);
  b.totalRow('Итого по запчастям и материалам', t.parts_sum);
  if (t.discount > 0) b.totalRow(`Скидка${t.discount_mode === 'pct' ? ` ${t.discount_pct}%` : ''}`, -t.discount);
  b.totalRow('ИТОГО', t.total, true);
  if (invoice) b.totalRow(t.vat_mode === 'vat20' ? 'В том числе НДС 20%' : 'НДС', t.vat_mode === 'vat20' ? t.vat_amount : 0);
  if (t.franchise > 0) {
    b.totalRow('Франшиза (оплачивает клиент)', t.franchise);
    b.totalRow('Оплачивает страховая', t.insurer_pays);
  }
  if (invoice && t.franchise > 0) b.totalRow('К оплате по счёту', t.payable, true);
  if (showPrepayment && t.prepayment > 0) {
    b.totalRow('Предоплата', t.prepayment);
    b.totalRow('К доплате', invoice ? t.payable_due : t.due, true);
  }
  const words = str(t.total_words);
  if (words) b.wide([{ v: words, s: 'sub' }]);
}

function addTextBlock(b, title, text) {
  if (!str(text)) return;
  b.blank();
  if (str(title)) b.sect(title);
  b.text(text);
}

// Подписи — те же стороны, что на печатном листе (Signatures в DocSheet):
// у счёта справа расписывается бухгалтер ИСПОЛНИТЕЛЯ, а не заказчик.
function addSignatures(b, snapshot, leftTitle = 'Исполнитель', rightTitle = 'Заказчик') {
  const c = snapshot.company || {};
  const rightName = rightTitle === 'Бухгалтер' ? c.director : (snapshot.customer || {}).name;
  b.blank();
  b.sect('Подписи сторон');
  b.kv(leftTitle, `${str(c.director) || '—'}   _______________   М.П.`);
  b.kv(rightTitle, `${str(rightName) || '—'}   _______________`);
}

// ===== Лист документа =====
export function buildDocSheet(snapshot = {}) {
  const type = snapshot.type || 'order';
  const t = computeDocTotals(snapshot);
  const c = snapshot.company || {};
  const b = sheetBuilder();

  addCompany(b, c);
  b.blank();
  b.title(type === 'handover' ? handoverTitle(snapshot) : (DOC_TITLE[type] || 'ДОКУМЕНТ'));
  b.wide([{ v: `№ ${str(snapshot.doc_number) || '—'} от ${formatDocDate(snapshot.doc_date)}`, s: 'bold' }]);
  if (str(snapshot.order_ref)) b.wide([{ v: `Основание: заказ-наряд № ${str(snapshot.order_ref)}`, s: 'sub' }]);
  if (str(snapshot.planned_ready_at)) b.wide([{ v: `Плановая готовность: ${formatDocDate(snapshot.planned_ready_at)}`, s: 'sub' }]);
  b.blank();

  addCustomer(b, snapshot);
  b.blank();
  addVehicle(b, snapshot);

  if (type === 'invoice') {
    const bank = c.bank || {};
    b.blank();
    b.sect('Реквизиты для оплаты');
    b.kv('Получатель', [str(c.name), c.inn ? `ИНН ${c.inn}` : '', c.kpp ? `КПП ${c.kpp}` : ''].filter(Boolean).join(', '));
    b.kv('Банк получателя', bank.bank_name);
    b.kv('БИК', bank.bik);
    b.kv('Расчётный счёт (р/с)', bank.account);
    b.kv('Корр. счёт (к/с)', bank.corr_account);
  }

  if (type === 'handover') {
    const cond = snapshot.condition || {};
    if (snapshot.show_intake) {
      b.blank();
      b.sect('При приёме ТС');
      b.kv('Пробег при приёме, км', cond.mileage_in);
      b.kv('Комплектация', cond.equipment);
      b.kv('Повреждения / состояние', cond.condition_in);
    }
    if (snapshot.show_issue) {
      b.blank();
      b.sect('При выдаче ТС');
      b.kv('Пробег при выдаче, км', cond.mileage_out);
      b.kv('Состояние при выдаче', cond.condition_out);
    }
    addTextBlock(b, 'Текст акта', snapshot.show_handover_text ? snapshot.handover_text : '');
    addSignatures(
      b, snapshot,
      snapshot.direction === 'intake' ? 'Исполнитель (ТС принял)' : 'Исполнитель (ТС сдал)',
      snapshot.direction === 'intake' ? 'Заказчик (ТС сдал)' : 'Заказчик (ТС принял)',
    );
    return { name: DOC_SHORT[type], cols: COLS, rows: b.rows, merges: b.merges };
  }

  const services = snapshot.services || [];
  const parts = snapshot.parts || [];

  if (type === 'invoice') {
    // В счёте работы и запчасти идут одним списком «Товар (работы, услуги)» —
    // как на печатном листе и как ждёт бухгалтерия.
    b.blank();
    b.sect('Товар (работы, услуги)');
    addItems(b, [...services.map((s) => ({ ...s, unit: 'усл.' })), ...parts], {
      unitOf: (it) => str(it.unit) || 'шт.',
      withCode: true,
    });
  } else {
    if (str(snapshot.reason)) addTextBlock(b, 'Причина обращения', snapshot.reason);
    b.blank();
    b.sect('Перечень работ (услуг)');
    addItems(b, services, { unitOf: () => 'усл.', withCode: false });
    b.totalRow('Итого по работам', t.services_sum, true);
    b.blank();
    b.sect('Запчасти и материалы');
    addItems(b, parts, { unitOf: (it) => str(it.unit) || 'шт.', withCode: true });
    b.totalRow('Итого по запчастям и материалам', t.parts_sum, true);
  }

  addTotals(b, t, { invoice: type === 'invoice' });

  if (type === 'order') {
    addTextBlock(b, 'Рекомендации', snapshot.show_recommendations ? snapshot.recommendations : '');
    addTextBlock(b, 'Согласование по запчастям', snapshot.show_parts_consent ? snapshot.parts_consent_text : '');
    addTextBlock(b, 'Гарантия', snapshot.show_warranty ? snapshot.warranty_text : '');
    addTextBlock(b, 'Согласие заказчика', snapshot.show_consent ? snapshot.consent_text : '');
  }
  if (type === 'act') {
    addTextBlock(b, 'Рекомендации', snapshot.show_recommendations ? snapshot.recommendations : '');
    addTextBlock(b, 'Согласование по запчастям', snapshot.show_parts_consent ? snapshot.parts_consent_text : '');
    addTextBlock(b, '', snapshot.show_act_text ? snapshot.act_text : '');
    addTextBlock(b, 'Гарантия', snapshot.show_warranty ? snapshot.warranty_text : '');
  }
  if (type === 'invoice') {
    addTextBlock(b, 'Примечание об оплате', snapshot.show_invoice_note ? snapshot.invoice_note : '');
  }

  addSignatures(
    b, snapshot,
    type === 'invoice' ? 'Руководитель' : 'Исполнитель',
    type === 'invoice' ? 'Бухгалтер' : 'Заказчик',
  );

  return { name: DOC_SHORT[type] || 'Документ', cols: COLS, rows: b.rows, merges: b.merges };
}

// Имя файла: «Счёт на оплату СЧ-2026-0042 Х123УС124». Гос. номер в имени —
// чтобы в папке «Загрузки» было видно, чья это машина, без открытия файла.
export function docExcelFileName(snapshot = {}) {
  const bits = [
    DOC_SHORT[snapshot.type || 'order'] || 'Документ',
    str(snapshot.doc_number),
    str((snapshot.vehicle || {}).plate_number),
  ].filter(Boolean);
  return bits.join(' ');
}

// Скачать документ как .xlsx (браузер).
export function downloadDocExcel(snapshot = {}) {
  downloadXlsx([buildDocSheet(snapshot)], docExcelFileName(snapshot));
}
