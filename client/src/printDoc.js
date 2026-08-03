// Ужимает лист документа (заказ-наряд / акт / счёт / приём-передача) под ОДНУ
// страницу A4 при печати.
//
// Зачем: «обвязка» документа — шапка, карточки заказчика и авто, блок итогов,
// юридические абзацы и подписи — сама по себе занимает почти весь лист. Без
// масштабирования даже небольшой заказ разрывается на две страницы, и подписи
// уезжают на пустую вторую. Здесь мы измеряем реальную высоту листа в геометрии
// печати и подбираем zoom так, чтобы всё поместилось на один лист —
// пропорционально (ничего не «плющится»), до разумного предела читаемости.
//
// Механика: печать рисует скрытый узел #zn-print-mount, а @media print в
// orderDoc.css применяет к листу `zoom: var(--print-scale, 1)`. Мы лишь считаем
// нужный масштаб и выставляем эту переменную перед window.print().

const PX_PER_MM = 96 / 25.4;
const PRINT_W_MM = 186; // A4 210мм − 2×12мм поля @page (ширина листа в геометрии печати)
const PRINT_PAD_MM = 3; // горизонтальный «гаттер» листа при печати (см. orderDoc.css @media print)
const PRINT_H_MM = 273; // A4 297мм − 2×12мм поля @page
const MIN_SCALE = 0.55; // ниже — уже совсем мелко; такой большой заказ печатаем на 2+ стр.

// Меряем лист офскрин в ТОЧНОЙ геометрии печати (ширина 186мм с гаттером 3мм ⇒
// контент 180мм, без вертикальных полей листа и без тени) и возвращаем масштаб,
// при котором он влезает в одну страницу. Ширину контента держим равной печатной,
// иначе строки перенесутся иначе и замер высоты «соврёт».
function computeScale(sheet) {
  const mount = sheet.closest('#zn-print-mount');
  const savedSheet = sheet.getAttribute('style') || '';
  const savedMount = mount ? mount.getAttribute('style') || '' : '';

  if (mount) mount.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;visibility:hidden;';
  sheet.style.cssText = `${savedSheet};width:${PRINT_W_MM}mm;min-height:0;padding:0 ${PRINT_PAD_MM}mm;box-shadow:none;zoom:1;`;

  const naturalMm = sheet.getBoundingClientRect().height / PX_PER_MM;

  // Возвращаем исходные стили — на экране ничего не должно измениться.
  sheet.setAttribute('style', savedSheet);
  if (mount) mount.setAttribute('style', savedMount);

  if (!naturalMm || naturalMm <= PRINT_H_MM) return 1;
  return Math.max(MIN_SCALE, PRINT_H_MM / naturalMm);
}

// Подгоняет масштаб под одну страницу и запускает печать.
//
// Листов в монтаже может быть НЕСКОЛЬКО (наряд-задание печатается по листу на
// мастера) — меряем и масштабируем каждый отдельно: zoom наследуется только внутрь
// своего элемента, поэтому одна общая переменная ужала бы лишь первый лист.
export function printFitted(mountId = 'zn-print-mount') {
  const mount = document.getElementById(mountId);
  const sheets = mount ? [...mount.querySelectorAll('.zn-sheet')] : [];
  if (!sheets.length) { window.print(); return; }

  for (const sheet of sheets) {
    let scale;
    try { scale = computeScale(sheet); } catch { scale = 1; }
    sheet.style.setProperty('--print-scale', String(scale));
  }

  const cleanup = () => {
    for (const sheet of sheets) sheet.style.removeProperty('--print-scale');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  // Подстраховка: не все браузеры шлют afterprint надёжно.
  setTimeout(cleanup, 1500);
}
