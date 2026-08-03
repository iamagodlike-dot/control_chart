import { useState } from 'react';
import Icon from './Icon';
import { useModalEscape } from '../modalEscape';
import { money } from '../parts';
import {
  STOCK_FILTERS, SORTS, CONSUMABLE_CATEGORIES, STATE_META,
  FIVE_S, SCORE_LABELS, auditTotal, auditVerdict, DEAD_DAYS,
} from '../consumables';

// Презентационная половина экрана «Расходники» — чистые пропсы, без Firestore.
// Реальный экран (Consumables) кормит её живыми данными, демо — сидом, так что
// обе версии рисуют побуквенно одно и то же. Вся логика — в consumables.js.
//
// Три вида одного и того же склада:
//   «Светофор» — плитки по стеллажам, для обхода полок с телефоном в руке;
//   «Список»   — таблица, для разбора и правки номенклатуры за компьютером;
//   «Аудит 5S» — еженедельная оценка по пяти шагам и её динамика.

const dd = (ms) => (ms ? new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—');
const ddl = (ms) => (ms ? new Date(ms).toLocaleDateString('ru-RU') : '—');

const VIEWS = [
  { id: 'board', label: 'Светофор', icon: 'tv' },
  { id: 'list', label: 'Список', icon: 'columns' },
  { id: 'audit', label: 'Аудит 5S', icon: 'shield' },
];

// Как показывать остаток: у учётных — число и единица, у канбана — слово.
// Мастеру не надо помнить, к какой группе относится позиция: он видит либо
// цифру, либо «есть / кончилось», и оба варианта читаются одинаково быстро.
function stockText(row) {
  const { item } = row;
  if (!item.tracked) return item.empty ? 'кончилось' : 'есть';
  const q = Number(item.qty) || 0;
  return `${Number.isInteger(q) ? q : q.toFixed(1)} ${item.unit || ''}`.trim();
}

export default function ConsumablesView({
  loading = false,
  rows = [], counts = {}, summary = {}, groups = [],
  view = 'board', onView = () => {},
  filter = 'all', onFilter = () => {},
  category = 'all', onCategory = () => {},
  query = '', onQuery = () => {},
  sort = 'state', onSort = () => {},
  onTake = () => {}, onEmpty = () => {}, onOrder = () => {},
  onReceive = () => {}, onRedTag = () => {}, onDropRedTag = () => {},
  onOpen = () => {}, onScan = () => {},
  openRow = null, onClose = () => {}, moves = [],
  audit = {}, onScore = () => {}, onSaveAudit = () => {}, audits = [],
  notice = '',
}) {
  return (
    <div className="cns">
      <div className="cns-head">
        <div className="cns-title">
          <h2><Icon name="box" size={18} />Расходники</h2>
          <p>Склад по 5S: что кончилось, где лежит и что пора заказывать</p>
        </div>
        <div className="cns-summary">
          <span className="cns-stat">позиций <b>{summary.total ?? 0}</b></span>
          <span className={`cns-stat${summary.out ? ' is-out' : ''}`}>кончилось <b>{summary.out ?? 0}</b></span>
          <span className={`cns-stat${summary.low ? ' is-low' : ''}`}>на исходе <b>{summary.low ?? 0}</b></span>
          <span className="cns-stat">к заказу <b>{money(summary.toOrderCost || 0)}</b></span>
        </div>
      </div>

      <div className="cns-views">
        {VIEWS.map((v) => (
          <button
            key={v.id} type="button"
            className={`cns-view-btn${view === v.id ? ' active' : ''}`}
            onClick={() => onView(v.id)}
          >
            <Icon name={v.icon} size={14} />{v.label}
          </button>
        ))}
        <button type="button" className="cns-scan" onClick={onScan} title="Навести камеру на этикетку полки">
          <Icon name="camera" size={15} />Сканировать
        </button>
      </div>

      {notice ? <div className="cns-notice"><Icon name="check" size={14} />{notice}</div> : null}

      {(summary.expiring > 0 || summary.dead > 0) && view !== 'audit' && (
        <div className="cns-alerts">
          {summary.expiring > 0 && (
            <button type="button" className="cns-alert is-warn" onClick={() => { onFilter('all'); onSort('name'); }}>
              <Icon name="clock" size={14} />
              Срок годности истекает или вышел: <b>{summary.expiring}</b>
            </button>
          )}
          {summary.dead > 0 && (
            <button type="button" className="cns-alert" onClick={() => onFilter('dead')}>
              <Icon name="warning" size={14} />
              Не двигалось больше {DEAD_DAYS} дней: <b>{summary.dead}</b> — кандидаты в красную зону
            </button>
          )}
        </div>
      )}

      {view !== 'audit' && (
        <div className="cns-filters">
          <div className="cns-chips">
            {STOCK_FILTERS.map((f) => (
              <button
                key={f.id} type="button"
                className={`cns-chip${filter === f.id ? ' active' : ''} is-${f.id}`}
                onClick={() => onFilter(f.id)}
              >
                {f.label}<span className="cns-chip-count">{counts[f.id] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="cns-tools">
            <select className="cns-select" value={category} onChange={(e) => onCategory(e.target.value)} title="Категория">
              <option value="all">Все категории</option>
              {CONSUMABLE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="cns-select" value={sort} onChange={(e) => onSort(e.target.value)} title="Сортировка">
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <div className="cns-search">
              <Icon name="search" size={14} />
              <input placeholder="Название, адрес, категория…" value={query} onChange={(e) => onQuery(e.target.value)} />
              {query && (
                <button type="button" className="cns-search-clear" onClick={() => onQuery('')} aria-label="Очистить">
                  <Icon name="x" size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="list-loading"><div className="spinner" /><span>Загружаем склад…</span></div>
      ) : view === 'audit' ? (
        <AuditPane audit={audit} audits={audits} onScore={onScore} onSave={onSaveAudit} summary={summary} />
      ) : rows.length === 0 ? (
        <div className="cns-empty">
          <Icon name="box" size={28} />
          <p>{query ? 'Ничего не найдено по вашему запросу.' : 'По выбранным фильтрам позиций нет.'}</p>
        </div>
      ) : view === 'board' ? (
        <div className="cns-board">
          {groups.map((g) => (
            <section key={g.shelf} className="cns-shelf">
              <div className="cns-shelf-head">
                <span className="cns-shelf-name"><Icon name="pin" size={13} />{g.shelf}</span>
                <span className="cns-shelf-count">{g.items.length} поз.</span>
                {g.out > 0 && <span className="cns-shelf-out">{g.out} кончилось</span>}
              </div>
              <div className="cns-tiles">
                {g.items.map((r) => (
                  <Tile key={r.item.id} row={r} onTake={onTake} onEmpty={onEmpty} onOrder={onOrder} onOpen={onOpen} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="cns-table">
          <div className="cns-head-row">
            <span>Позиция</span><span>Адрес</span><span>Группа</span>
            <span>Остаток</span><span>Мин / макс</span><span>Состояние</span><span>Лежит</span><span></span>
          </div>
          {rows.map((r) => <ListRow key={r.item.id} row={r} onOpen={onOpen} onOrder={onOrder} />)}
        </div>
      )}

      {openRow && (
        <ItemSheet
          row={openRow} moves={moves} onClose={onClose}
          onTake={onTake} onEmpty={onEmpty} onOrder={onOrder}
          onReceive={onReceive} onRedTag={onRedTag} onDropRedTag={onDropRedTag}
        />
      )}
    </div>
  );
}

// ─── Плитка «Светофора» ─────────────────────────────────────────────────────
function Tile({ row, onTake, onEmpty, onOrder, onOpen }) {
  const { item, state } = row;
  const ordered = !!item.request_id;
  return (
    <article className={`cns-tile is-${state}${ordered ? ' is-ordered' : ''}`}>
      <button type="button" className="cns-tile-open" onClick={() => onOpen(item.id)} title="Открыть карточку">
        <div className="cns-tile-top">
          <span className="cns-dot" />
          <span className="cns-tile-name">{item.name}</span>
          <span className={`cns-abc${item.tracked ? ' is-a' : ''}`}>{item.tracked ? 'A' : 'BC'}</span>
        </div>
        <div className="cns-tile-loc">
          {item.location || 'без адреса'}
          {item.red_tag && <span className="cns-redtag-mini">красный ярлык</span>}
          {row.expiry === 'expired' && <span className="cns-exp-mini is-bad">срок вышел</span>}
          {row.expiry === 'soon' && <span className="cns-exp-mini">срок {row.expiryDays} дн</span>}
          {/* Мёртвый запас зелёный по светофору, но глазу его надо ловить именно
              здесь: шаг «Сортировка» начинается с того, что лежит без движения. */}
          {row.dead && <span className="cns-exp-mini">лежит {row.idleDays} дн</span>}
        </div>
        <div className="cns-tile-qty">
          <b>{stockText(row)}</b>
          {item.tracked && <span className="cns-tile-minmax">мин {item.min_qty} · макс {item.max_qty}</span>}
        </div>
      </button>
      <div className="cns-tile-acts">
        {item.tracked ? (
          <button type="button" className="cns-act" disabled={(Number(item.qty) || 0) <= 0} onClick={() => onTake(item.id)}>
            <Icon name="minus" size={14} />Взял
          </button>
        ) : (
          <button type="button" className={`cns-act${item.empty ? ' is-on' : ''}`} onClick={() => onEmpty(item.id, !item.empty)}>
            <Icon name={item.empty ? 'refresh' : 'x'} size={14} />{item.empty ? 'Пополнено' : 'Кончилось'}
          </button>
        )}
        {ordered ? (
          <span className="cns-act is-ghost"><Icon name="cart" size={14} />{item.request_number || 'заявка'}</span>
        ) : state !== 'ok' ? (
          <button type="button" className="cns-act is-primary" onClick={() => onOrder(item.id)}>
            <Icon name="cart" size={14} />Заказать {row.reorderQty} {item.unit}
          </button>
        ) : null}
      </div>
    </article>
  );
}

// ─── Строка «Списка» ────────────────────────────────────────────────────────
function ListRow({ row, onOpen, onOrder }) {
  const { item, state } = row;
  return (
    <div
      className="cns-row" role="button" tabIndex={0}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item.id); } }}
    >
      <div className="cns-c cns-c-name">
        <span className="cns-row-name">{item.name}</span>
        <span className="cns-row-cat">{item.category}</span>
      </div>
      <div className="cns-c cns-c-loc"><span className="cns-loc">{item.location || '—'}</span></div>
      <div className="cns-c"><span className={`cns-abc${item.tracked ? ' is-a' : ''}`}>{item.tracked ? 'A' : 'BC'}</span></div>
      <div className="cns-c cns-c-qty">{stockText(row)}</div>
      <div className="cns-c cns-c-minmax">{item.tracked ? `${item.min_qty} / ${item.max_qty}` : '—'}</div>
      <div className="cns-c">
        <span className={`cns-state is-${state}`}><span className="cns-dot" />{STATE_META[state].short}</span>
      </div>
      <div className={`cns-c cns-c-idle${row.dead ? ' is-dead' : ''}`}>{row.idleDays == null ? '—' : `${row.idleDays} дн`}</div>
      <div className="cns-c cns-c-act">
        {item.request_id ? (
          <span className="cns-mini-ghost">{item.request_number || 'заявка'}</span>
        ) : state !== 'ok' ? (
          <button
            type="button" className="cns-mini"
            onClick={(e) => { e.stopPropagation(); onOrder(item.id); }}
          >
            Заказать
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─── Карточка позиции ───────────────────────────────────────────────────────
const MOVE_LABEL = { out: 'выдано', in: 'приход', inventory: 'пересчёт', writeoff: 'списано' };

function ItemSheet({ row, moves, onClose, onTake, onEmpty, onOrder, onReceive, onRedTag, onDropRedTag }) {
  const { item, state } = row;
  const [receiveQty, setReceiveQty] = useState(String(row.reorderQty || 1));
  const [reason, setReason] = useState('');
  const [askTag, setAskTag] = useState(false);

  // Клик мимо карточки её не закрывает: набранное количество и причина пропали бы
  // от случайного касания рядом, а на телефоне ещё и от закрытия нативного списка
  // (сквозной клик, см. modalEscape). Выход — крестик или Escape.
  const backdropRef = useModalEscape(onClose);

  return (
    <div className="cns-backdrop" ref={backdropRef} role="presentation">
      <div className="cns-sheet" role="dialog" aria-modal="true">
        <header className={`cns-sheet-head is-${state}`}>
          <div>
            <h3>{item.name}</h3>
            <p>
              {item.category} · {item.location || 'без адреса'}
              {item.supplier ? ` · ${item.supplier}` : ''}
            </p>
          </div>
          <button type="button" className="cns-sheet-close" onClick={onClose} aria-label="Закрыть"><Icon name="x" size={18} /></button>
        </header>

        <div className="cns-sheet-body">
          <div className="cns-sheet-figures">
            <div className={`cns-fig is-${state}`}>
              <span className="cns-fig-label">остаток</span>
              <b>{stockText(row)}</b>
              <span className="cns-fig-note">{STATE_META[state].label}</span>
            </div>
            {item.tracked && (
              <>
                <div className="cns-fig">
                  <span className="cns-fig-label">точка заказа</span><b>{item.min_qty}</b>
                  <span className="cns-fig-note">ниже — сигнал</span>
                </div>
                <div className="cns-fig">
                  <span className="cns-fig-label">дозаказать до</span><b>{item.max_qty}</b>
                  <span className="cns-fig-note">нужно {row.reorderQty} {item.unit}</span>
                </div>
              </>
            )}
            <div className="cns-fig">
              <span className="cns-fig-label">последняя цена</span><b>{item.last_price ? money(item.last_price) : '—'}</b>
              <span className="cns-fig-note">за {item.unit}</span>
            </div>
          </div>

          {(row.expiry === 'expired' || row.expiry === 'soon') && (
            <div className={`cns-sheet-warn${row.expiry === 'expired' ? ' is-bad' : ''}`}>
              <Icon name="clock" size={14} />
              {row.expiry === 'expired'
                ? `Срок годности вышел ${ddl(item.shelf_life_until)} — в работу не пускать.`
                : `Срок годности до ${ddl(item.shelf_life_until)} — осталось ${row.expiryDays} дн.`}
            </div>
          )}
          {row.dead && (
            <div className="cns-sheet-warn">
              <Icon name="warning" size={14} />
              Не двигалось {row.idleDays} дней. Возможно, это мёртвый запас — повесьте красный ярлык.
            </div>
          )}
          {item.red_tag && (
            <div className="cns-sheet-warn is-tag">
              <Icon name="pin" size={14} />
              Красный ярлык с {ddl(item.red_tag.at)}: {item.red_tag.reason || 'без причины'}.
              Решение нужно принять до {ddl(item.red_tag.at + 30 * 86400000)}.
              <button type="button" className="cns-mini" onClick={() => onDropRedTag(item.id)}>Снять ярлык</button>
            </div>
          )}

          <div className="cns-sheet-acts">
            {item.tracked ? (
              <button type="button" className="cns-big" disabled={(Number(item.qty) || 0) <= 0} onClick={() => onTake(item.id)}>
                <Icon name="minus" size={16} />Взял 1 {item.unit}
              </button>
            ) : (
              <button type="button" className={`cns-big${item.empty ? ' is-on' : ''}`} onClick={() => onEmpty(item.id, !item.empty)}>
                <Icon name={item.empty ? 'refresh' : 'x'} size={16} />{item.empty ? 'Пополнено' : 'Кончилось'}
              </button>
            )}
            {!item.request_id && state !== 'ok' && (
              <button type="button" className="cns-big is-primary" onClick={() => onOrder(item.id)}>
                <Icon name="cart" size={16} />Заказать {row.reorderQty} {item.unit}
              </button>
            )}
            {item.request_id && (
              <span className="cns-big is-ghost"><Icon name="cart" size={16} />Заявка {item.request_number} в работе</span>
            )}
          </div>

          <div className="cns-receive">
            <label>Принять приход</label>
            <input
              type="number" min="0" step="1" inputMode="numeric"
              value={receiveQty} onChange={(e) => setReceiveQty(e.target.value)}
            />
            <span className="cns-receive-unit">{item.unit}</span>
            <button
              type="button" className="cns-mini is-primary"
              disabled={!(Number(receiveQty) > 0)}
              onClick={() => onReceive(item.id, Number(receiveQty))}
            >
              <Icon name="check" size={14} />Оприходовать
            </button>
          </div>

          {!item.red_tag && (
            askTag ? (
              <div className="cns-receive">
                <label>Причина ярлыка</label>
                <input placeholder="напр. непонятно чьё, лежит без движения" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="button" className="cns-mini is-primary" onClick={() => { onRedTag(item.id, reason); setAskTag(false); setReason(''); }}>
                  Повесить
                </button>
                <button type="button" className="cns-mini" onClick={() => setAskTag(false)}>Отмена</button>
              </div>
            ) : (
              <button type="button" className="cns-tag-btn" onClick={() => setAskTag(true)}>
                <Icon name="pin" size={14} />Повесить красный ярлык
              </button>
            )
          )}

          <div className="cns-moves">
            <div className="cns-moves-head">Журнал движений</div>
            {moves.length === 0 ? (
              <p className="cns-moves-empty">Пока пусто — движения появятся, как только позицию начнут брать и принимать.</p>
            ) : (
              <ul>
                {moves.map((m, i) => (
                  <li key={m.id || i}>
                    <span className="cns-move-date">{dd(m.at)}</span>
                    <span className={`cns-move-type is-${m.type}`}>{MOVE_LABEL[m.type] || m.type}</span>
                    <span className="cns-move-delta">{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                    <span className="cns-move-who">{m.by_name || '—'}</span>
                    <span className="cns-move-note">{m.note || ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Аудит 5S ───────────────────────────────────────────────────────────────
function AuditPane({ audit, audits, onScore, onSave, summary }) {
  const total = auditTotal(audit.scores || {});
  const verdict = auditVerdict(total);
  const trend = audits.slice(-12);
  const maxBar = 10;

  return (
    <div className="cns-audit">
      <div className="cns-audit-main">
        <div className="cns-audit-intro">
          <h3>Еженедельный обход склада</h3>
          <p>
            Пять шагов, каждый — от 0 до 2 баллов. Занимает пять минут и делает 5S
            измеримым: без регулярной оценки полки возвращаются в исходное состояние
            примерно за два месяца.
          </p>
        </div>

        <ul className="cns-steps">
          {FIVE_S.map((step, i) => {
            const val = audit.scores?.[step.id];
            return (
              <li key={step.id} className="cns-step">
                <span className="cns-step-num">{i + 1}S</span>
                <div className="cns-step-text">
                  <b>{step.title}</b>
                  <span>{step.hint}</span>
                </div>
                <div className="cns-scores">
                  {[0, 1, 2].map((n) => (
                    <button
                      key={n} type="button"
                      className={`cns-score is-${n}${val === n ? ' active' : ''}`}
                      onClick={() => onScore(step.id, n)}
                    >
                      {n}<em>{SCORE_LABELS[n]}</em>
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="cns-audit-foot">
          <div className={`cns-audit-total is-${verdict.tone}`}>
            <b>{total}</b><span>из 10 · {verdict.label}</span>
          </div>
          <button type="button" className="cns-big is-primary" onClick={onSave}>
            <Icon name="check" size={16} />Сохранить обход
          </button>
        </div>
      </div>

      <aside className="cns-audit-side">
        <div className="cns-audit-card">
          <div className="cns-audit-card-head">Динамика по обходам</div>
          {trend.length === 0 ? (
            <p className="cns-moves-empty">Обходов ещё не было.</p>
          ) : (
            <>
              <div className="cns-trend">
                {trend.map((t, i) => (
                  <div key={i} className="cns-trend-col" title={`${ddl(t.at)}: ${t.total} из 10`}>
                    <div
                      className={`cns-trend-bar is-${auditVerdict(t.total).tone}`}
                      style={{ height: `${Math.max(6, (t.total / maxBar) * 100)}%` }}
                    />
                    <span>{dd(t.at)}</span>
                  </div>
                ))}
              </div>
              <p className="cns-trend-note">
                Последний обход: <b>{trend[trend.length - 1].total} из 10</b>
              </p>
            </>
          )}
        </div>

        <div className="cns-audit-card">
          <div className="cns-audit-card-head">Что подсказывает сам склад</div>
          <ul className="cns-audit-hints">
            <li><b>{summary.redTag ?? 0}</b> в красной зоне — решение по каждой нужно за 30 дней</li>
            <li><b>{summary.dead ?? 0}</b> не двигалось больше {DEAD_DAYS} дней</li>
            <li><b>{summary.expiring ?? 0}</b> с истекающим сроком годности</li>
            <li><b>{summary.out ?? 0}</b> кончилось прямо сейчас</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
