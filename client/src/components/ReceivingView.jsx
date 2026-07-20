import { useState } from 'react';
import Icon from './Icon';
import PhotoViewer from './PhotoViewer';

// Presentational half of the экспедитор «Приёмка» screen — pure props, no
// Firestore. The real screen (PartsReceiving) feeds it live data; the demo
// (src/demo/receiving-demo.jsx) feeds it seed data. Keeping the markup here means
// both render byte-for-byte the same thing, so the credential-free preview is faithful.
const FILTERS = [
  { id: 'arrived', label: 'Забрать' },   // доехало до ТК — главный список экспедитора
  { id: 'ordered', label: 'В пути' },    // ещё едет к складу ТК
  { id: 'in', label: 'На складе' },      // уже привезли к нам
  { id: 'all', label: 'Все' },
];

export default function ReceivingView({
  loading, groups, counts, filter, onFilter, onSetStatus, busy,
  onAddPhoto = () => {}, onDeletePhoto = () => {}, uploadPart = null, uploadProgress = 0, photoErr = null,
  onSaveComment = () => {},
}) {
  const [viewer, setViewer] = useState(null); // фото, открытое на весь экран, или null
  const [editNote, setEditNote] = useState(null); // id позиции, чей комментарий сейчас правят
  const [draft, setDraft] = useState('');          // черновик текста комментария
  if (loading) {
    return (
      <div className="recv">
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      </div>
    );
  }

  return (
    <div className="recv">
      <div className="recv-head">
        <div className="recv-title">
          <h2>Приёмка запчастей</h2>
          <p>Что забрать из ТК и в какую ячейку положить</p>
        </div>
        <div className="recv-filters">
          {FILTERS.map((f) => {
            const n = f.id === 'ordered' ? counts.ordered
              : f.id === 'arrived' ? counts.arrived
                : f.id === 'in' ? counts.in
                  : counts.total;
            return (
              <button
                key={f.id}
                className={`recv-filter${filter === f.id ? ' active' : ''}`}
                onClick={() => onFilter(f.id)}
              >
                {f.label}<span className="recv-count">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="recv-empty">
          <Icon name="box" size={28} />
          <p>
            {filter === 'arrived' ? 'Забирать нечего — в пункте выдачи пусто.'
              : filter === 'ordered' ? 'Нет запчастей в пути.'
                : filter === 'in' ? 'На складе пока ничего не отмечено.'
                  : 'Запчастей в пути, к выдаче и на складе нет.'}
          </p>
        </div>
      ) : (
        <div className="recv-list">
          {groups.map((g) => (
            <div key={g.jobId} className={`recv-card${g.readyPickup ? ' is-pickup' : g.waiting ? ' is-waiting' : ''}`}>
              <div className="recv-car">
                <div className="recv-car-line">
                  <span className="recv-model">{g.car}</span>
                  {g.plate && <span className="recv-plate">{g.plate}</span>}
                </div>
                <div className="recv-car-sub">
                  {g.orderNum && <span>ЗН № {g.orderNum}</span>}
                  {g.client && <span>{g.client}</span>}
                </div>
                <div className={`recv-cell${g.hasCell ? '' : ' is-none'}`}>
                  <Icon name="box" size={14} />
                  {g.hasCell
                    ? <span>Класть в ячейку <b>{g.cellIds.join(', ')}</b></span>
                    : <span>Ячейка не назначена</span>}
                </div>
              </div>

              <ul className="recv-parts">
                {g.parts.map((p) => (
                  <li key={p.id} className="recv-part">
                    <div className="recv-part-main">
                    <span className="recv-dot" style={{ background: p.statusColor }} />
                    <span className="recv-part-name">
                      {p.name}
                      {p.code ? <span className="recv-part-code">{p.code}</span> : null}
                    </span>
                    {p.supplier
                      ? (
                        <span className="recv-supplier" title="Поставщик — где забрать запчасть">
                          <Icon name="pin" size={13} />{p.supplier}
                        </span>
                      ) : (
                        <span className="recv-supplier is-none" title="Поставщик не указан — уточните у менеджера">
                          <Icon name="pin" size={13} />не указан
                        </span>
                      )}
                    <span className="recv-qty">{p.qty} шт</span>
                    {p.eta && p.status === 'ordered' ? <span className="recv-eta">до {p.eta}</span> : null}
                    {p.status === 'ordered' ? (
                      // Едет к складу ТК → отметить, что доехало и готово к выдаче.
                      <button
                        className="recv-arrive is-transit"
                        disabled={busy === p.id}
                        title="Приехало на склад ТК — можно забирать"
                        onClick={() => onSetStatus(g.jobId, p.id, 'arrived')}
                      >
                        <Icon name="pin" size={14} />Приехало в ТК
                      </button>
                    ) : p.status === 'arrived' ? (
                      // Лежит в ТК → экспедитор забрал и привёз к нам на склад.
                      <span className="recv-pickup">
                        <button
                          className="recv-arrive"
                          disabled={busy === p.id}
                          title="Забрал из ТК и привёз к нам на склад"
                          onClick={() => onSetStatus(g.jobId, p.id, 'in')}
                        >
                          <Icon name="check" size={14} />Привёз к нам
                        </button>
                        <button
                          className="recv-undo"
                          disabled={busy === p.id}
                          title="Вернуть «в пути»"
                          onClick={() => onSetStatus(g.jobId, p.id, 'ordered')}
                        >↩</button>
                      </span>
                    ) : (
                      <span className="recv-instock">
                        <Icon name="check" size={13} />На складе
                        <button
                          className="recv-undo"
                          disabled={busy === p.id}
                          title="Вернуть в «забрать»"
                          onClick={() => onSetStatus(g.jobId, p.id, 'arrived')}
                        >↩</button>
                      </span>
                    )}
                    </div>

                    {/* Фото приёмки этой позиции: снял деталь при заборе → миниатюра.
                        Камера сразу открывает заднюю (environment) на телефоне. */}
                    <div className="recv-part-photos">
                      {(p.photos || []).map((ph) => (
                        <div className="recv-thumb" key={ph.id}>
                          <img src={ph.url} alt={p.name} loading="lazy" onClick={() => setViewer(ph)} />
                          <button
                            type="button"
                            className="recv-thumb-del"
                            title="Удалить фото"
                            aria-label="Удалить фото"
                            onClick={() => onDeletePhoto(g.jobId, { ...ph, partId: p.id })}
                          >
                            <Icon name="trash" size={12} strokeWidth={2} />
                          </button>
                        </div>
                      ))}
                      {uploadPart === p.id ? (
                        <span className="recv-photo-add is-busy">
                          <span className="recv-photo-progress">{uploadProgress ? `${uploadProgress}%` : '…'}</span>
                        </span>
                      ) : (
                        <>
                          {/* Прямая съёмка: камера сразу открывает заднюю (environment). */}
                          <label className="recv-photo-add">
                            <Icon name="camera" size={16} /><span>Фото</span>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              multiple
                              hidden
                              disabled={uploadPart != null}
                              onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; onAddPhoto(g.jobId, p.id, f); }}
                            />
                          </label>
                          {/* Загрузка из памяти телефона: тот же input, но без capture —
                              открывается галерея/файлы. Оба зовут один onAddPhoto. */}
                          <label className="recv-photo-add">
                            <Icon name="image" size={16} /><span>Галерея</span>
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              hidden
                              disabled={uploadPart != null}
                              onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; onAddPhoto(g.jobId, p.id, f); }}
                            />
                          </label>
                        </>
                      )}
                      {photoErr && photoErr.partId === p.id && (
                        <span className="recv-photo-err">{photoErr.msg}</span>
                      )}
                    </div>

                    {/* Комментарий к позиции — свободная заметка (состояние детали,
                        «привёз 1 из 2» и т.п.). Хранится на самой запчасти. */}
                    <div className="recv-part-note">
                      {editNote === p.id ? (
                        <div className="recv-note-edit">
                          <textarea
                            className="recv-note-input"
                            value={draft}
                            rows={2}
                            autoFocus
                            placeholder="Комментарий к запчасти (напр. «коробка мятая», «привёз 1 из 2»)…"
                            onChange={(e) => setDraft(e.target.value)}
                          />
                          <div className="recv-note-btns">
                            <button
                              type="button"
                              className="recv-note-save"
                              disabled={busy === p.id}
                              onClick={() => { onSaveComment(g.jobId, p.id, draft); setEditNote(null); }}
                            >
                              <Icon name="check" size={14} />Сохранить
                            </button>
                            <button type="button" className="recv-note-cancel" onClick={() => setEditNote(null)}>
                              Отмена
                            </button>
                          </div>
                        </div>
                      ) : p.comment ? (
                        <button
                          type="button"
                          className="recv-note has"
                          title="Изменить комментарий"
                          onClick={() => { setDraft(p.comment); setEditNote(p.id); }}
                        >
                          <Icon name="edit" size={13} /><span>{p.comment}</span>
                        </button>
                      ) : (
                        <button type="button" className="recv-note add" onClick={() => { setDraft(''); setEditNote(p.id); }}>
                          <Icon name="edit" size={13} />Комментарий
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} alt="Фото запчасти" />
    </div>
  );
}
