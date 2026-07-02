// Clear, labelled row actions shared by the Gantt car list and the History list.
// Line icons (no emoji) + inline styles (app theme vars) so they need no shared CSS.
// Both stop row-click propagation.
import Icon from './Icon';

const baseStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontSize: 12, fontWeight: 600, lineHeight: 1.2,
  padding: '5px 11px', borderRadius: 8,
  border: '1px solid var(--color-border)', background: 'transparent',
  color: 'var(--color-text)', cursor: 'pointer', whiteSpace: 'nowrap',
};

const finishStyle = {
  ...baseStyle,
  borderColor: 'var(--color-success)',
  color: 'var(--color-success)',
  background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
};

export function DocsButton({ onClick, title }) {
  return (
    <button
      type="button"
      style={baseStyle}
      title={title || 'Заказ-наряд · акты · счёт'}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
    >
      <Icon name="file" size={14} />Документы
    </button>
  );
}

export function FinishButton({ onClick, title, label = 'Завершить' }) {
  return (
    <button
      type="button"
      style={finishStyle}
      title={title || 'Завершить и убрать в историю'}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
    >
      <Icon name="check" size={14} strokeWidth={2} />{label}
    </button>
  );
}
