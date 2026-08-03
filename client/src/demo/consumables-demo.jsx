/* eslint-disable react-refresh/only-export-components */
// Standalone-демо экрана «Расходники» — БЕЗ Firebase, БЕЗ авторизации, сид в
// памяти. Рисует ТОТ ЖЕ <ConsumablesView> через ТУ ЖЕ вью-модель
// buildConsumables, что и будущий реальный экран, так что это точный
// предпросмотр без прод-данных.
//
// Сид покрывает все ветки: учётные позиции (группа A) в трёх состояниях,
// канбан-позиции (B/C), просроченный и истекающий ЛКМ, мёртвый запас,
// позицию с красным ярлыком, позицию с уже созданной заявкой и позицию без
// адреса. Все кнопки живые — состояние меняется в памяти вкладки.
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ConsumablesView from '../components/ConsumablesView';
import { buildConsumables, groupByShelf, auditTotal } from '../consumables';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

const D = 86400000;
const now = Date.now();
const ago = (n) => now - n * D;
const ahead = (n) => now + n * D;

// Учётная позиция (группа A) — считаем количество.
const A = (o) => ({ tracked: true, unit: 'шт', active: true, last_move_at: ago(3), ...o });
// Канбан-позиция (B/C) — только «есть / кончилось».
const K = (o) => ({ tracked: false, empty: false, unit: 'упак', max_qty: 2, active: true, last_move_at: ago(6), ...o });

const SEED = [
  // ── Стеллаж С1: ЛКМ ──────────────────────────────────────────────────────
  A({ id: 'c1', name: 'Лак 2К HS', category: 'ЛКМ (лак, грунт, краска)', unit: 'л',
    qty: 0, min_qty: 2, max_qty: 8, location: 'С1-A-01', supplier: 'КрасДеталь',
    last_price: 2400, shelf_life_until: ahead(210), last_move_at: ago(1) }),
  A({ id: 'c2', name: 'Грунт эпоксидный', category: 'ЛКМ (лак, грунт, краска)', unit: 'л',
    qty: 2, min_qty: 2, max_qty: 6, location: 'С1-A-02', supplier: 'КрасДеталь',
    last_price: 1850, shelf_life_until: ahead(18), last_move_at: ago(2) }),
  A({ id: 'c3', name: 'Отвердитель к лаку', category: 'ЛКМ (лак, грунт, краска)', unit: 'л',
    qty: 5, min_qty: 2, max_qty: 6, location: 'С1-A-03', supplier: 'КрасДеталь',
    last_price: 1600, shelf_life_until: ahead(120) }),
  A({ id: 'c4', name: 'Разбавитель акриловый', category: 'ЛКМ (лак, грунт, краска)', unit: 'л',
    qty: 9, min_qty: 3, max_qty: 12, location: 'С1-B-01', supplier: 'КрасДеталь', last_price: 780 }),
  A({ id: 'c5', name: 'Грунт-наполнитель серый', category: 'ЛКМ (лак, грунт, краска)', unit: 'л',
    qty: 1, min_qty: 2, max_qty: 6, location: 'С1-B-02', supplier: 'КрасДеталь',
    last_price: 1400, shelf_life_until: ago(12), last_move_at: ago(40) }),

  // ── Стеллаж С2: абразив и малярный расходник ─────────────────────────────
  A({ id: 'c6', name: 'Круг P400 (150 мм)', category: 'Абразив', unit: 'упак',
    qty: 1, min_qty: 2, max_qty: 6, location: 'С2-A-01', supplier: 'Мирка-Сибирь', last_price: 1150 }),
  A({ id: 'c7', name: 'Круг P800 (150 мм)', category: 'Абразив', unit: 'упак',
    qty: 4, min_qty: 2, max_qty: 6, location: 'С2-A-02', supplier: 'Мирка-Сибирь', last_price: 1250 }),
  A({ id: 'c8', name: 'Наждачная бумага P240 в листах', category: 'Абразив', unit: 'лист',
    qty: 0, min_qty: 20, max_qty: 100, location: 'С2-A-03', supplier: 'Мирка-Сибирь',
    last_price: 45, request_id: 'r-777', request_number: 'ЗАК-2026-0051' }),
  K({ id: 'c9', name: 'Лента малярная 19 мм', category: 'Малярный расходник', unit: 'рулон',
    max_qty: 10, location: 'С2-B-01', supplier: 'Мирка-Сибирь', last_price: 210 }),
  K({ id: 'c10', name: 'Плёнка укрывная 4×5 м', category: 'Малярный расходник',
    empty: true, max_qty: 5, location: 'С2-B-02', supplier: 'Мирка-Сибирь', last_price: 340 }),
  K({ id: 'c11', name: 'Бумага маскировочная', category: 'Малярный расходник', unit: 'рулон',
    max_qty: 3, location: 'С2-B-03', last_price: 690 }),
  A({ id: 'c12', name: 'Полироль абразивная 3M (старая партия)', category: 'Абразив', unit: 'шт',
    qty: 6, min_qty: 1, max_qty: 4, location: 'С2-C-01', last_price: 2100, last_move_at: ago(160) }),

  // ── Стеллаж С3: химия и СИЗ ──────────────────────────────────────────────
  A({ id: 'c13', name: 'Обезжириватель антисиликон', category: 'Химия', unit: 'л',
    qty: 3, min_qty: 3, max_qty: 10, location: 'С3-A-01', supplier: 'ХимТорг', last_price: 520 }),
  K({ id: 'c14', name: 'Перчатки нитриловые L', category: 'СИЗ',
    max_qty: 4, location: 'С3-B-01', supplier: 'СпецОдежда24', last_price: 320 }),
  K({ id: 'c15', name: 'Респиратор-полумаска (фильтры)', category: 'СИЗ',
    empty: true, max_qty: 2, location: 'С3-B-02', supplier: 'СпецОдежда24', last_price: 890 }),
  K({ id: 'c16', name: 'Салфетки безворсовые', category: 'Химия',
    max_qty: 6, location: 'С3-A-02', last_price: 180 }),
  A({ id: 'c17', name: 'Ветошь х/б', category: 'Прочее', unit: 'кг',
    qty: 12, min_qty: 5, max_qty: 20, location: 'С3-C-01', last_price: 140 }),

  // ── Стеллаж С4: крепёж + разбор ──────────────────────────────────────────
  K({ id: 'c18', name: 'Клипсы бампера (ассорти)', category: 'Крепёж и мелочёвка',
    max_qty: 2, location: 'С4-A-01', last_price: 950, last_move_at: ago(20) }),
  A({ id: 'c19', name: 'Саморезы кузовные 4.2×16', category: 'Крепёж и мелочёвка',
    qty: 340, min_qty: 100, max_qty: 500, location: 'С4-A-02', last_price: 3, last_move_at: ago(11) }),
  A({ id: 'c20', name: 'Герметик шовный (непонятно чей)', category: 'Химия', unit: 'шт',
    qty: 3, min_qty: 1, max_qty: 3, location: 'С4-B-01', last_price: 700, last_move_at: ago(220),
    red_tag: { at: ago(9), by: 'zap@academyauto.ru', reason: 'никто не знает, откуда взялось' } }),

  // ── Без адреса: то, что ещё не разложили по 5S ───────────────────────────
  A({ id: 'c21', name: 'Абразивная сетка P180', category: 'Абразив', unit: 'упак',
    qty: 2, min_qty: 1, max_qty: 4, location: '', last_price: 640, last_move_at: ago(30) }),
];

