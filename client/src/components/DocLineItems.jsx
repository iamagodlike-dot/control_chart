import { money, lineTotal } from '../orderDoc';

// Позиции работ/запчастей в редакторе документа: строки-карточки с крупными
// ПОДПИСАННЫМИ полями (Кол-во / Цена, ₽ / Сумма). На широком экране подписи несёт
// одна строка-шапка (.oe-items-head), на узком — каждая ячейка показывает свою
// подпись и карточка перестраивается в столбик (см. orderDoc.css). Один общий
// компонент для обоих редакторов (заказ-наряд и акт/счёт) — чинит и «узко»,
// и «цену не видно», и убирает дубль вёрстки таблиц.

const COLS = {
  services: [
    { key: 'name', label: 'Наименование', type: 'text', placeholder: 'напр. Окраска двери' },
    { key: 'qty', label: 'Кол-во', type: 'number' },
    { key: 'price', label: 'Цена, ₽', type: 'number', money: true },
  ],
  parts: [
    { key: 'code', label: 'Код', type: 'text', placeholder: 'артикул' },
    { key: 'name', label: 'Наименование', type: 'text', placeholder: 'напр. Бампер' },
    { key: 'qty', label: 'Кол-во', type: 'number' },
    { key: 'unit', label: 'Ед.', type: 'text', placeholder: 'шт.' },
    { key: 'price', label: 'Цена, ₽', type: 'number', money: true },
  ],
};

export default function DocLineItems({ kind, items, onAdd, onUpdate, onRemove, addLabel }) {
  const cols = COLS[kind];
  const list = items || [];
  return (
    <div className={`oe-items oe-items-${kind}`}>
      <div className="oe-items-head" aria-hidden="true">
        {cols.map((c) => <span key={c.key} className={`oe-h oe-h-${c.key}`}>{c.label}</span>)}
        <span className="oe-h oe-h-sum">Сумма</span>
        <span className="oe-h oe-h-del" />
      </div>

      {list.length === 0 && (
        <div className="oe-items-empty">Пока нет позиций — добавьте первую кнопкой ниже.</div>
      )}

      {list.map((it) => (
        <div className="oe-item" key={it.id}>
          {cols.map((c) => (
            <label className={`oe-cell oe-cell-${c.key}`} key={c.key}>
              <span className="oe-cell-label">{c.label}</span>
              <input
                className={c.money ? 'oe-in oe-money' : 'oe-in'}
                type={c.type === 'number' ? 'number' : 'text'}
                min={c.type === 'number' ? '0' : undefined}
                inputMode={c.type === 'number' ? 'decimal' : undefined}
                value={it[c.key] ?? ''}
                placeholder={c.placeholder || ''}
                onChange={(e) => onUpdate(it.id, { [c.key]: e.target.value })}
              />
            </label>
          ))}
          <div className="oe-cell oe-cell-sum">
            <span className="oe-cell-label">Сумма</span>
            <span className="oe-sum-val">{money(lineTotal(it))}</span>
          </div>
          <button className="oe-item-del" title="Удалить строку" aria-label="Удалить строку" onClick={() => onRemove(it.id)}>×</button>
        </div>
      ))}

      <button className="oe-add" onClick={onAdd}>{addLabel}</button>
    </div>
  );
}
