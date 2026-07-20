import { money } from '../orderDoc';

// Заметный блок итога вместо тихой серой строчки: крупная сумма на бирюзовой
// подложке, чтобы её было видно с одного взгляда.
// insurer=true (счёт): если у машины страховая франшиза, счёт уходит страховой
// БЕЗ франшизы — главной цифрой показываем payable (стоимость − франшиза) с
// расшифровкой, а не полную стоимость ремонта. У ЗН/акта — полная стоимость.
// Строка «К доплате» показывается только при предоплате (иначе дублировала бы итог).
export default function DocTotal({ totals, grandLabel = 'Итого к оплате', insurer = false }) {
  if (!totals) return null;
  const ins = insurer && Number(totals.franchise) > 0;
  const grand = ins ? totals.payable : totals.total;
  const due = ins ? totals.payable_due : totals.due;
  const hasDue = Number(due) < Number(grand);
  return (
    <div className="oe-total">
      {ins && (
        <>
          <div className="oe-total-line"><span className="oe-total-cap">Стоимость ремонта</span><span className="oe-total-val">{money(totals.total)}</span></div>
          <div className="oe-total-line"><span className="oe-total-cap">Франшиза (оплачивает клиент отдельно)</span><span className="oe-total-val">− {money(totals.franchise)}</span></div>
        </>
      )}
      <div className="oe-total-grand">
        <span className="oe-total-cap">{ins ? 'К оплате по счёту (страховая)' : grandLabel}</span>
        <span className="oe-total-val">{money(grand)}</span>
      </div>
      {hasDue && (
        <div className="oe-total-due">
          <span className="oe-total-cap">К доплате</span>
          <span className="oe-total-val">{money(due)}</span>
        </div>
      )}
    </div>
  );
}
