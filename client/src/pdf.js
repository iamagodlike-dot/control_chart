import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import dayjs from 'dayjs';
import { numberToWordsRu } from './rubleWords';

const MARGIN = 15;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FONT = 'Roboto';

let fontCachePromise = null;

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function loadFonts() {
  if (!fontCachePromise) {
    fontCachePromise = Promise.all([
      fetch('/fonts/Roboto-Regular.ttf').then((r) => r.arrayBuffer()).then(arrayBufferToBase64),
      fetch('/fonts/Roboto-Bold.ttf').then((r) => r.arrayBuffer()).then(arrayBufferToBase64),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }
  return fontCachePromise;
}

async function createDoc() {
  const fonts = await loadFonts();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.addFileToVFS('Roboto-Regular.ttf', fonts.regular);
  doc.addFont('Roboto-Regular.ttf', FONT, 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', fonts.bold);
  doc.addFont('Roboto-Bold.ttf', FONT, 'bold');
  doc.setFont(FONT, 'normal');
  return doc;
}

function money(v) {
  const n = Number(v) || 0;
  return `${n.toLocaleString('ru-RU')} ₽`;
}

function ensureSpace(doc, y, needed) {
  if (y + needed > PAGE_HEIGHT - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function drawHeader(doc, company, title, docNumber, dateStr) {
  let y = MARGIN;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(11);
  doc.text(`Исполнитель: ${company.name || '—'}`, MARGIN, y);
  y += 5.5;

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  const lines = [];
  if (company.address) lines.push(`Адрес: ${company.address}`);
  const idBits = [];
  if (company.inn) idBits.push(`ИНН ${company.inn}`);
  if (company.ogrn) idBits.push(`ОГРН ${company.ogrn}`);
  if (idBits.length) lines.push(idBits.join(', '));
  if (company.phone) lines.push(`Тел.: ${company.phone}`);
  for (const line of lines) {
    doc.text(line, MARGIN, y);
    y += 4.2;
  }

  y += 5;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(14);
  doc.text(`${title} № ${docNumber} от ${dateStr}`, PAGE_WIDTH / 2, y, { align: 'center' });
  y += 9;
  return y;
}

function drawVehicleInfo(doc, job, y) {
  const vehicleBits = [
    `Марка и модель ТС: ${job.car_model || '—'}`,
    `гос. номер: ${job.plate_number || '—'}`,
  ];
  if (job.vin) vehicleBits.push(`VIN: ${job.vin}`);
  if (job.year) vehicleBits.push(`год: ${job.year}`);
  if (job.mileage) vehicleBits.push(`пробег: ${job.mileage} км`);

  const stages = job.stages || [];
  const starts = stages.map((s) => s.start_at).filter(Boolean).sort();
  const ends = stages.map((s) => s.end_at).filter(Boolean).sort();
  const startStr = starts.length ? dayjs(starts[0]).format('DD.MM.YYYY HH:mm') : '—';
  const endStr = ends.length ? dayjs(ends[ends.length - 1]).format('DD.MM.YYYY HH:mm') : '—';

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'grid',
    styles: { font: FONT, fontSize: 9, cellPadding: 2.2, lineColor: [60, 60, 60], textColor: [20, 20, 20] },
    body: [
      [`Заказчик: ${job.client_name || '—'}`, `Телефон: ${job.client_phone || '—'}`],
      [{ content: vehicleBits.join(', '), colSpan: 2 }],
      [{ content: `Дата-время начала работ: ${startStr}`, colSpan: 2 }],
      [{ content: `Дата-время окончания работ: ${endStr}`, colSpan: 2 }],
    ],
  });
  return doc.lastAutoTable.finalY + 6;
}

function drawTextBlock(doc, label, text, y) {
  if (!text) return y;
  y = ensureSpace(doc, y, 10);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(10);
  doc.text(label, MARGIN, y);
  y += 5;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9.5);
  const wrapped = doc.splitTextToSize(text, CONTENT_WIDTH);
  for (const line of wrapped) {
    y = ensureSpace(doc, y, 5);
    doc.text(line, MARGIN, y);
    y += 4.5;
  }
  return y + 2;
}

function servicesTable(doc, services, y) {
  if (!services.length) return y;
  y = ensureSpace(doc, y, 14);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(11);
  doc.text('Наименования работ', MARGIN, y);
  y += 4;
  const total = services.reduce((sum, s) => sum + (Number(s.qty) || 0) * (Number(s.price) || 0), 0);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'grid',
    styles: { font: FONT, fontSize: 9, cellPadding: 2 },
    headStyles: { font: FONT, fontStyle: 'bold', fillColor: [238, 238, 238], textColor: [20, 20, 20] },
    foot: [[{ content: `Итого работ: ${services.length} на сумму: ${money(total)}`, colSpan: 5 }]],
    footStyles: { font: FONT, fontStyle: 'bold', fillColor: [255, 255, 255], textColor: [20, 20, 20], halign: 'right' },
    head: [['#', 'Наименование', 'Исполнитель', 'Кол-во', 'Цена', 'Сумма']],
    body: services.map((s, i) => [
      i + 1,
      s.name || '',
      s.executor || '—',
      String(s.qty ?? 1),
      money(s.price),
      money((Number(s.qty) || 0) * (Number(s.price) || 0)),
    ]),
  });
  return doc.lastAutoTable.finalY + 6;
}

