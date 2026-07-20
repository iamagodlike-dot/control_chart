/* eslint-disable react-refresh/only-export-components */
// Standalone demo of the экспедитор «Закупки» screen — NO Firebase, NO auth,
// seed data in memory. Renders the SAME <PurchasingView> as the real screen
// (Purchasing), so it's a faithful, credential-free preview.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PurchasingView from '../components/PurchasingView';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

const TO_BUY = [
  { id: 'r2', item_name: 'Абразив P400', qty: 2, unit: 'упак', number: 'ЗК-2026-011', for_job_label: 'TOYOTA CAMRY · K456TT124', created_by_name: 'Иванов А.', comment: 'к покраске завтра', urgent: true },
  { id: 'r5', item_name: 'Грунт-порозаполнитель', qty: 1, unit: 'компл', number: 'ЗК-2026-013', created_by_name: 'Петров И.', urgent: false },
];

const BOUGHT = [
  { id: 'r3', item_name: 'Полироль 3M', qty: 1, unit: 'шт', number: 'ЗК-2026-008', for_job_label: 'KIA RIO · A007KX124', purchased_price: 1250 },
  { id: 'r6', item_name: 'Салфетки безворсовые', qty: 3, unit: 'упак', number: 'ЗК-2026-009', purchased_price: 540 },
];

function Demo() {
  const [toBuy, setToBuy] = useState(TO_BUY);
  const [bought, setBought] = useState(BOUGHT);
  const [prices, setPrices] = useState({ r5: '890' });
  const [busy] = useState(null);

  function onPriceChange(id, v) { setPrices((p) => ({ ...p, [id]: v })); }
  function onBuy(id) {
    const price = Number(prices[id]) || 0;
    if (price <= 0) return;
    const r = toBuy.find((x) => x.id === id);
    setToBuy((xs) => xs.filter((x) => x.id !== id));
    setBought((xs) => [{ ...r, purchased_price: price }, ...xs]);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <PurchasingView
        loading={false}
        toBuy={toBuy}
        bought={bought}
        prices={prices}
        onPriceChange={onPriceChange}
        onBuy={onBuy}
        busy={busy}
        error=""
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
