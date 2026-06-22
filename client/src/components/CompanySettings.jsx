import { useEffect, useState } from 'react';
import { api } from '../api';

const EMPTY = { name: '', inn: '', ogrn: '', address: '', phone: '', director: '' };

export default function CompanySettings() {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const company = await api.settings.getCompany();
      setForm({ ...EMPTY, ...company });
      setLoading(false);
    })();
  }, []);

  async function save() {
    await api.settings.updateCompany(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="panel panel-wide">
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      </div>
    );
  }

  return (
    <div className="panel panel-wide">
      <h3>Реквизиты компании</h3>
      <p className="panel-hint">Эти данные печатаются на заказ-нарядах и актах. Заполните один раз.</p>
      <div className="company-grid">
        <input placeholder="Название (напр. ИП Иванов И.И. / ООО «Авто Академия»)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="ИНН" value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value })} />
        <input placeholder="ОГРН / ОГРНИП" value={form.ogrn} onChange={(e) => setForm({ ...form, ogrn: e.target.value })} />
        <input placeholder="Адрес" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <input placeholder="Телефон" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder="Руководитель / мастер-приёмщик (ФИО для подписи)" value={form.director} onChange={(e) => setForm({ ...form, director: e.target.value })} />
      </div>
      <div className="inline-form">
        <button className="primary" onClick={save}>Сохранить реквизиты</button>
        {saved && <span className="company-saved">Сохранено ✓</span>}
      </div>
    </div>
  );
}
