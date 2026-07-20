import Icon from './Icon';

// Просмотр одного фото на весь экран. Общий для карточки машины (CarCard) и
// экрана «Приёмка» (ReceivingView). Использует уже существующие стили .cc-viewer.
//
// stopPropagation ОБЯЗАТЕЛЕН внутри: просмотрщик может быть вложен в кликабельный
// фон (у CarCard это cc-backdrop, чей onClick закрывает карточку). Без остановки
// всплытия закрытие фото заодно роняло бы родителя. Клик по самому снимку не
// закрывает — только по тёмному фону и крестику.
export default function PhotoViewer({ photo, onClose, alt = 'Фото' }) {
  if (!photo) return null;
  const close = (e) => { e.stopPropagation(); onClose(); };
  return (
    <div className="cc-viewer" onClick={close}>
      <button className="cc-viewer-close" onClick={close} aria-label="Закрыть">
        <Icon name="x" size={24} strokeWidth={2} />
      </button>
      <img src={photo.url} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
