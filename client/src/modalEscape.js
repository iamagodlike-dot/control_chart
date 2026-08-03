import { useEffect, useRef } from 'react';

// Закрытие окон клавишей Escape — общее на всё приложение.
//
// ЗАЧЕМ ВООБЩЕ. Раньше окна закрывались кликом по тёмному фону. На телефоне это
// оказалось ловушкой: нативный выпадающий список рисует система ПОВЕРХ страницы,
// и при его закрытии странице достаётся «сквозной» клик по тому месту, где стоял
// палец. Он приходил на фон — и окно с наполовину заполненной формой схлопывалось
// (поймано на дефектовке, см. InspectionWizard). Клик по фону убран везде, где
// есть что терять; вместо него — крестик и Escape.
//
// ПОЧЕМУ ОДИН СЛУШАТЕЛЬ НА ВСЕХ, А НЕ ПО ОБРАБОТЧИКУ В КАЖДОМ ОКНЕ. Окна
// вкладываются друг в друга (карточка машины → документы → просмотр фото), а
// слушатели `keydown` на document срабатывают ВСЕ. Одно нажатие закрывало бы всю
// стопку разом. Здесь слушатель один, и он будит только верхнее окно.
//
// ПОЧЕМУ «ВЕРХНЕЕ» СЧИТАЕТСЯ ПО ГЛУБИНЕ В DOM, А НЕ ПО ПОРЯДКУ ОТКРЫТИЯ. React
// запускает эффекты снизу вверх — сначала дети, — поэтому порядок подписки врёт,
// если родитель появляется сразу с открытым ребёнком. Вложенное окно всегда лежит
// ВНУТРИ фона родителя, и глубина не врёт никогда.
//
// Исключение — попапы в портале body (календарь DateTimeField): визуально они
// поверх окна, а по глубине проигрывают, потому что живут прямо в <body>. Для них
// есть `level`: сначала сравниваем его, и только потом глубину.

const open = new Set();

export function domDepth(el) {
  let d = 0;
  for (let n = el; n; n = n.parentElement) d += 1;
  return d;
}

// Кого будит Escape. Вынесено отдельной чистой функцией: логика «кто сверху» —
// самое хрупкое место, а так её видно и можно проверить на простых объектах.
export function topmost(items) {
  let top = null;
  let bestLevel = -1;
  let bestDepth = -1;
  for (const it of items) {
    if (!it || !it.el) continue;
    const level = it.level || 0;
    const depth = domDepth(it.el);
    if (level > bestLevel || (level === bestLevel && depth > bestDepth)) {
      top = it;
      bestLevel = level;
      bestDepth = depth;
    }
  }
  return top;
}

function onKey(e) {
  if (e.key !== 'Escape' || !open.size) return;
  const top = topmost([...open].map((it) => ({ ...it, el: it.ref.current })));
  if (top) top.close();
}

function register(entry) {
  if (!open.size) document.addEventListener('keydown', onKey);
  open.add(entry);
  return () => {
    open.delete(entry);
    if (!open.size) document.removeEventListener('keydown', onKey);
  };
}

// Возвращает ref, который надо повесить на КОРНЕВОЙ элемент окна (тёмный фон):
// по нему считается вложенность. `active` — для окон, которые всегда
// отрисованы и лишь иногда видимы (просмотр фото).
export function useModalEscape(onClose, active = true, level = 0) {
  const ref = useRef(null);
  const fn = useRef(onClose);
  // Обработчик держим в ref: у большинства окон onClose — стрелка, созданная
  // заново на каждый рендер, и подписка иначе пересоздавалась бы вхолостую.
  useEffect(() => { fn.current = onClose; });
  useEffect(() => {
    if (!active) return undefined;
    return register({ ref, level, close: () => fn.current?.() });
  }, [active, level]);
  return ref;
}
