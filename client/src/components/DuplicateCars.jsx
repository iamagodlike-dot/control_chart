import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { genPartId } from '../parts';
import { isInsurance, PAYMENT_SHORT } from '../insurance';
import { findDuplicateGroups, mergePreview, tagServicesForPrimary } from '../dedupe';
import Icon from './Icon';

// Управленческий инструмент: находит машины-дубли (одна и та же машина, заведённая
// дважды — например, страховой ремонт + отдельная карточка под допродажи) по
// гос.номеру и сращивает их по подтверждению. Позиции дубля переносятся в основную
// (для страховой — как допродажи клиента), дубль уходит в архив (обратимо).

const fmtDate = (v) => { const d = dayjs(v); return d.isValid() ? d.format('DD.MM.YYYY') : '—'; };
const payLabel = (j) => PAYMENT_SHORT[j.payment_type] || 'Наличные';

function CarRow({ car, isPrimary, onPick }) {
  const ins = isInsurance(car);
  const works = (car.services || []).length;
  const parts = (car.parts || []).length;
  return (
    <label style={{
      display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
      border: '1px solid ' + (isPrimary ? 'var(--color-primary)' : 'var(--color-border)'),
      background: isPrimary ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'var(--color-surface)',
    }}>
      <input type="radio" checked={isPrimary} onChange={onPick} style={{ marginTop: 3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>{car.car_model || 'Без модели'}</b>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, padding: '2px 7px', border: '1px solid var(--color-border)', borderRadius: 6 }}>{car.plate_number || '—'}</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: ins ? 'color-mix(in srgb, var(--color-warning) 15%, transparent)' : 'var(--color-surface-alt)', color: ins ? 'var(--color-warning)' : 'var(--color-text-secondary)' }}>{payLabel(car)}</span>
          {isPrimary && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)' }}>ОСНОВНАЯ</span>}
        </div>
        <div style={{ marginTop: 5, fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
          <span>Клиент: {car.client_name || '—'}</span>
          <span>VIN: {car.vin || '—'}</span>
          <span>№ ЗН: {car.order_number || '—'}</span>
          <span>Заведена: {fmtDate(car.created_at)}</span>
          <span>Работ: {works} · Запчастей: {parts}</span>
        </div>
      </div>
    </label>
  );
}

export default function DuplicateCars() {
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [primaryByKey, setPrimaryByKey] = useState({}); // key → выбранный id основной
  const [busyKey, setBusyKey] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setJobs(await api.jobs.listAllBrief());
    } catch {
      setError('Не удалось загрузить машины. Попробуйте обновить страницу.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect

  const groups = useMemo(() => (jobs ? findDuplicateGroups(jobs) : []), [jobs]);
  const primaryId = (g) => primaryByKey[g.key] || g.suggestedPrimaryId;

  async function mergeGroup(g) {
    const pid = primaryId(g);
    const primary = g.cars.find((c) => c.id === pid);
    const dups = g.cars.filter((c) => c.id !== pid);
    if (!primary || !dups.length) return;
    const primaryIns = isInsurance(primary);
    const prev = mergePreview(primary, dups);
    const ok = window.confirm(
      `Срастить ${dups.length} машин(ы) в основную «${primary.car_model || ''} · ${primary.plate_number || ''}»?\n\n`
      + `• ${prev.services} работ и ${prev.parts} запчастей перенесутся в основную`
      + (primaryIns ? ' как ДОПРОДАЖИ клиента.' : '.') + '\n'
      + `• Дубли уйдут в архив (их можно вернуть кнопкой «Показать архив» на графике).\n`
      + `• Документы дублей останутся при них.`,
    );
    if (!ok) return;
    setBusyKey(g.key);
    setMessage('');
    try {
      // Свежие данные основной, чтобы не потерять чужие правки услуг.
      const fresh = await api.jobs.get(pid);
      let services = [...((fresh && fresh.services) || primary.services || [])];
      for (const dup of dups) {
        services = [...services, ...tagServicesForPrimary(dup.services, primaryIns).map((s) => ({ ...s, id: genPartId() }))];
      }
      await api.jobs.update(pid, { services });
      // Запчасти — пооперационно (транзакция + синхронизация склада), с новыми id.
      for (const dup of dups) {
        for (const p of (dup.parts || [])) {
          await api.jobs.savePart(pid, { ...p, id: genPartId(), payer: primaryIns ? 'client' : (p.payer || 'insurance') });
        }
        await api.jobs.archive(dup.id);
      }
      setMessage(`Готово: сращено ${dups.length} машин(ы) в «${primary.plate_number || primary.car_model || ''}». Перенесено работ ${prev.services}, запчастей ${prev.parts}.`);
      await load();
    } catch (e) {
      setError('Ошибка при сращивании: ' + (e && e.message ? e.message : String(e)));
    } finally {
      setBusyKey(null);
    }
  }

  const noteStyle = (color) => ({ padding: '9px 12px', margin: '4px 0 12px', borderRadius: 8, fontSize: 13, border: '1px solid ' + color, color, background: 'color-mix(in srgb, ' + color + ' 8%, transparent)' });

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Дубликаты машин</h3>
        <button className="small" onClick={load} disabled={loading}><Icon name="refresh" size={14} /> Обновить</button>
      </div>
      <p className="panel-hint">
        Ищем машины, заведённые дважды под одним <b>гос.номером</b> (например, страховой ремонт и отдельная
        карточка под допродажи). Выберите основную машину и нажмите «Срастить» — позиции остальных
        перенесутся в неё (для страховой — как допродажи клиента), а дубли уйдут в архив.
      </p>

      {message && <div style={noteStyle('var(--color-success)')}>{message}</div>}
      {error && <div style={noteStyle('var(--color-danger)')}>{error}</div>}

      {loading && <p className="panel-hint">Загружаем машины…</p>}
      {!loading && groups.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 4px', color: 'var(--color-text-secondary)' }}>
          <Icon name="check" size={18} /> Дубликатов по гос.номеру не найдено.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {groups.map((g) => {
          const pid = primaryId(g);
          const dupCount = g.cars.length - 1;
          return (
            <div key={g.key} style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: 14, background: 'var(--color-surface-alt)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="car" size={16} />
                  <b>Гос.номер {g.plate}</b>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>· {g.cars.length} машины</span>
                </div>
                <button className="primary small" disabled={busyKey === g.key} onClick={() => mergeGroup(g)}>
                  {busyKey === g.key ? 'Сращиваем…' : `Срастить ${dupCount} → в основную`}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.cars.map((car) => (
                  <CarRow
                    key={car.id}
                    car={car}
                    isPrimary={car.id === pid}
                    onPick={() => setPrimaryByKey((m) => ({ ...m, [g.key]: car.id }))}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
