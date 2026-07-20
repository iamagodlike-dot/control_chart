import { useState } from 'react';

// Сворачиваемая секция для редко-правимых блоков (юр-тексты, реквизиты).
// НАРОЧНО без <details>/<summary>: у владельца браузер отображал summary пустой
// полоской (без заголовка и стрелки) — нативный элемент ведёт себя по-разному
// в разных браузерах. Обычный <button> + условный рендер тела рисуются одинаково
// везде и не имеют скрытой браузерной логики.
// Клик по шапке ТОЛЬКО раскрывает/сворачивает. Попадёт ли блок в готовый документ —
// отдельный чекбокс в теле (проп toggle) + read-only бейдж «В документе/Скрыто».
//   toggle = { checked: bool, onChange: (bool) => void }  — необязательный
//   hint   = строка-пояснение внутри тела                 — необязательный
export default function CollapsibleSection({ title, defaultOpen = false, toggle, hint, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`oe-collapse${open ? ' is-open' : ''}`}>
      <button type="button" className="oe-collapse-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="oe-collapse-chevron" aria-hidden="true">▸</span>
        <span className="oe-collapse-title">{title}</span>
        {toggle && (
          <span className={`oe-collapse-badge ${toggle.checked ? 'is-on' : 'is-off'}`}>
            {toggle.checked ? 'В документе' : 'Скрыто'}
          </span>
        )}
      </button>
      {open && (
        <div className="oe-collapse-body">
          {toggle && (
            <label className="oe-toggle">
              <input type="checkbox" checked={toggle.checked} onChange={(e) => toggle.onChange(e.target.checked)} />
              Показывать этот блок в готовом документе
            </label>
          )}
          {hint && <div className="oe-hint">{hint}</div>}
          {children}
        </div>
      )}
    </div>
  );
}
