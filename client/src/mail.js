// Письмо оценщику: тема, текст и список фотографий для архива.
//
// ОТПРАВКИ ИЗ СИСТЕМЫ ЗДЕСЬ НЕТ И НЕ БЫЛО СЛУЧАЙНО: хостинг режет исходящий SMTP
// (порты 25/465/587/2525 закрыты, проверено), поэтому письмо отправляют руками из
// Яндекс.Почты, а система готовит текст и архив с фото — см. photoZip.js и
// components/MailModal.jsx. Когда порт откроют, отправку допишем: заготовка письма
// (buildDraft) для неё уже готова.
//
// Модуль намеренно без зависимостей от React/Firebase — чтобы шаблон письма можно
// было прогнать тестами (mail.test.js) и чтобы формулировки правились в одном месте.
import {
  readIntake, damageRows, fuelLabel, intakePhotosBySlot, PHOTO_SLOTS, photoSlotId,
} from './intake.js';
import { policyTypeLabel, isInsurance } from './insurance.js';

// Шаблоны писем. Пока один — «На просчёт»; список нужен, чтобы следующие
// (согласование, счёт, письмо клиенту) добавлялись сюда, а не в интерфейс.
export const MAIL_TEMPLATES = [
  {
    id: 'calc',
    label: 'На просчёт',
    hint: 'Оценщику: данные машины, повреждения из дефектовки и фото',
  },
];

export const mailTemplate = (id) => MAIL_TEMPLATES.find((t) => t.id === id) || MAIL_TEMPLATES[0];

const str = (v) => (v == null ? '' : String(v).trim());
const arr = (v) => (Array.isArray(v) ? v : []);

