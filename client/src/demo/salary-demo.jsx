/* eslint-disable react-refresh/only-export-components */
// Standalone demo of Step 1 — «тип оплаты + аванс + оклад» в профиле мастера.
// NO Firebase, NO auth. Использует РЕАЛЬНЫЙ <PayFields> из PostsMasters и
// РЕАЛЬНЫЕ хелперы из salary.js, поэтому это честное превью, а не макет.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PayFields } from '../components/PostsMasters';
import { DEFAULT_PAY_TYPE, DEFAULT_ADVANCE, normalizeMasterPay, masterPaySummary } from '../salary';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

const emptyForm = () => ({
  name: '', specialty: '',
  pay_type: DEFAULT_PAY_TYPE, advance: String(DEFAULT_ADVANCE), salary: '',
});

const SEED = [
  { id: 'm1', name: 'Иванов', specialty: 'маляр', pay_type: 'piece', advance: 40000 },
  { id: 'm2', name: 'Петров', specialty: 'жестянщик', pay_type: 'fixed', advance: 40000, salary: 60000 },
  { id: 'm3', name: 'Сидорова (администратор)', pay_type: 'fixed', advance: 30000, salary: 55000 },
];

function Demo() {
  const [form, setForm] = useState(emptyForm());
  const [masters, setMasters] = useState(SEED);

  const patch = (p) => setForm({ ...form, ...p });

  function add() {
    if (!form.name.trim()) return;
    setMasters([...masters, {
      id: `m${masters.length + 1}`,
      name: form.name.trim(),
      specialty: form.specialty || '',
      ...normalizeMasterPay(form),
    }]);
    setForm(emptyForm());
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
      <div className="panel">
        <h3>Мастера</h3>
        <ul className="list">
          {masters.map((m) => (
            <li key={m.id}>
              <span className="list-icon list-icon--letter">{(m.name || '?').trim().charAt(0).toUpperCase()}</span>
              <span className="list-label">{m.name} <span className="list-sub">{`${m.specialty ? `— ${m.specialty} · ` : ''}${masterPaySummary(m)}`}</span></span>
            </li>
          ))}
        </ul>
        <div className="inline-form column">
          <input placeholder="Имя мастера" value={form.name} onChange={(e) => patch({ name: e.target.value })} />
          <input placeholder="Специализация" value={form.specialty} onChange={(e) => patch({ specialty: e.target.value })} />
          <PayFields form={form} onPatch={patch} />
          <button className="primary" onClick={add}>Добавить мастера</button>
        </div>
        <p className="panel-hint" style={{ marginTop: 12 }}>
          Переключите «Сдельная / Оклад» — поле «Оклад, ₽/мес» появляется только для оклада.
          Аванс по умолчанию 40&nbsp;000.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><Demo /></StrictMode>);
