/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the «Запчасти» screen — NO Firebase, NO auth, seed data in
// memory. Renders the SAME <PartsScreen> + usePartsController as the real screen
// (Parts.jsx), so this is a faithful, credential-free preview of the reference
// visual (Диспетчерская.dc.html). Seed mirrors BACKEND_SPEC seedParts/seedPaint.
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import PartsScreen from '../components/PartsScreen';
import { usePartsController } from '../usePartsController';
import { normalizePart } from '../parts';

const SUPPLIERS = ['Exist', 'Emex', 'Разборка', 'Химснаб'];

const SEED_JOBS = [
  {
    id: 'gag', car_model: 'GAG trumchi', plate_number: 'B122MM24', order_number: '98', client_name: 'Сергеев А. П.', discount: 8000, payment_type: 'insurance',
    cell_ids: ['A-01-01', 'B-02-03'],
    // Два убытка: у машины с несколькими делами вместо бинарной лампочки показывается
    // селектор потока (лампочка не выразила бы, В КАКОЕ дело нести позицию).
    claims: [
      { id: 'insurance', claim_number: 'PVU-1234567', order_number: 'ЗН-98' },
      { id: 'cl_x7', claim_number: 'PVU-9998877', order_number: 'ЗН-142' },
    ],
    paint: { code: '676 Чёрный', type: 'Металлик', volume: '1.2 кг', status: 'mixing', cost: 4200 },
    parts: [
      { id: 'p1', name: 'Лонжерон передний правый', code: '50710-TVA', qty: 1, supplier: 'Exist', cost: 24500, price: 34000, status: 'in', kind: 'new', orderedAt: '26.06', eta: '29.06' },
      { id: 'p2', name: 'Крыло переднее правое', code: '53801-06', qty: 1, supplier: 'Разборка', cost: 9000, price: 18000, status: 'arrived', kind: 'used', orderedAt: '02.07', eta: '05.07', comment: 'Б/У, состояние хорошее — фото у экспедитора' },
      // Позиция второго страхового дела (payer = id потока).
      { id: 'p2b', name: 'Дверь задняя левая', code: '67003-42', qty: 1, supplier: 'Exist', cost: 21000, price: 31000, status: 'need', kind: 'new', payer: 'cl_x7' },
      // Допродажа клиента (payer:'client') — оплачивает сам, отдельным документом.
      { id: 'p3', name: 'Коврики салона', code: '', qty: 4, supplier: '', cost: 0, price: 3000, status: 'need', kind: 'new', payer: 'client' },
    ],
  },
  {
    id: 'toyota', car_model: 'TOYOTA CAMRY', plate_number: 'K456TT124', order_number: '110', client_name: 'Смирнов В.',
    cell_ids: ['A-03-05'],
    paint: { code: '202 Чёрный', type: 'База', volume: '1.5 кг', status: 'matching', cost: 0 },
    parts: [
      { id: 'p9', name: 'Фара левая', code: '81150-33', replArticle: 'DEPO 212-11N9', qty: 1, supplier: 'Exist', cost: 18700, price: 26000, status: 'ordered', kind: 'analog', orderedAt: '01.07', eta: '04.07' },
      { id: 'p10', name: 'Решётка радиатора', code: '', qty: 1, supplier: 'Emex', cost: 0, price: 9000, status: 'ordered', kind: 'new', orderedAt: '02.07', eta: '06.07' },
      { id: 'p11', name: 'Бампер передний', code: '52119-06', qty: 1, supplier: 'Exist', cost: 0, price: 24000, status: 'need', kind: 'new' },
    ],
  },
  {
    id: 'lada', car_model: 'LADA VESTA', plate_number: 'A007KX124', order_number: '102', client_name: 'Кузнецов Д.',
    cell_ids: ['A-01-04'],
    paint: { code: '420 Синий', type: 'База', volume: '1.0 кг', status: 'need', cost: 0 },
    parts: [
      { id: 'p6', name: 'Порог левый', code: '', qty: 1, supplier: 'Emex', cost: 0, price: 15000, status: 'ordered', kind: 'new', orderedAt: '28.06', eta: '01.07' },
    ],
  },
];

// Ячейки — в той же форме, что их отдаёт боевой экран (Parts.jsx): { orderNum, parts }.
// Машина находит свои по СВОЕМУ cell_ids, а не по гос.номеру. Форма демо обязана
// совпадать с боевой: именно расхождение (демо передавало payment_type, прод — нет)
// на месяц спрятало то, что лампочка «страховая ↔ допродажа» в проде не работала.
const SEED_CELLS = {
  'A-01-01': { orderNum: 'ЗН-98', parts: [{ qty: 1 }, { qty: 1 }] },
  'B-02-03': { orderNum: 'ЗН-98', parts: [{ qty: 4 }] },
  'A-03-05': { orderNum: 'ЗН-110', parts: [{ qty: 1 }, { qty: 1 }] },
  'A-01-04': { orderNum: 'ЗН-102', parts: [{ qty: 1 }] },
};

function Demo() {
  // Static "remote" snapshot; no `ops` → edits stay in memory (no Firestore).
  const seed = useMemo(() => SEED_JOBS.map((j) => ({ ...j, parts: j.parts.map(normalizePart) })), []);
  const { vm, filter, search, handlers, prompts } = usePartsController({ remoteJobs: seed, cells: SEED_CELLS });

  const banner = (
    <div style={{ padding: '9px 22px', background: 'var(--bg2)', borderBottom: '1px solid var(--line)', fontFamily: "'JetBrains Mono',monospace", fontSize: '11.5px', color: 'var(--text3)' }}>
      ДЕМО · экран «Запчасти» (визуальный эталон) · правила §12.2 рентабельность только по cost&gt;0 и §13 нельзя «Заказать» без поставщика+себестоимости · данные в памяти, без Firebase
    </div>
  );

  return <PartsScreen vm={vm} filter={filter} search={search} supplierNames={SUPPLIERS} banner={banner} {...handlers} {...prompts} />;
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
