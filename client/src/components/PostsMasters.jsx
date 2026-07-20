import { useEffect, useState } from 'react';
import { api } from '../api';
import CompanySettings from './CompanySettings';
import SplusImport from './SplusImport';
import UsersAdmin from './UsersAdmin';
import DuplicateCars from './DuplicateCars';
import Icon from './Icon';
import {
  PAY_TYPE_ORDER, PAY_TYPES, DEFAULT_PAY_TYPE, DEFAULT_ADVANCE,
  normalizeMasterPay, masterPayForm, masterPaySummary,
} from '../salary';

// Разделы настроек. Раньше все блоки лежали одной длинной лентой; теперь слева
// меню, справа — только выбранный раздел. Порядок и подписи должны совпадать со
// сборкой ниже (по section === id).
const SECTIONS = [
  { id: 'company', label: 'Компания', icon: 'building' },
  { id: 'staff', label: 'Сотрудники', icon: 'user' },
  { id: 'masters', label: 'Мастера', icon: 'wrench' },
  { id: 'posts', label: 'Посты', icon: 'columns' },
  { id: 'dict', label: 'Справочники', icon: 'clipboard' },
  { id: 'import', label: 'Импорт данных', icon: 'download' },
  { id: 'duplicates', label: 'Дубликаты машин', icon: 'car' },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);
const SECTION_KEY = 'aa-settings-section';

// Поля оплаты мастера/сотрудника (тип + аванс + оклад) — общие для формы
// добавления и формы редактирования. Оклад показываем только для типа «Оклад».
// Экспортируется, чтобы демо-страница (salary-demo) показывала РЕАЛЬНЫЕ поля.
export function PayFields({ form, onPatch }) {
  return (
    <>
      <select value={form.pay_type} onChange={(e) => onPatch({ pay_type: e.target.value })}>
        {PAY_TYPE_ORDER.map((t) => <option key={t} value={t}>{PAY_TYPES[t].label}</option>)}
      </select>
      <input
        type="number" min="0" inputMode="numeric" placeholder="Аванс, ₽"
        value={form.advance} onChange={(e) => onPatch({ advance: e.target.value })}
      />
      {form.pay_type === 'fixed' && (
        <input
          type="number" min="0" inputMode="numeric" placeholder="Оклад, ₽/мес"
          value={form.salary} onChange={(e) => onPatch({ salary: e.target.value })}
        />
      )}
    </>
  );
}

const emptyMasterForm = () => ({
  name: '', specialty: '', default_post_id: '',
  pay_type: DEFAULT_PAY_TYPE, advance: String(DEFAULT_ADVANCE), salary: '',
});

