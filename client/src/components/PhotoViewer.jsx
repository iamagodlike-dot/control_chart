import Icon from './Icon';
import { useModalEscape } from '../modalEscape';

// Просмотр одного фото на весь экран. Общий для карточки машины (CarCard) и
// экрана «Приёмка» (ReceivingView). Использует уже существующие стили .cc-viewer.
//
// Здесь клик по фону закрывать МОЖНО (в отличие от окон с формами): терять
// нечего, а для лупы это привычный жест. Клик по самому снимку не закрывает.
// stopPropagation оставлен: просмотрщик рисуется внутри чужих окон, и его
// закрытие не должно всплывать к ним.
//
// Escape закрывает именно снимок, хотя под ним открыто окно: просмотрщик лежит
// глубже, а верхнее окно определяется по вложенности (см. modalEscape).
export default function PhotoViewer({ photo, onClose, alt = 'Фото' }) {
  const backdropRef = useModalEscape(onClose, !!photo);
  if (!photo) return null;
  const close = (e) => { e.stopPropagation(); onClose(); };
  return (
    <div className="cc-viewer" ref={backdropRef} onClick={close}>
      <button className="cc-viewer-close" onClick={close} aria-label="Закрыть">
        <Icon name="x" size={24} strokeWidth={2} />
      </button>
      <img src={photo.url} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
