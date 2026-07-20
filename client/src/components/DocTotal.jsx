import { money } from '../orderDoc';

// Заметный блок итога вместо тихой серой строчки: крупная сумма «Итого к оплате»
// на бирюзовой подложке, чтобы её было видно с одного взгляда. Строка «К доплате»
// показывается только при наличии предоплаты (иначе дублировала бы главную сумму).
export default function DocTotal({ totals, grandLabel = 'Итого к оплате' }) {
  if (!totals) return null;
  const hasDue = Number(totals.due) < Number(totals.total);
  return (
    <div className="oe-total">
      <div className="oe-total-grand">
        <span className="oe-total-cap">{grandLabel}</span>
        <span className="oe-total-val">{money(totals.total)}</span>
      </div>
      {hasDue && (
        <div className="oe-total-due">
          <span className="oe-total-cap">К доплате</span>
          <span className="oe-total-val">{money(totals.due)}</span>
        </div>
      )}
    </div>
  );
}
