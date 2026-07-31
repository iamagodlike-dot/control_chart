/* eslint-disable react-refresh/only-export-components */
// Демо плашки «Вышло обновление» — БЕЗ Firebase и без ожидания реального деплоя.
// Рисуется тот же <UpdateCard>, что показывает боевой UpdateNotice, поэтому
// правки в App.css видно здесь один в один.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UpdateCard } from '../components/UpdateNotice';
import Logo from '../components/Logo';
import '../App.css';

function Demo() {
  const [theme, setTheme] = useState('dark');
  const [shown, setShown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [seq, setSeq] = useState(0); // перемонтирует карточку, чтобы проиграть появление

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  function replay() {
    setBusy(false);
    setShown(false);
    setTimeout(() => { setSeq((n) => n + 1); setShown(true); }, 60);
  }

  return (
    <div className="app" style={{ background: 'var(--color-bg)' }}>
      <header className="app-header">
        <div className="app-brand">
          <Logo size={38} />
          <div className="app-brand-text">
            <span className="app-brand-title">Авто Академия</span>
            <span className="app-brand-subtitle">Кузовной ремонт — диспетчерская</span>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div style={{ maxWidth: 620, margin: '0 auto', paddingTop: 48 }}>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: 0 }}>Демо</p>
          <h2 style={{ color: 'var(--color-text)', fontSize: 28, margin: '6px 0 10px' }}>
            Плашка «Вышло обновление»
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1.6, margin: '0 0 26px' }}>
            Так она появится в правом нижнем углу у всех, кто держит приложение
            открытым, когда на сервер выкатят новую версию. Кнопки ниже — только
            для просмотра, в приложении их нет.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={replay} style={{ fontSize: 13, padding: '9px 15px', borderRadius: 9, cursor: 'pointer' }}>
              показать заново
            </button>
            <button onClick={() => setBusy((b) => !b)} style={{ fontSize: 13, padding: '9px 15px', borderRadius: 9, cursor: 'pointer' }}>
              {busy ? 'обычный вид' : 'вид после нажатия «Обновить»'}
            </button>
            <button
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              style={{ fontSize: 13, padding: '9px 15px', borderRadius: 9, cursor: 'pointer' }}
            >
              {theme === 'dark' ? 'светлая тема' : 'тёмная тема'}
            </button>
          </div>
        </div>
      </main>

      {shown && (
        <UpdateCard
          key={seq}
          busy={busy}
          onUpdate={() => setBusy(true)}
          onLater={() => setShown(false)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