export default function PostsMasters() {
  const [posts, setPosts] = useState([]);
  const [masters, setMasters] = useState([]);
  const [insurers, setInsurers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPost, setNewPost] = useState('');
  const [newMaster, setNewMaster] = useState(emptyMasterForm());
  const [newInsurer, setNewInsurer] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [dragIndex, setDragIndex] = useState(null);
  const [editingPostId, setEditingPostId] = useState(null);
  const [editPostName, setEditPostName] = useState('');
  const [editingMasterId, setEditingMasterId] = useState(null);
  const [editMasterForm, setEditMasterForm] = useState(emptyMasterForm());
  const [editingInsurerId, setEditingInsurerId] = useState(null);
  const [editInsurerName, setEditInsurerName] = useState('');
  const [editingSupplierId, setEditingSupplierId] = useState(null);
  const [editSupplierName, setEditSupplierName] = useState('');
  const [showImport, setShowImport] = useState(false);
  // Открытый раздел запоминаем — чтобы вернуться туда, где были в прошлый раз.
  const [section, setSection] = useState(() => {
    const saved = localStorage.getItem(SECTION_KEY);
    return SECTION_IDS.includes(saved) ? saved : 'company';
  });

  useEffect(() => { localStorage.setItem(SECTION_KEY, section); }, [section]);

  const load = async () => {
    const [p, m, ins, sup] = await Promise.all([
      api.posts.list(), api.masters.list(), api.insurers.list(), api.suppliers.list(),
    ]);
    setPosts(p);
    setMasters(m);
    setInsurers(ins);
    setSuppliers(sup);
    setLoading(false);
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/set-state-in-effect

  async function addPost() {
    if (!newPost.trim()) return;
    await api.posts.create({ name: newPost.trim(), sort_order: posts.length });
    setNewPost('');
    load();
  }

  async function removePost(id) {
    const used = await api.stages.listByPost(id).catch(() => []);
    const active = used.filter((s) => s.status !== 'done').length;
    const msg = used.length
      ? `На этом посту запланировано этапов: ${used.length}${active ? ` (${active} ещё не завершены)` : ''}.\nОни будут удалены вместе с постом. Продолжить?`
      : 'Удалить пост?';
    if (!confirm(msg)) return;
    await api.posts.remove(id);
    load();
  }

  function startEditPost(p) {
    setEditingPostId(p.id);
    setEditPostName(p.name);
  }

  function cancelEditPost() {
    setEditingPostId(null);
  }

  async function saveEditPost() {
    const name = editPostName.trim();
    if (!name) return;
    await api.posts.update(editingPostId, { name });
    setEditingPostId(null);
    load();
  }

  async function reorderPosts(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const next = [...posts];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setPosts(next);
    await Promise.all(next.map((p, i) => api.posts.update(p.id, { sort_order: i })));
  }

  async function addMaster() {
    if (!newMaster.name.trim()) return;
    await api.masters.create({
      name: newMaster.name.trim(),
      specialty: newMaster.specialty || null,
      default_post_id: newMaster.default_post_id || null,
      ...normalizeMasterPay(newMaster),
    });
    setNewMaster(emptyMasterForm());
    load();
  }

  async function removeMaster(id) {
    const used = await api.stages.listByMaster(id).catch(() => []);
    const msg = used.length
      ? `Мастер назначен на этапов: ${used.length}. После удаления они останутся без мастера (не назначен). Удалить мастера?`
      : 'Удалить мастера?';
    if (!confirm(msg)) return;
    await api.masters.remove(id);
    load();
  }

  function startEditMaster(m) {
    setEditingMasterId(m.id);
    setEditMasterForm({ name: m.name, specialty: m.specialty || '', default_post_id: m.default_post_id || '', ...masterPayForm(m) });
  }

  function cancelEditMaster() {
    setEditingMasterId(null);
  }

  async function saveEditMaster() {
    const name = editMasterForm.name.trim();
    if (!name) return;
    await api.masters.update(editingMasterId, {
      name,
      specialty: editMasterForm.specialty || null,
      default_post_id: editMasterForm.default_post_id || null,
      ...normalizeMasterPay(editMasterForm),
    });
    setEditingMasterId(null);
    load();
  }

  async function addInsurer() {
    if (!newInsurer.trim()) return;
    await api.insurers.create({ name: newInsurer.trim(), sort_order: insurers.length });
    setNewInsurer('');
    load();
  }

  async function removeInsurer(id) {
    if (!confirm('Удалить страховую из справочника? Уже заведённые машины сохранят её название.')) return;
    await api.insurers.remove(id);
    load();
  }

  function startEditInsurer(x) {
    setEditingInsurerId(x.id);
    setEditInsurerName(x.name);
  }

  function cancelEditInsurer() {
    setEditingInsurerId(null);
  }

  async function saveEditInsurer() {
    const name = editInsurerName.trim();
    if (!name) return;
    await api.insurers.update(editingInsurerId, { name });
    setEditingInsurerId(null);
    load();
  }

  async function addSupplier() {
    if (!newSupplier.trim()) return;
    await api.suppliers.create({ name: newSupplier.trim(), sort_order: suppliers.length });
    setNewSupplier('');
    load();
  }

  async function removeSupplier(id) {
    if (!confirm('Удалить поставщика из справочника? Уже заказанные запчасти сохранят его название.')) return;
    await api.suppliers.remove(id);
    load();
  }

  function startEditSupplier(x) {
    setEditingSupplierId(x.id);
    setEditSupplierName(x.name);
  }

  function cancelEditSupplier() {
    setEditingSupplierId(null);
  }

  async function saveEditSupplier() {
    const name = editSupplierName.trim();
    if (!name) return;
    await api.suppliers.update(editingSupplierId, { name });
    setEditingSupplierId(null);
    load();
  }

  // Счётчики у пунктов меню — сколько записей в справочниках (подсказка «есть ли
  // что-то внутри», не открывая раздел). Загружаются вместе с данными.
  const counts = {
    masters: masters.length,
    posts: posts.length,
    dict: insurers.length + suppliers.length,
  };

  const nav = (
    <nav className="settings-nav" aria-label="Разделы настроек">
      <div className="settings-nav-title">Настройки</div>
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`settings-nav-item${section === s.id ? ' active' : ''}`}
          onClick={() => setSection(s.id)}
          aria-current={section === s.id ? 'page' : undefined}
        >
          <Icon name={s.icon} size={18} />
          <span className="settings-nav-label">{s.label}</span>
          {counts[s.id] > 0 && <span className="settings-nav-count">{counts[s.id]}</span>}
        </button>
      ))}
    </nav>
  );

  if (loading) {
    return (
      <div className="settings-screen">
        {nav}
        <div className="settings-content">
          <div className="panel">
            <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-screen">
      {nav}
      <div className="settings-content">

        {section === 'company' && <CompanySettings />}

        {section === 'staff' && <UsersAdmin />}

        {section === 'masters' && (
          <div className="panel">
            <h3>Мастера</h3>
            <p className="panel-hint">Кто выполняет работы. Ставка оплаты подтягивается в расчёт себестоимости и в зарплату.</p>
            {masters.length === 0 ? (
              <div className="list-empty">Мастеров пока нет — добавьте первого ниже</div>
            ) : (
              <ul className="list">
                {masters.map((m) => (
                  <li key={m.id} className={editingMasterId === m.id ? 'list-item-editing' : ''}>
                    {editingMasterId === m.id ? (
                      <>
                        <input
                          className="list-edit-input"
                          autoFocus
                          placeholder="Имя мастера"
                          value={editMasterForm.name}
                          onChange={(e) => setEditMasterForm({ ...editMasterForm, name: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEditMaster(); if (e.key === 'Escape') cancelEditMaster(); }}
                        />
                        <input
                          className="list-edit-input"
                          placeholder="Специализация"
                          value={editMasterForm.specialty}
                          onChange={(e) => setEditMasterForm({ ...editMasterForm, specialty: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEditMaster(); if (e.key === 'Escape') cancelEditMaster(); }}
                        />
                        <select
                          value={editMasterForm.default_post_id}
                          onChange={(e) => setEditMasterForm({ ...editMasterForm, default_post_id: e.target.value })}
                        >
                          <option value="">Основной пост — не выбран</option>
                          {posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <PayFields form={editMasterForm} onPatch={(patch) => setEditMasterForm({ ...editMasterForm, ...patch })} />
                        <span className="list-actions">
                          <button className="list-action-btn ok" title="Сохранить" onClick={saveEditMaster}><Icon name="check" size={15} /></button>
                          <button className="list-action-btn" title="Отмена" onClick={cancelEditMaster}><Icon name="x" size={15} /></button>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="list-icon list-icon--letter">{(m.name || '?').trim().charAt(0).toUpperCase()}</span>
                        <span className="list-label">{m.name} <span className="list-sub">{`${m.specialty ? `— ${m.specialty} · ` : ''}${masterPaySummary(m)}`}</span></span>
                        <span className="list-actions">
                          <button className="list-action-btn" title="Редактировать" onClick={() => startEditMaster(m)}><Icon name="edit" size={14} /></button>
                          <button className="list-action-btn danger" title="Удалить" onClick={() => removeMaster(m.id)}><Icon name="trash" size={14} /></button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="settings-add">
              <div className="settings-add-title"><Icon name="plus" size={15} />Добавить мастера</div>
              <div className="settings-add-grid">
                <input placeholder="Имя мастера" value={newMaster.name} onChange={(e) => setNewMaster({ ...newMaster, name: e.target.value })} />
                <input placeholder="Специализация" value={newMaster.specialty} onChange={(e) => setNewMaster({ ...newMaster, specialty: e.target.value })} />
                <select value={newMaster.default_post_id} onChange={(e) => setNewMaster({ ...newMaster, default_post_id: e.target.value })}>
                  <option value="">Основной пост — не выбран</option>
                  {posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <PayFields form={newMaster} onPatch={(patch) => setNewMaster({ ...newMaster, ...patch })} />
              </div>
              <div className="settings-add-actions">
                <button className="primary" onClick={addMaster}>Добавить мастера</button>
              </div>
            </div>
          </div>
        )}

        {section === 'posts' && (
          <div className="panel">
            <h3>Посты</h3>
            <p className="panel-hint">Рабочие места в цеху. Перетаскивайте за ⠿, чтобы задать их порядок на графике.</p>
            {posts.length === 0 ? (
              <div className="list-empty">Постов пока нет — добавьте первый ниже</div>
            ) : (
              <ul className="list draggable-list">
                {posts.map((p, i) => (
                  <li
                    key={p.id}
                    draggable={editingPostId !== p.id}
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { reorderPosts(dragIndex, i); setDragIndex(null); }}
                    className={`${dragIndex === i ? 'is-dragging' : ''}${editingPostId === p.id ? ' list-item-editing' : ''}`}
                  >
                    {editingPostId === p.id ? (
                      <>
                        <input
                          className="list-edit-input"
                          autoFocus
                          value={editPostName}
                          onChange={(e) => setEditPostName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEditPost(); if (e.key === 'Escape') cancelEditPost(); }}
                        />
                        <span className="list-actions">
                          <button className="list-action-btn ok" title="Сохранить" onClick={saveEditPost}><Icon name="check" size={15} /></button>
                          <button className="list-action-btn" title="Отмена" onClick={cancelEditPost}><Icon name="x" size={15} /></button>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="drag-handle" title="Перетащите, чтобы изменить порядок">⠿</span>
                        <span className="list-icon list-icon--letter">{(p.name || '?').trim().charAt(0).toUpperCase()}</span>
                        <span className="list-label">{p.name}</span>
                        <span className="list-actions">
                          <button className="list-action-btn" title="Переименовать" onClick={() => startEditPost(p)}><Icon name="edit" size={14} /></button>
                          <button className="list-action-btn danger" title="Удалить" onClick={() => removePost(p.id)}><Icon name="trash" size={14} /></button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="settings-add">
              <div className="settings-add-title"><Icon name="plus" size={15} />Добавить пост</div>
              <div className="inline-form">
                <input placeholder="Название поста" value={newPost} onChange={(e) => setNewPost(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addPost(); }} />
                <button className="primary" onClick={addPost}>Добавить</button>
              </div>
            </div>
          </div>
        )}

        {section === 'dict' && (
          <>
            <div className="panel">
              <h3>Страховые компании</h3>
              <p className="panel-hint">Список для выбора в карточке машины (тип оплаты «Страховая»).</p>
              {insurers.length === 0 ? (
                <div className="list-empty">Справочник пуст — добавьте страховую ниже</div>
              ) : (
                <ul className="list">
                  {insurers.map((x) => (
                    <li key={x.id} className={editingInsurerId === x.id ? 'list-item-editing' : ''}>
                      {editingInsurerId === x.id ? (
                        <>
                          <input
                            className="list-edit-input"
                            autoFocus
                            value={editInsurerName}
                            onChange={(e) => setEditInsurerName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEditInsurer(); if (e.key === 'Escape') cancelEditInsurer(); }}
                          />
                          <span className="list-actions">
                            <button className="list-action-btn ok" title="Сохранить" onClick={saveEditInsurer}><Icon name="check" size={15} /></button>
                            <button className="list-action-btn" title="Отмена" onClick={cancelEditInsurer}><Icon name="x" size={15} /></button>
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="list-icon"><Icon name="shield" size={15} /></span>
                          <span className="list-label">{x.name}</span>
                          <span className="list-actions">
                            <button className="list-action-btn" title="Переименовать" onClick={() => startEditInsurer(x)}><Icon name="edit" size={14} /></button>
                            <button className="list-action-btn danger" title="Удалить" onClick={() => removeInsurer(x.id)}><Icon name="trash" size={14} /></button>
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="settings-add">
                <div className="settings-add-title"><Icon name="plus" size={15} />Добавить страховую</div>
                <div className="inline-form">
                  <input placeholder="Название страховой" value={newInsurer} onChange={(e) => setNewInsurer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addInsurer(); }} />
                  <button className="primary" onClick={addInsurer}>Добавить</button>
                </div>
              </div>
            </div>

            <div className="panel">
              <h3>Поставщики запчастей</h3>
              <p className="panel-hint">Список для подсказок в поле «Поставщик» на экране «Запчасти».</p>
              {suppliers.length === 0 ? (
                <div className="list-empty">Справочник пуст — добавьте поставщика ниже</div>
              ) : (
                <ul className="list">
                  {suppliers.map((x) => (
                    <li key={x.id} className={editingSupplierId === x.id ? 'list-item-editing' : ''}>
                      {editingSupplierId === x.id ? (
                        <>
                          <input
                            className="list-edit-input"
                            autoFocus
                            value={editSupplierName}
                            onChange={(e) => setEditSupplierName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEditSupplier(); if (e.key === 'Escape') cancelEditSupplier(); }}
                          />
                          <span className="list-actions">
                            <button className="list-action-btn ok" title="Сохранить" onClick={saveEditSupplier}><Icon name="check" size={15} /></button>
                            <button className="list-action-btn" title="Отмена" onClick={cancelEditSupplier}><Icon name="x" size={15} /></button>
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="list-icon"><Icon name="cart" size={15} /></span>
                          <span className="list-label">{x.name}</span>
                          <span className="list-actions">
                            <button className="list-action-btn" title="Переименовать" onClick={() => startEditSupplier(x)}><Icon name="edit" size={14} /></button>
                            <button className="list-action-btn danger" title="Удалить" onClick={() => removeSupplier(x.id)}><Icon name="trash" size={14} /></button>
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="settings-add">
                <div className="settings-add-title"><Icon name="plus" size={15} />Добавить поставщика</div>
                <div className="inline-form">
                  <input placeholder="Название поставщика" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSupplier(); }} />
                  <button className="primary" onClick={addSupplier}>Добавить</button>
                </div>
              </div>
            </div>
          </>
        )}

        {section === 'import' && (
          <div className="panel">
            <h3>Импорт из Splus</h3>
            <p className="panel-hint">
              Перенос заказ-нарядов из старого сервиса Splus. Выгрузите там раздел «Заказ-наряды»
              в CSV и загрузите его здесь — заказы добавятся к существующим (номер, дата, клиент,
              машина с госномером, сумма — в заметку). Дубли по номеру пропускаются.
            </p>
            <button className="primary" onClick={() => setShowImport(true)}>Импортировать заказы</button>
          </div>
        )}

        {section === 'duplicates' && <DuplicateCars />}

      </div>

      {showImport && <SplusImport onClose={() => setShowImport(false)} onImported={load} />}
    </div>
  );
}
