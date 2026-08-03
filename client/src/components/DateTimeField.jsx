import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import { useModalEscape } from '../modalEscape';

// Themed dropdown date (or date+time) picker used everywhere instead of the
// native datetime-local — a real calendar popover that matches the dark UI.
// Value/onChange use the SAME local strings the native inputs did:
//   mode="datetime" → 'YYYY-MM-DDTHH:mm'   mode="date" → 'YYYY-MM-DD'
// The popover is portaled to <body> with fixed positioning so it never clips
// inside scrollable modals.

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const POPOVER_W = 272;
const EST_H = 340;

export default function DateTimeField({ value, onChange, mode = 'datetime', placeholder }) {
  const withTime = mode !== 'date';
  const fmt = withTime ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD';
  const parsed = value ? dayjs(value) : null;
  const valid = !!(parsed && parsed.isValid());

  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => (valid ? parsed.startOf('month') : dayjs().startOf('month')));
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);

  const reposition = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const openUp = below < EST_H && r.top > below;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - POPOVER_W - 8));
    setPos(openUp
      ? { left, bottom: window.innerHeight - r.top + 6 }
      : { left, top: r.bottom + 6 });
  }, []);

  // Outside clicks are handled by the full-screen catcher below (so the click
  // never reaches an underlying modal backdrop or a wrapping <label>). Here we
  // only keep the popover aligned on resize.
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [open, reposition]);

  // Escape закрывает СНАЧАЛА календарь, а не окно, в котором он открыт. Попап
  // живёт в портале body и по вложенности проигрывает модалке — поэтому level 1
  // (см. modalEscape).
  const popRef = useModalEscape(() => setOpen(false), open, 1);

  function toggle() {
    if (open) { setOpen(false); return; }
    setView((valid ? parsed : dayjs()).startOf('month'));
    reposition();
    setOpen(true);
  }

  function pickDay(d) {
    if (withTime) {
      const t = valid ? parsed : dayjs().hour(9).minute(0);
      onChange(d.hour(t.hour()).minute(t.minute()).format(fmt));
    } else {
      onChange(d.format(fmt));
      setOpen(false);
    }
  }

  function setTime(hhmm) {
    const [h, m] = (hhmm || '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    const base = valid ? parsed : dayjs();
    onChange(base.hour(h).minute(m).format(fmt));
  }

  const display = valid ? parsed.format(withTime ? 'DD.MM.YYYY HH:mm' : 'DD.MM.YYYY') : '';
  const timeVal = valid && withTime ? parsed.format('HH:mm') : '';

  const firstOfMonth = view.startOf('month');
  const offset = (firstOfMonth.day() + 6) % 7; // make Monday the first column
  const gridStart = firstOfMonth.subtract(offset, 'day');
  const days = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  const today = dayjs();

  return (
    <div className="dtf">
      <button type="button" ref={btnRef} className={`dtf-field${valid ? '' : ' is-empty'}`} onClick={toggle}>
        <span className="dtf-value">{display || placeholder || (withTime ? 'дд.мм.гггг --:--' : 'дд.мм.гггг')}</span>
        <span className="dtf-cal" aria-hidden="true">📅</span>
      </button>

      {open && pos && createPortal(
        <>
          <div className="dtf-catch" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="dtf-pop" ref={popRef} style={{ ...pos, width: POPOVER_W }}>
          <div className="dtf-head">
            <button type="button" className="dtf-nav" onClick={() => setView(view.subtract(1, 'month'))} aria-label="Предыдущий месяц">‹</button>
            <span className="dtf-month">{MONTHS[view.month()]} {view.year()}</span>
            <button type="button" className="dtf-nav" onClick={() => setView(view.add(1, 'month'))} aria-label="Следующий месяц">›</button>
          </div>
          <div className="dtf-wd">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="dtf-grid">
            {days.map((d) => {
              const other = d.month() !== view.month();
              const cls = `dtf-day${other ? ' is-other' : ''}${d.isSame(today, 'day') ? ' is-today' : ''}${valid && d.isSame(parsed, 'day') ? ' is-sel' : ''}`;
              return (
                <button type="button" key={d.format('YYYY-MM-DD')} className={cls} onClick={() => pickDay(d)}>{d.date()}</button>
              );
            })}
          </div>
          {withTime && (
            <div className="dtf-time">
              <span>Время</span>
              <input type="time" value={timeVal} onChange={(e) => setTime(e.target.value)} />
            </div>
          )}
          <div className="dtf-foot">
            <button type="button" className="dtf-foot-btn" onClick={() => { const n = dayjs(); setView(n.startOf('month')); pickDay(n); }}>Сегодня</button>
            {value ? <button type="button" className="dtf-foot-btn" onClick={() => { onChange(''); setOpen(false); }}>Очистить</button> : <span />}
            <button type="button" className="dtf-foot-btn primary" onClick={() => setOpen(false)}>Готово</button>
          </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
