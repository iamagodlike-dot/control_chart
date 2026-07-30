import { useEffect, useState } from 'react';
import { api } from '../api';
import Icon from './Icon';
import {
  DEFAULT_ACT_TEXT, DEFAULT_INTAKE_SETTINGS, normalizeIntakeSettings,
} from '../intake';

// «Настройки → Приёмка авто»: управленец правит то, по чему работает приёмщик —
// шаблоны чек-листов, обязательные ракурсы съёмки, зоны кузова, списки документов
// и комплектности, юридический текст акта.
//
// Сохранение здесь ЯВНОЕ (кнопка), в отличие от карточки приёмки: настройки правят
// изредка и за компьютером, а случайно снесённый пункт чек-листа сразу изменил бы
// правило «что обязательно» для всех машин на площадке.
//
// Дефолты берём из intake.js — тот же источник, что видят приёмщик, юнит-тесты и
// демо-страница, поэтому «Вернуть по умолчанию» возвращает ровно то, что описано
// в коде, а не отдельную копию.

const uid = (prefix) => `${prefix}-${(crypto.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 8)}`;

// Строка справочника {id, label} с переименованием и удалением. `extra` рисует
// дополнительные контролы справа (флаг «обязательно», группа зоны).
function DictRow({ item, icon, onRename, onRemove, extra }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label);

  function commit() {
    const v = draft.trim();
    if (v) onRename(v);
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="list-item-editing">
        <input
          className="list-edit-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(item.label); setEditing(false); }
          }}
        />
        <span className="list-actions">
          <button className="list-action-btn ok" title="Сохранить" onClick={commit}><Icon name="check" size={15} /></button>
          <button className="list-action-btn" title="Отмена" onClick={() => { setDraft(item.label); setEditing(false); }}><Icon name="x" size={15} /></button>
        </span>
      </li>
    );
  }

  return (
    <li>
      <span className="list-icon"><Icon name={icon} size={15} /></span>
      <span className="list-label">{item.label}</span>
      {extra}
      <span className="list-actions">
        <button className="list-action-btn" title="Переименовать" onClick={() => { setDraft(item.label); setEditing(true); }}>
          <Icon name="edit" size={14} />
        </button>
        <button className="list-action-btn danger" title="Удалить" onClick={onRemove}><Icon name="trash" size={14} /></button>
      </span>
    </li>
  );
}

// Поле «добавить» под списком — та же связка, что у справочников страховых.
function AddRow({ title, placeholder, onAdd }) {
  const [value, setValue] = useState('');
  function add() {
    const v = value.trim();
    if (!v) return;
    onAdd(v);
    setValue('');
  }
  return (
    <div className="settings-add">
      <div className="settings-add-title"><Icon name="plus" size={15} />{title}</div>
      <div className="inline-form">
        <input
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <button className="primary" onClick={add}>Добавить</button>
      </div>
    </div>
  );
}