const SEED_MOVES = {
  c1: [
    { id: 'm1', type: 'out', delta: -1, at: ago(1), by_name: 'Иванов А.', note: 'CAMRY K456TT' },
    { id: 'm2', type: 'out', delta: -1, at: ago(4), by_name: 'Петров И.', note: 'RIO A007KX' },
    { id: 'm3', type: 'in', delta: 4, at: ago(21), by_name: 'Сергеев (запчастист)', note: 'ЗАК-2026-0038' },
  ],
  c6: [
    { id: 'm4', type: 'out', delta: -1, at: ago(3), by_name: 'Иванов А.', note: '' },
    { id: 'm5', type: 'inventory', delta: -1, at: ago(30), by_name: 'Сергеев (запчастист)', note: 'месячный пересчёт' },
  ],
};

const SEED_AUDITS = [
  { id: 'a1', at: ago(35), scores: { s1: 0, s2: 1, s3: 1, s4: 0, s5: 1 }, total: 3 },
  { id: 'a2', at: ago(28), scores: { s1: 1, s2: 1, s3: 1, s4: 1, s5: 1 }, total: 5 },
  { id: 'a3', at: ago(21), scores: { s1: 1, s2: 2, s3: 1, s4: 1, s5: 1 }, total: 6 },
  { id: 'a4', at: ago(14), scores: { s1: 2, s2: 2, s3: 1, s4: 1, s5: 1 }, total: 7 },
  { id: 'a5', at: ago(7), scores: { s1: 2, s2: 2, s3: 2, s4: 1, s5: 1 }, total: 8 },
];

let reqSeq = 52;
let moveSeq = 100;

