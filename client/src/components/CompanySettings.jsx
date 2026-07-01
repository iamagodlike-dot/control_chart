import { useEffect, useState } from 'react';
import { api } from '../api';

const EMPTY = {
  name: '', inn: '', kpp: '', ogrn: '', address: '', phone: '', director: '',
  bank_name: '', bik: '', account: '', corr_account: '', vat_mode: 'none',
  workHourStart: 8, workHourEnd: 20,
};

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
        <input placeholder="КПП (для ООО; ИП не нужен)" value={form.kpp} onChange={(e) => setForm({ ...form, kpp: e.target.value })} />
      </div>

      <h3>Банковские реквизиты (для счетов)</h3>
      <p className="panel-hint">Печатаются на счёте и кодируются в платёжный QR. Заполните один раз.</p>
      <div className="company-grid">
        <input placeholder="Банк получателя (напр. Банк ТОЧКА ПАО)" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
        <input placeholder="БИК" value={form.bik} onChange={(e) => setForm({ ...form, bik: e.target.value })} />
        <input placeholder="Расчётный счёт (р/с)" value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} />
        <input placeholder="Корр. счёт (к/с)" value={form.corr_account} onChange={(e) => setForm({ ...form, corr_account: e.target.value })} />
        <label className="job-form-field">
          <span>НДС в счетах</span>
          <select value={form.vat_mode} onChange={(e) => setForm({ ...form, vat_mode: e.target.value })}>
            <option value="none">Без НДС (УСН)</option>
            <option value="vat20">НДС 20% (ОСН)</option>
          </select>
        </label>
      </div>

      <h3>Рабочие часы</h3>
      <p className="panel-hint">Нерабочее время на графике сжимается, чтобы не занимало место — но остаётся доступным для овертайма.</p>
      <div className="company-grid">
        <label className="job-form-field">
          <span>Начало рабочего дня (час)</span>
          <input type="number" min="0" max="23" value={form.workHourStart} onChange={(e) => setForm({ ...form, workHourStart: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })} />
        </label>
        <label className="job-form-field">
          <span>Конец рабочего дня (час)</span>
          <input type="number" min="1" max="24" value={form.workHourEnd} onChange={(e) => setForm({ ...form, workHourEnd: Math.max(1, Math.min(24, Number(e.target.value) || 24)) })} />
        </label>
      </div>
      <div className="inline-form">
        <button className="primary" onClick={save}>Сохранить реквизиты</button>
        {saved && <span className="company-saved">Сохранено ✓</span>}
      </div>
    </div>
  );
}
