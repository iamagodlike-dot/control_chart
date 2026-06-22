import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';

const EMPTY = { car_model: '', plate_number: '', client_name: '', client_phone: '', order_number: '', expected_at: '', notes: '' };

export default function Queue({ onStart }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);

  const load = async () => {
    const list = await api.queue.list();
    setItems([...list].reverse()); // oldest first — true queue order
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.car_model.trim()) return alert('Укажите марку/модель автомобиля');
    await api.queue.create({
      ...form,
      expected_at: form.expected_at ? dayjs(form.expected_at).toISOString() : null,
    });
    setForm(EMPTY);
    load();
  }

  async function remove(id) {
    if (!confirm('Убрать машину из очереди?')) return;
    await api.queue.remove(id);
    load();
  }

  if (loading) {
    return (
      <div className="panel">
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      </div>
    );
  }

  return (
    <div className="panel queue-panel">
      <h3>Очередь — машины, которые ещё не заехали</h3>
      <div className="queue-form">
        <input placeholder="Марка и модель *" value={form.car_model} onChange={(e) => setForm({ ...form, car_model: e.target.value })} />
        <input placeholder="Гос. номер" value={form.plate_number} onChange={(e) => setForm({ ...form, plate_number: e.target.value })} />
        <input placeholder="№ заказ-наряда" value={form.order_number} onChange={(e) => setForm({ ...form, order_number: e.target.value })} />
        <input placeholder="Клиент" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
        <input placeholder="Телефон" value={form.client_phone} onChange={(e) => setForm({ ...form, client_phone: e.target.value })} />
        <label className="job-form-field">
          <span>Ожидаемая дата заезда</span>
          <input type="datetime-local" value={form.expected_at} onChange={(e) => setForm({ ...form, expected_at: e.target.value })} />
        </label>
        <textarea className="job-form-full" placeholder="Примечания" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <button className="primary" onClick={add}>+ Добавить в очередь</button>
      </div>

      {items.length === 0 ? (
        <div className="list-empty">Очередь пуста — добавьте машину, которая ещё не приехала</div>
      ) : (
        <div className="queue-list">
          {items.map((it, i) => (
            <div className="queue-item" key={it.id}>
              <div className="queue-item-pos">#{i + 1}</div>
              <div className="queue-item-body">
                <div className="job-item-title">{it.car_model}{it.order_number ? <span className="job-item-order"> №{it.order_number}</span> : ''}</div>
                <div className="job-item-sub">{it.plate_number || '—'} {it.client_name ? `· ${it.client_name}` : ''} {it.client_phone ? `· ${it.client_phone}` : ''}</div>
                {it.expected_at && <div className="job-item-deadline">⏰ ожидается {dayjs(it.expected_at).format('DD.MM HH:mm')}</div>}
                {it.notes && <div className="queue-item-notes">{it.notes}</div>}
              </div>
              <div className="queue-item-actions">
                <button className="primary small" onClick={() => onStart(it)}>🔧 Запустить в работу</button>
                <button className="danger small" onClick={() => remove(it.id)}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