function Demo() {
  const [items, setItems] = useState(SEED);
  const [moves, setMoves] = useState(SEED_MOVES);
  const [audits, setAudits] = useState(SEED_AUDITS);
  const [scores, setScores] = useState({ s1: 2, s2: 2, s3: 2, s4: 1, s5: 1 });

  const [view, setView] = useState('board');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('state');
  const [openId, setOpenId] = useState(null);
  const [notice, setNotice] = useState('');

  const vm = useMemo(() => buildConsumables(items, { filter, category, query, sort }, now), [items, filter, category, query, sort]);
  const groups = useMemo(() => groupByShelf(vm.rows), [vm.rows]);
  const openRow = useMemo(() => {
    if (!openId) return null;
    const item = items.find((i) => i.id === openId);
    if (!item) return null;
    return buildConsumables([item], { filter: 'all' }, now).rows[0] || null;
  }, [openId, items]);

  const say = (msg) => { setNotice(msg); window.clearTimeout(say.t); say.t = window.setTimeout(() => setNotice(''), 4500); };
  const patch = (id, fn) => setItems((xs) => xs.map((i) => (i.id === id ? { ...i, ...fn(i) } : i)));
  const addMove = (id, move) => setMoves((m) => ({ ...m, [id]: [{ id: `m${moveSeq++}`, ...move }, ...(m[id] || [])] }));

  // Мастер взял единицу. В реальном экране это же действие пишет движение в
  // consumableMoves и, если остаток упал ниже минимума, само создаёт заявку.
  function onTake(id) {
    const item = items.find((i) => i.id === id);
    if (!item || (Number(item.qty) || 0) <= 0) return;
    const qty = Number(item.qty) - 1;
    patch(id, () => ({ qty, last_move_at: now }));
    addMove(id, { type: 'out', delta: -1, at: now, by_name: 'Вы (демо)', note: '' });
    if (qty <= Number(item.min_qty) && !item.request_id) say(`«${item.name}»: остаток ниже минимума — пора заказывать.`);
  }

  function onEmpty(id, empty) {
    const item = items.find((i) => i.id === id);
    patch(id, () => ({ empty, last_move_at: now }));
    say(empty ? `«${item.name}» помечено как кончившееся.` : `«${item.name}» снова есть на полке.`);
  }

  // Сигнал дозаказа уходит в СУЩЕСТВУЮЩИЙ экран «Заявки» — новой сущности нет.
  function onOrder(id) {
    const item = items.find((i) => i.id === id);
    const number = `ЗАК-2026-${String(++reqSeq).padStart(4, '0')}`;
    patch(id, () => ({ request_id: `r-${number}`, request_number: number }));
    say(`Заявка ${number} создана и ушла управленцу на одобрение — «${item.name}».`);
  }

  // Приход с экрана «Закупки»: плюс на склад, заявка закрывается.
  function onReceive(id, qty) {
    const item = items.find((i) => i.id === id);
    if (!item || !(qty > 0)) return;
    patch(id, (i) => (i.tracked
      ? { qty: (Number(i.qty) || 0) + qty, request_id: null, request_number: null, last_move_at: now }
      : { empty: false, request_id: null, request_number: null, last_move_at: now }));
    addMove(id, { type: 'in', delta: qty, at: now, by_name: 'Вы (демо)', note: item.request_number || 'приход' });
    say(`Оприходовано ${qty} ${item.unit} — «${item.name}».`);
  }

  function onRedTag(id, reason) {
    patch(id, () => ({ red_tag: { at: now, by: 'demo', reason } }));
    say('Красный ярлык повешен. Решение по позиции нужно принять за 30 дней.');
  }
  function onDropRedTag(id) {
    patch(id, () => ({ red_tag: null }));
    say('Ярлык снят.');
  }

  function onSaveAudit() {
    const total = auditTotal(scores);
    setAudits((xs) => [...xs, { id: `a${xs.length + 1}`, at: now, scores: { ...scores }, total }]);
    say(`Обход сохранён: ${total} из 10.`);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: 18 }}>
      <ConsumablesView
        loading={false}
        rows={vm.rows} counts={vm.counts} summary={vm.summary} groups={groups}
        view={view} onView={setView}
        filter={filter} onFilter={setFilter}
        category={category} onCategory={setCategory}
        query={query} onQuery={setQuery}
        sort={sort} onSort={setSort}
        onTake={onTake} onEmpty={onEmpty} onOrder={onOrder}
        onReceive={onReceive} onRedTag={onRedTag} onDropRedTag={onDropRedTag}
        onOpen={setOpenId} onClose={() => setOpenId(null)}
        openRow={openRow} moves={openId ? (moves[openId] || []) : []}
        onScan={() => say('В приложении здесь откроется камера: навёл на этикетку полки — открылась карточка позиции.')}
        audit={{ scores }} audits={audits}
        onScore={(step, n) => setScores((s) => ({ ...s, [step]: n }))}
        onSaveAudit={onSaveAudit}
        notice={notice}
      />
      <p style={{ maxWidth: 1240, margin: '22px auto 0', padding: '0 2px', fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
        Демо-макет на выдуманных данных: ничего не сохраняется, обновление страницы всё вернёт.
        Кнопки живые — попробуйте «Взял», «Кончилось», «Заказать», откройте карточку позиции и вкладку «Аудит 5S».
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