function partsTable(doc, parts, y) {
  if (!parts.length) return y;
  y = ensureSpace(doc, y, 14);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(11);
  doc.text('Расходные материалы', MARGIN, y);
  y += 4;
  const total = parts.reduce((sum, p) => sum + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'grid',
    styles: { font: FONT, fontSize: 9, cellPadding: 2 },
    headStyles: { font: FONT, fontStyle: 'bold', fillColor: [238, 238, 238], textColor: [20, 20, 20] },
    foot: [[{ content: `Итого материалов: ${parts.length} на сумму: ${money(total)}`, colSpan: 6 }]],
    footStyles: { font: FONT, fontStyle: 'bold', fillColor: [255, 255, 255], textColor: [20, 20, 20], halign: 'right' },
    head: [['#', 'Код', 'Наименование', 'Кол-во', 'Ед.изм.', 'Цена', 'Сумма']],
    body: parts.map((p, i) => [
      i + 1,
      p.code || '',
      p.name || '',
      String(p.qty ?? 1),
      p.unit || 'шт.',
      money(p.price),
      money((Number(p.qty) || 0) * (Number(p.price) || 0)),
    ]),
  });
  return doc.lastAutoTable.finalY + 6;
}

function drawSignatures(doc, company, job, y) {
  y = ensureSpace(doc, y, 28);
  y += 14;
  const colWidth = CONTENT_WIDTH / 2 - 6;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setDrawColor(20, 20, 20);
  doc.line(MARGIN, y, MARGIN + colWidth, y);
  doc.line(MARGIN + colWidth + 12, y, MARGIN + colWidth * 2 + 12, y);
  y += 4;
  doc.text(`${company.director || 'Исполнитель'} / подпись`, MARGIN, y);
  doc.text(`${job.client_name || 'Заказчик'} / подпись`, MARGIN + colWidth + 12, y);
  return y;
}

function servicesTotal(services) {
  return services.reduce((sum, s) => sum + (Number(s.qty) || 0) * (Number(s.price) || 0), 0);
}
function partsTotal(parts) {
  return parts.reduce((sum, p) => sum + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
}

export async function generateOrderPdf(job, company) {
  const doc = await createDoc();
  const services = job.services || [];
  const parts = job.parts || [];
  const docNumber = job.order_number || job.id.slice(0, 6).toUpperCase();
  const dateStr = dayjs().format('DD.MM.YYYY');

  let y = drawHeader(doc, company, 'Заказ-наряд', docNumber, dateStr);
  y = drawVehicleInfo(doc, job, y);
  y = drawTextBlock(doc, 'Причина обращения:', job.reason, y);
  y = servicesTable(doc, services, y);
  y = partsTable(doc, parts, y);
  y = drawTextBlock(doc, 'Рекомендации:', job.recommendations, y);

  const subtotal = servicesTotal(services) + partsTotal(parts);
  const discount = Number(job.discount) || 0;
  const total = Math.max(0, subtotal - discount);
  const prepayment = Number(job.prepayment) || 0;
  const due = Math.max(0, total - prepayment);

  y = ensureSpace(doc, y, 30);
  doc.setFont(FONT, 'normal');
  doc.setFontSize(10);
  if (discount > 0) {
    doc.text(`Скидка: ${money(discount)}`, PAGE_WIDTH - MARGIN, y, { align: 'right' });
    y += 5.5;
  }
  doc.setFont(FONT, 'bold');
  doc.text(`Итого по заказ-наряду: ${money(total)}`, PAGE_WIDTH - MARGIN, y, { align: 'right' });
  y += 7;

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9.5);
  y = ensureSpace(doc, y, 18);
  doc.text(`Всего по заказ-наряду: ${numberToWordsRu(total)}`, MARGIN, y);
  y += 5;
  doc.text(`Предоплата по заказ-наряду: ${money(prepayment)}`, MARGIN, y);
  y += 5;
  doc.text(`Доплата по заказ-наряду: ${money(due)}`, MARGIN, y);
  y += 4;

  drawSignatures(doc, company, job, y);
  doc.save(`zakaz-naryad-${docNumber}.pdf`);
}