export default function IntakeSettings() {
  const [draft, setDraft] = useState(null);       // null → ещё грузим
  const [tplId, setTplId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.settings.getIntake()
      .then((raw) => {
        const s = normalizeIntakeSettings(raw);
        setDraft(s);
        setTplId(s.templates[0]?.id || '');
      })
      .catch(() => {
        setDraft(normalizeIntakeSettings(null));
        setError('Не удалось прочитать настройки — показаны значения по умолчанию.');
      });
  }, []);

  function patch(next) {
    setDraft((prev) => ({ ...prev, ...next }));
    setSaved(false);
  }

  // Универсальные операции над справочником-массивом внутри черновика.
  const dict = (key) => ({
    add: (label, extra = {}) => patch({ [key]: [...draft[key], { id: uid(key.slice(0, 3)), label, ...extra }] }),
    rename: (id, label) => patch({ [key]: draft[key].map((x) => (x.id === id ? { ...x, label } : x)) }),
    update: (id, fields) => patch({ [key]: draft[key].map((x) => (x.id === id ? { ...x, ...fields } : x)) }),
    remove: (id) => patch({ [key]: draft[key].filter((x) => x.id !== id) }),
  });

  const tpl = draft?.templates.find((t) => t.id === tplId) || draft?.templates[0] || null;

  function patchTemplate(fields) {
    patch({ templates: draft.templates.map((t) => (t.id === tpl.id ? { ...t, ...fields } : t)) });
  }

  function addTemplate() {
    const label = window.prompt('Название нового шаблона чек-листа', 'Новый шаблон');
    if (!label || !label.trim()) return;
    const id = uid('tpl');
    patch({
      templates: [...draft.templates, { id, label: label.trim(), payment_types: [], items: [{ id: uid('it'), text: 'Первый пункт', required: true }] }],
    });
    setTplId(id);
  }

  function removeTemplate() {
    if (draft.templates.length <= 1) {
      window.alert('Должен остаться хотя бы один шаблон — приёмщику нужно по чему-то работать.');
      return;
    }
    if (!window.confirm(`Удалить шаблон «${tpl.label}»?`)) return;
    const rest = draft.templates.filter((t) => t.id !== tpl.id);
    patch({ templates: rest });
    setTplId(rest[0].id);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      // Прогоняем через ту же нормализацию, что и чтение: в базу не должен
      // попасть черновик, который потом молча откатится к дефолтам.
      await api.settings.saveIntake(normalizeIntakeSettings(draft));
      setSaved(true);
    } catch {
      setError('Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    if (!window.confirm('Вернуть все списки приёмки к значениям по умолчанию? Ваши правки будут потеряны.')) return;
    const s = normalizeIntakeSettings(DEFAULT_INTAKE_SETTINGS);
    setDraft(s);
    setTplId(s.templates[0].id);
    setSaved(false);
  }

  if (!draft) {
    return (
      <div className="panel">
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      </div>
    );
  }

  const photoSlots = dict('photo_slots');
  const zones = dict('damage_zones');
  const equipment = dict('equipment');
  const docs = dict('docs');
  const zoneGroups = [...new Set(draft.damage_zones.map((z) => z.group || 'Прочее'))];

  return (
    <>
      {error && <div className="panel"><div className="ink-banner is-error"><Icon name="warning" size={16} />{error}</div></div>}

      <div className="panel">
        <h3>Шаблоны чек-листов</h3>
        <p className="panel-hint">
          Что приёмщик обязан сделать при заезде. Шаблон подставляется машине автоматически
          по типу оплаты — отметьте ниже, каким типам он предназначен.
        </p>

        <div className="ink-set-tabs">
          {draft.templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ink-chip-btn${t.id === tpl.id ? ' is-on' : ''}`}
              onClick={() => setTplId(t.id)}
            >
              {t.label}<span className="ink-set-num">{t.items.length}</span>
            </button>
          ))}
          <button type="button" className="ink-chip-btn" onClick={addTemplate}>
            <Icon name="plus" size={14} />Шаблон
          </button>
        </div>

        {tpl && (
          <>
            <div className="inline-form ink-set-tplhead">
              <input
                value={tpl.label}
                onChange={(e) => patchTemplate({ label: e.target.value })}
                placeholder="Название шаблона"
              />
              <button className="list-action-btn danger" title="Удалить шаблон" onClick={removeTemplate}>
                <Icon name="trash" size={15} />
              </button>
            </div>

            <div className="ink-set-row">
              <span className="ink-set-row-label">Применять к машинам:</span>
              {[['insurance', 'Страховая'], ['cash', 'Клиент (наличные)'], ['legal', 'Юрлицо']].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`ink-chip-btn${tpl.payment_types.includes(id) ? ' is-on' : ''}`}
                  onClick={() => patchTemplate({
                    payment_types: tpl.payment_types.includes(id)
                      ? tpl.payment_types.filter((x) => x !== id)
                      : [...tpl.payment_types, id],
                  })}
                >{label}</button>
              ))}
            </div>

            <ul className="list">
              {tpl.items.map((it) => (
                <li key={it.id}>
                  <span className="list-icon"><Icon name="check" size={15} /></span>
                  <input
                    className="list-edit-input"
                    value={it.text}
                    onChange={(e) => patchTemplate({ items: tpl.items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)) })}
                  />
                  <label className="ink-set-flag" title="Без этого пункта приёмку нельзя закрыть">
                    <input
                      type="checkbox"
                      checked={it.required}
                      onChange={(e) => patchTemplate({ items: tpl.items.map((x) => (x.id === it.id ? { ...x, required: e.target.checked } : x)) })}
                    />
                    обязательно
                  </label>
                  <span className="list-actions">
                    <button
                      className="list-action-btn danger"
                      title="Удалить пункт"
                      onClick={() => patchTemplate({ items: tpl.items.filter((x) => x.id !== it.id) })}
                    ><Icon name="trash" size={14} /></button>
                  </span>
                </li>
              ))}
            </ul>
            <AddRow
              title="Добавить пункт"
              placeholder="Например: сфотографировать номер кузова"
              onAdd={(text) => patchTemplate({ items: [...tpl.items, { id: uid('it'), text, required: true }] })}
            />
          </>
        )}
      </div>

      <div className="panel">
        <h3>Обязательные фото</h3>
        <p className="panel-hint">
          Ракурсы, которые приёмщик обязан снять. Пока нет снимка по каждой отмеченной
          рубрике, кнопка «Завершить приёмку» не загорится.
          <br />
          <b>Осторожно:</b> удаление рубрики скроет уже снятые по ней фотографии с экрана приёмки
          (сами файлы останутся в карточке машины).
        </p>
        <ul className="list">
          {draft.photo_slots.map((slot) => (
            <DictRow
              key={slot.id}
              item={slot}
              icon="camera"
              onRename={(label) => photoSlots.rename(slot.id, label)}
              onRemove={() => photoSlots.remove(slot.id)}
              extra={(
                <label className="ink-set-flag">
                  <input
                    type="checkbox"
                    checked={!!slot.required}
                    onChange={(e) => photoSlots.update(slot.id, { required: e.target.checked })}
                  />
                  обязательно
                </label>
              )}
            />
          ))}
        </ul>
        <AddRow title="Добавить рубрику" placeholder="Например: номер кузова" onAdd={(label) => photoSlots.add(label, { required: true })} />
      </div>

      <div className="panel">
        <h3>Зоны повреждений</h3>
        <p className="panel-hint">
          Элементы кузова, которые приёмщик отмечает при обходе машины. Группа задаёт,
          в каком блоке экрана окажется кнопка.
        </p>
        <ul className="list">
          {draft.damage_zones.map((z) => (
            <DictRow
              key={z.id}
              item={z}
              icon="car"
              onRename={(label) => zones.rename(z.id, label)}
              onRemove={() => zones.remove(z.id)}
              extra={(
                <input
                  className="ink-set-group"
                  list="ink-zone-groups"
                  value={z.group || ''}
                  placeholder="Группа"
                  onChange={(e) => zones.update(z.id, { group: e.target.value })}
                />
              )}
            />
          ))}
        </ul>
        <datalist id="ink-zone-groups">
          {zoneGroups.map((g) => <option key={g} value={g} />)}
        </datalist>
        <AddRow title="Добавить зону" placeholder="Например: Стекло двери задней левой" onAdd={(label) => zones.add(label, { group: 'Прочее' })} />
      </div>

      <div className="panel">
        <h3>Комплектность</h3>
        <p className="panel-hint">Что проверяют в машине при заезде. Печатается в акте полным списком — и что есть, и чего нет.</p>
        <ul className="list">
          {draft.equipment.map((it) => (
            <DictRow key={it.id} item={it} icon="box" onRename={(label) => equipment.rename(it.id, label)} onRemove={() => equipment.remove(it.id)} />
          ))}
        </ul>
        <AddRow title="Добавить пункт комплектности" placeholder="Например: Компрессор" onAdd={(label) => equipment.add(label)} />
      </div>

      <div className="panel">
        <h3>Принимаемые документы</h3>
        <p className="panel-hint">Что клиент передаёт вместе с машиной.</p>
        <ul className="list">
          {draft.docs.map((it) => (
            <DictRow key={it.id} item={it} icon="file" onRename={(label) => docs.rename(it.id, label)} onRemove={() => docs.remove(it.id)} />
          ))}
        </ul>
        <AddRow title="Добавить документ" placeholder="Например: Диагностическая карта" onAdd={(label) => docs.add(label)} />
      </div>

      <div className="panel">
        <h3>Правила и акт приёмки</h3>
        <p className="panel-hint">Что считать обязательным и какой юридический текст печатать в акте.</p>

        <label className="ink-set-check">
          <input type="checkbox" checked={draft.require_mileage} onChange={(e) => patch({ require_mileage: e.target.checked })} />
          Требовать пробег
        </label>
        <label className="ink-set-check">
          <input type="checkbox" checked={draft.require_photos} onChange={(e) => patch({ require_photos: e.target.checked })} />
          Требовать обязательные фото
        </label>

        <div className="inline-form ink-set-days">
          <label>
            Жёлтая метка через, дней
            <input
              type="number" min="0" inputMode="numeric"
              value={draft.warn_days}
              onChange={(e) => patch({ warn_days: Number(e.target.value) })}
            />
          </label>
          <label>
            Красная метка через, дней
            <input
              type="number" min="1" inputMode="numeric"
              value={draft.alert_days}
              onChange={(e) => patch({ alert_days: Number(e.target.value) })}
            />
          </label>
        </div>

        <label className="ink-set-textlabel">
          Условия приёмки (печатаются в акте)
          <textarea
            className="ink-notes"
            rows={6}
            value={draft.act_text}
            onChange={(e) => patch({ act_text: e.target.value })}
          />
        </label>
        {draft.act_text !== DEFAULT_ACT_TEXT && (
          <button className="ink-skip" type="button" onClick={() => patch({ act_text: DEFAULT_ACT_TEXT })}>
            Вернуть стандартный текст
          </button>
        )}
      </div>

      <div className="panel ink-set-savebar">
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить настройки приёмки'}
        </button>
        {saved && <span className="ink-set-ok"><Icon name="check" size={15} />Сохранено — приёмщик увидит при следующем открытии экрана</span>}
        <button className="ink-skip" type="button" onClick={resetAll}>Вернуть всё по умолчанию</button>
      </div>
    </>
  );
}
