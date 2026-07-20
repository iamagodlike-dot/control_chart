import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { auth } from '../firebase';
import { sortRequestsNewest, requestsByStatus } from '../requests';
import PurchasingView from './PurchasingView';

// Container for «Закупки»: the expeditor sees approved requests, marks them bought
// with a price, and that price becomes a трата (category «Расходники») via
// api.requests.markPurchased → api.expenses.create. Money is recorded exactly once.
export default function Purchasing() {
  const [requests, setRequests] = useState(null); // null → грузим
  const [prices, setPrices] = useState({}); // id → введённая цена
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try { setRequests(await api.requests.listAll()); }
    catch { setRequests([]); }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const toBuy = useMemo(() => sortRequestsNewest(requestsByStatus(requests || [], 'approved')), [requests]);
  const bought = useMemo(() => sortRequestsNewest(requestsByStatus(requests || [], 'purchased')).slice(0, 20), [requests]);

  async function onBuy(id) {
    setError('');
    const price = Number(prices[id]) || 0;
    if (price <= 0) { setError('Введите цену покупки больше нуля.'); return; }
    setBusy(id);
    try {
      await api.requests.markPurchased(id, { price, created_by_name: auth.currentUser?.displayName || undefined });
      setPrices((p) => { const next = { ...p }; delete next[id]; return next; });
      await load();
    } catch {
      setError('Не удалось отметить покупку. Проверьте связь и попробуйте ещё раз.');
    } finally { setBusy(null); }
  }

  return (
    <PurchasingView
      loading={requests === null}
      toBuy={toBuy}
      bought={bought}
      prices={prices}
      onPriceChange={(id, v) => setPrices((p) => ({ ...p, [id]: v }))}
      onBuy={onBuy}
      busy={busy}
      error={error}
    />
  );
}