export async function generateActPdf(job, company) {
  const doc = await createDoc();
  const services = job.services || [];
  const parts = job.parts || [];
  const docNumber = job.order_number || job.id.slice(0, 6).toUpperCase();
  const dateStr = dayjs().format('DD.MM.YYYY');

  let y = drawHeader(doc, company, 'Акт выполненных работ', docNumber, dateStr);
  y = drawVehicleInfo(doc, job, y);
  y = servicesTable(doc, services, y);
  y = partsTable(doc, parts, y);

  const total = servicesTotal(services) + partsTotal(parts);
  y = ensureSpace(doc, y, 24);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(11);
  doc.text(`Итого выполнено на сумму: ${money(total)}`, PAGE_WIDTH - MARGIN, y, { align: 'right' });
  y += 8;

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  const legal = 'Заказчик подтверждает, что работы выполнены в полном объёме, в срок и с надлежащим качеством. Заказчик претензий по объёму, качеству и срокам выполненных работ не имеет.';
  const wrapped = doc.splitTextToSize(legal, CONTENT_WIDTH);
  for (const line of wrapped) {
    y = ensureSpace(doc, y, 5);
    doc.text(line, MARGIN, y);
    y += 4.5;
  }

  drawSignatures(doc, company, job, y);
  doc.save(`akt-rabot-${docNumber}.pdf`);
}

export async function generateHandoverPdf(job, company) {
  const doc = await createDoc();
  const docNumber = job.order_number || job.id.slice(0, 6).toUpperCase();
  const dateStr = dayjs().format('DD.MM.YYYY');

  let y = drawHeader(doc, company, 'Акт приёма-передачи автомобиля', docNumber, dateStr);

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'grid',
    styles: { font: FONT, fontSize: 9, cellPadding: 2.2 },
    body: [
      [`Заказчик: ${job.client_name || '—'}`, `Телефон: ${job.client_phone || '—'}`],
      [{ content: `Марка и модель ТС: ${job.car_model || '—'}, гос. номер: ${job.plate_number || '—'}`, colSpan: 2 }],
    ],
  });
  y = doc.lastAutoTable.finalY + 8;

  doc.setFont(FONT, 'bold');
  doc.setFontSize(11);
  doc.text('При приёме на сервис', MARGIN, y);
  y += 6;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9.5);
  doc.text(`Пробег: ${job.mileage || '—'} км`, MARGIN, y);
  y += 5;
  doc.text(`Комплектация: ${job.equipment || '—'}`, MARGIN, y);
  y += 6;
  y = drawTextBlock(doc, 'Состояние / повреждения:', job.condition_in || '—', y);

  y = ensureSpace(doc, y, 20);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(11);
  doc.text('При выдаче клиенту', MARGIN, y);
  y += 6;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9.5);
  doc.text(`Пробег: ${job.mileage_out || '—'} км`, MARGIN, y);
  y += 6;
  y = drawTextBlock(doc, 'Состояние:', job.condition_out || '—', y);

  drawSignatures(doc, company, job, y);
  doc.save(`akt-priema-peredachi-${docNumber}.pdf`);
}
