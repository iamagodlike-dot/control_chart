import { useEffect, useState } from 'react';

// Автопроверка обновлений приложения. Проблема: SPA грузится один раз, и после
// деплоя открытые вкладки продолжают крутить СТАРЫЙ код, пока их не перезагрузят
// вручную — «починили, а у меня по-старому». Решение: у боевой сборки имя JS-файла
// содержит хэш содержимого (assets/index-XXXX.js) и меняется с каждым деплоем.
// Периодически (и при возврате во вкладку) перечитываем index.html (он no-cache)
// и сравниваем имя бандла с тем, что крутится сейчас. Разошлись → вышло обновление.
//
// Обычный режим: плашка «Вышло обновление» с кнопкой. auto (ТВ в цехе): тихая
// перезагрузка через пару секунд — по настенному экрану никто не кликает.
// На dev-сервере хэшированного бандла нет → проверка сама отключается.

// Не привязываемся к имени entry-файла (index-/main-…): сравниваем src ПЕРВОГО
// module-скрипта страницы с тем, что лежит в свежем index.html. Хэш в имени
// меняется с каждым деплоем — этого достаточно.
const HTML_BUNDLE_RE = /src="(\/assets\/[^"]+\.js)"/;
const CHECK_EVERY_MS = 5 * 60 * 1000; // + мгновенная проверка при возврате во вкладку

function runningBundle() {
  const s = document.querySelector('script[type="module"][src*="/assets/"]');
  return s ? s.getAttribute('src') : null;
}

export default function UpdateNotice({ auto = false }) {
  const [fresh, setFresh] = useState(null);     // имя нового бандла, если вышло обновление
  const [dismissed, setDismissed] = useState(null); // «скрыть» — до следующего обновления

  useEffect(() => {
    const mine = runningBundle();
    if (!mine) return undefined; // dev-сервер — без проверки
    let stopped = false;

    async function check() {
      try {
        const res = await fetch('/index.html', { cache: 'no-store' });
        if (!res.ok) return;
        const m = (await res.text()).match(HTML_BUNDLE_RE);
        if (!stopped && m && m[1] !== mine) setFresh(m[1]);
      } catch { /* офлайн — молча попробуем в следующий раз */ }
    }

    const onWake = () => { if (document.visibilityState === 'visible') check(); };
    const id = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    check();
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, []);

  // ТВ-режим: перезагружаемся сами. После reload текущий бандл станет новым,
  // повторного срабатывания не будет.
  useEffect(() => {
    if (!auto || !fresh) return undefined;
    const t = setTimeout(() => window.location.reload(), 4000);
    return () => clearTimeout(t);
  }, [auto, fresh]);

  if (auto || !fresh || fresh === dismissed) return null;
  return (
    <div className="update-notice" role="status">
      <span className="update-notice-text">Вышло обновление приложения</span>
      <button className="primary small" onClick={() => window.location.reload()}>Обновить</button>
      <button className="small update-notice-x" aria-label="Скрыть до следующего обновления" title="Скрыть" onClick={() => setDismissed(fresh)}>×</button>
    </div>
  );
}
