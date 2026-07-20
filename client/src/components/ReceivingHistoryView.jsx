import { useState } from 'react';
import dayjs from 'dayjs';
import Icon from './Icon';
import PhotoViewer from './PhotoViewer';

// Presentational half of the «История приёмки» screen — pure props, no Firestore.
// The real screen (ReceivingHistory) feeds it live data; the demo feeds it seed
// data, so both render byte-for-byte the same thing (a faithful, credential-free
// preview). All the receiving logic lives in receivingHistory.js.
const FILTERS = [
  { id: 'all', label: 'Все', key: 'total' },
  { id: 'in', label: 'Принято на склад', key: 'in' },
  { id: 'arrived', label: 'Приехало в ТК', key: 'arrived' },
  { id: 'ordered', label: 'Заказано', key: 'ordered' },
  { id: 'photo', label: 'Фото', key: 'photo' },
];

// email → короткое имя для подписи «кто принял». Профилей с именами тут нет,
// поэтому берём часть до @ — обычно это узнаваемо (ivan@… → «ivan»).
function personName(by) {
  if (!by) return 'не отмечено';
  const s = String(by);
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s;
}

// Русские месяцы (родительный падеж) — форматируем сами, чтобы не менять
// глобальную локаль dayjs ради одной подписи дня.
const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// «Сегодня» / «Вчера» / «10 июля 2026» — заголовок дня в ленте.
function dayLabel(ts) {
  const d = dayjs(ts);
  const today = dayjs().startOf('day');
  if (d.isAfter(today)) return 'Сегодня';
  if (d.isAfter(today.subtract(1, 'day'))) return 'Вчера';
  const jsd = d.toDate();
  return `${jsd.getDate()} ${RU_MONTHS[jsd.getMonth()]} ${jsd.getFullYear()}`;
}

// Split the already-sorted (newest-first) feed into day sections without
// re-sorting — events keep their order, we only cut on a date change.
function groupByDay(events) {
  const sections = [];
  let cur = null;
  for (const e of events) {
    const key = dayjs(e.at).format('YYYY-MM-DD');
    if (!cur || cur.key !== key) {
      cur = { key, label: dayLabel(e.at), items: [] };
      sections.push(cur);
    }
    cur.items.push(e);
  }
  return sections;
}

export default function ReceivingHistoryView({
  loading, events = [], counts = {}, filter = 'all', onFilter = () => {},
  query = '', onQuery = () => {}, onRefresh = () => {}, refreshing = false,
}) {
  const [viewer, setViewer] = useState(null); // фото на весь экран, или null

  const sections = groupByDay(events);

  return (
    <div className="rhist">
      <div className="rhist-head">
        <div className="rhist-title">
          <h2>История приёмки</h2>
          <p>Кто и когда принял запчасть — по всем машинам, включая закрытые заказы</p>
        </div>
        <button
          type="button"
          className={`rhist-refresh${refreshing ? ' is-busy' : ''}`}
          onClick={onRefresh}
          disabled={refreshing}
          title="Обновить"
        >
          <Icon name="refresh" size={15} />{refreshing ? 'Обновляю…' : 'Обновить'}
        </button>
      </div>

      <div className="rhist-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`rhist-filter${filter === f.id ? ' active' : ''}`}
            onClick={() => onFilter(f.id)}
          >
            {f.label}<span className="rhist-count">{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="rhist-search">
        <Icon name="search" size={15} />
        <input
          placeholder="Поиск по машине, номеру, запчасти, человеку…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="rhist-search-clear" onClick={() => onQuery('')} aria-label="Очистить">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      {loading ? (
        <div className="list-loading"><div className="spinner" /><span>Загружаем историю…</span></div>
      ) : events.length === 0 ? (
        <div className="rhist-empty">
          <Icon name="history" size={28} />
          <p>
            {query ? 'Ничего не найдено по вашему запросу.'
              : filter !== 'all' ? 'По этому фильтру событий пока нет.'
                : 'Событий приёмки пока нет. Как только запчасти начнут заказывать и принимать, здесь появится история.'}
          </p>
        </div>
      ) : (
        <div className="rhist-feed">
          {sections.map((s) => (
            <div className="rhist-day" key={s.key}>
              <div className="rhist-day-head"><span>{s.label}</span></div>
              <ul className="rhist-rows">
                {s.items.map((e) => (
                  <li key={e.id} className="rhist-row">
                    <div className="rhist-time">{dayjs(e.at).format('HH:mm')}</div>
                    <div className="rhist-dot-wrap">
                      <span className="rhist-dot" style={{ background: e.statusColor }} />
                    </div>
                    <div className="rhist-body">
                      <div className="rhist-line1">
                        <span className="rhist-event" style={{ color: e.statusColor, borderColor: `color-mix(in srgb, ${e.statusColor} 45%, transparent)`, background: `color-mix(in srgb, ${e.statusColor} 12%, transparent)` }}>
                          {e.kind === 'photo' ? <Icon name="camera" size={12} /> : null}
                          {e.eventLabel}
                        </span>
                        <span className="rhist-part">
                          {e.partName}
                          {e.partCode ? <span className="rhist-part-code">{e.partCode}</span> : null}
                        </span>
                      </div>
                      <div className="rhist-line2">
                        <span className="rhist-car">
                          {e.car}
                          {e.plate ? <span className="rhist-plate">{e.plate}</span> : null}
                          {e.orderNum ? <span className="rhist-order">ЗН № {e.orderNum}</span> : null}
                          {e.archived ? <span className="rhist-archived">закрыт</span> : null}
                        </span>
                        <span className="rhist-who"><Icon name="user" size={12} />{personName(e.by)}</span>
                      </div>
                    </div>
                    {e.photo && e.photo.url && (
                      <button type="button" className="rhist-thumb" onClick={() => setViewer(e.photo)} title="Открыть фото">
                        <img src={e.photo.url} alt={e.partName} loading="lazy" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} alt="Фото приёмки" />
    </div>
  );
}