// ─── Вложения ───────────────────────────────────────────────────────────────
export function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`;
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
  return `${n} Б`;
}

const slotLabel = (id) => (PHOTO_SLOTS.find((s) => s.id === id)?.label) || 'Фото';
const CATEGORY_LABEL = { before: 'До ремонта', after: 'После ремонта' };

// Фото машины как список для галочек в окне письма. Сначала снимки дефектовки
// (в порядке ракурсов осмотра — они и есть материал для просчёта), потом «до
// ремонта», в конце «после». По умолчанию отмечены первые две группы: оценщику
// нужна разбитая машина, а не отремонтированная.
//
// Имена файлов ВНУТРИ архива даёт photoZip.js — здесь только порядок и подписи.
export function mailPhotoOptions(job) {
  const bySlot = intakePhotosBySlot(job);
  const out = [];
  const push = (photo, group, label) => {
    if (!photo || !photo.path) return;                 // pending-снимок из офлайн-очереди ещё не на сервере
    out.push({
      path: photo.path,
      url: photo.url || photo.path,
      group,
      label,
      size: Number(photo.size) || 0,
      checked: group !== 'after',
    });
  };
  for (const slot of PHOTO_SLOTS) {
    for (const p of arr(bySlot[slot.id])) push(p, slot.id, slotLabel(slot.id));
  }
  for (const p of arr(job?.photos)) {
    if (photoSlotId(p?.category)) continue;            // уже добавлен выше
    // Фото приёмки запчастей (коробка на складе, привязана к позиции) — не про
    // машину и оценщику ни к чему. В письмо их даже не предлагаем.
    if (p?.category === 'receiving' || p?.partId) continue;
    const cat = p?.category === 'after' ? 'after' : 'before';
    push(p, cat, CATEGORY_LABEL[cat]);
  }
  // `id` строим от НОМЕРА в списке: id снимка в базе теоретически может
  // повториться (кривой импорт, ручная правка), а галочки и React-ключи требуют
  // строгой уникальности — иначе два фото ведут себя как одно.
  return out.map((p, i) => ({ ...p, id: `${i}:${p.path}` }));
}

// ─── Шаблон «На просчёт» ────────────────────────────────────────────────────
function vehicleLine(job) {
  const parts = [str(job?.car_model) || 'Автомобиль'];
  if (str(job?.year)) parts.push(`${str(job.year)} г.`);
  if (str(job?.color)) parts.push(str(job.color));
  return parts.join(', ');
}

function insuranceLine(job) {
  if (!isInsurance(job)) return '';
  const bits = [str(job?.insurer_name) || 'страховая не указана'];
  const policy = policyTypeLabel(str(job?.policy_type));
  if (policy) bits.push(policy);
  if (str(job?.claim_number)) bits.push(`убыток № ${str(job.claim_number)}`);
  return bits.join(' · ');
}

// Пробег: у дефектовки он свежее (мастер списал с панели при приёмке), поэтому
// приоритет ей; в карточке машины поле заполняют не всегда.
function mileageOf(job) {
  const intake = readIntake(job);
  const v = str(intake.mileage) || str(job?.mileage);
  if (!v) return '';
  return /км/i.test(v) ? v : `${v} км`;
}

/**
 * Черновик письма «На просчёт»: тема + текст. Всё, что подставилось, человек
 * потом правит руками в окне письма — это заготовка, а не финальный документ.
 */
export function buildCalcDraft(job, { company = {}, senderName = '', photoCount = 0 } = {}) {
  const plate = str(job?.plate_number);
  const claim = str(job?.claim_number);
  const subject = [
    `Просчёт: ${vehicleLine(job)}`,
    plate ? `(${plate})` : '',
  ].filter(Boolean).join(' ') + (claim ? `, убыток № ${claim}` : '');

  const intake = readIntake(job);
  const damages = damageRows(intake);
  const caseRows = damages.filter((d) => !d.isOld);
  const oldRows = damages.filter((d) => d.isOld);

  const L = [];
  L.push('Добрый день!');
  L.push('');
  L.push('Просим просчитать ремонт по автомобилю. Фотографии — во вложении.');
  L.push('');
  L.push(`Автомобиль: ${vehicleLine(job)}`);
  if (plate) L.push(`Гос. номер: ${plate}`);
  if (str(job?.vin)) L.push(`VIN: ${str(job.vin)}`);
  const km = mileageOf(job);
  if (km) L.push(`Пробег: ${km}`);
  if (str(intake.fuel)) L.push(`Топливо: ${fuelLabel(intake.fuel)}`);
  const ins = insuranceLine(job);
  if (ins) L.push(`Страховая: ${ins}`);
  if (str(job?.order_number)) L.push(`Наш заказ-наряд: № ${str(job.order_number)}`);

  L.push('');
  if (caseRows.length) {
    L.push('Повреждения по осмотру:');
    caseRows.forEach((d, i) => {
      L.push(`${i + 1}. ${d.zone} — ${d.kind}${d.note ? ` (${d.note})` : ''}`);
    });
  } else {
    L.push('Повреждения: см. фотографии (дефектовка ещё не заполнена).');
  }
  if (oldRows.length) {
    L.push('');
    L.push('Не по этому случаю (были до аварии):');
    oldRows.forEach((d) => L.push(`— ${d.zone} — ${d.kind}${d.note ? ` (${d.note})` : ''}`));
  }
  if (str(intake.notes)) {
    L.push('');
    L.push(`Примечание приёмщика: ${str(intake.notes)}`);
  }
  if (photoCount > 0) {
    L.push('');
    L.push(`Во вложении фото: ${photoCount}.`);
  }

  L.push('');
  L.push('Будем ждать расчёт. Если чего-то не хватает — напишите, дошлём.');
  L.push('');
  L.push('С уважением,');
  if (senderName) L.push(senderName);
  L.push(str(company.name) || 'Авто Академия');
  if (str(company.phone)) L.push(`тел. ${str(company.phone)}`);
  if (str(company.address)) L.push(str(company.address));

  return { subject, text: L.join('\n') };
}

// Единая точка входа: черновик по id шаблона. Пока шаблон один, но окно письма
// уже вызывает именно это — новый шаблон добавится здесь, а не в интерфейсе.
export function buildDraft(templateId, job, opts = {}) {
  return buildCalcDraft(job, opts);
}

// Строка для журнала машины: что именно выгрузили. Держим рядом с шаблонами,
// чтобы формулировка журнала не разъехалась с формулировкой письма.
export function exportLogText(entry = {}) {
  const tpl = mailTemplate(entry.template);
  const bits = [`Архив фото «${tpl.label}» скачан`];
  const n = Number(entry.photos) || 0;
  if (n) bits.push(`${n} фото`);
  return bits.join(' · ');
}
