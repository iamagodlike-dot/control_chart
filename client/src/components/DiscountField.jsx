import { money } from '../orderDoc';

// Поле скидки с переключателем ₽ / %. В рублях правим сумму (discount), в процентах —
// процент (discount_pct) от суммы работ+запчастей. При переключении режима значение
// пересчитывается (10% → рубли и обратно), чтобы не терялось. Наружу отдаём patch со
// снапшот-полями; эффективную сумму в рублях (для подсказки) считает редактор.
export default function DiscountField({ mode, rub, pct, effective, subtotal, onPatch }) {
  const isPct = mode === 'pct';
  const sub = Number(subtotal) || 0;

  function switchMode(next) {
    if (next === mode) return;
    if (next === 'pct') {
      // рубли → проценты: сколько процентов составляет текущая рублёвая скидка
      const p = sub > 0 ? Math.round(((Number(rub) || 0) / sub) * 1000) / 10 : 0;
      onPatch({ discount_mode: 'pct', discount_pct: Math.min(100, p) });
    } else {
      // проценты → рубли: фиксируем текущую посчитанную сумму
      onPatch({ discount_mode: 'rub', discount: Number(effective) || 0 });
    }
  }

  return (
    <div className="oe-field oe-discount">
      <div className="oe-discount-head">
        <span>Скидка</span>
        <span className="oe-unit-toggle" role="group" aria-label="Единица скидки">
          <button type="button" className={!isPct ? 'active' : ''} aria-pressed={!isPct} onClick={() => switchMode('rub')}>₽</button>
          <button type="button" className={isPct ? 'active' : ''} aria-pressed={isPct} onClick={() => switchMode('pct')}>%</button>
        </span>
      </div>
      {isPct ? (
        <input type="number" min="0" max="100" step="0.1" inputMode="decimal" value={pct ?? ''} onChange={(e) => onPatch({ discount_pct: e.target.value })} placeholder="0" />
      ) : (
        <input type="number" min="0" inputMode="decimal" value={rub ?? ''} onChange={(e) => onPatch({ discount: e.target.value })} placeholder="0" />
      )}
      {isPct && <span className="oe-hint">= {money(effective)} от работ и запчастей</span>}
    </div>
  );
}
