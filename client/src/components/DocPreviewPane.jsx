import { useEffect, useRef, useState } from 'react';

const A4_WIDTH_PX = 794; // 210mm при 96dpi

// Правая панель редактора: живой предпросмотр листа A4, ужатый под ширину панели.
// Прячется/показывается по кнопке «Скрыть/Показать лист» (проп show). Масштаб
// пересчитывается КАЖДЫЙ раз при показе (эффект зависит от show) — иначе после
// возврата скрытого листа он открывался бы в минимальном масштабе 0.25, потому
// что ResizeObserver не срабатывает на элементе, который только что смонтировали.
export default function DocPreviewPane({ show, children }) {
  const paneRef = useRef(null);
  const [scale, setScale] = useState(0.6);

  useEffect(() => {
    if (!show) return undefined;
    const pane = paneRef.current;
    if (!pane) return undefined;
    const fit = () => setScale(Math.max(0.25, Math.min(1, (pane.clientWidth - 32) / A4_WIDTH_PX)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [show]);

  if (!show) return null;
  return (
    <div className="order-editor-right" ref={paneRef}>
      <div className="oe-preview-scale" style={{ zoom: scale, display: 'inline-block' }}>{children}</div>
    </div>
  );
}
