import { useEffect, useState } from 'react';
import { api } from '../api';
import CompanySettings from './CompanySettings';
import { iconFor } from '../postIcons';

export default function PostsMasters() {
  const [posts, setPosts] = useState([]);
  const [masters, setMasters] = useState([]);
  const [insurers, setInsurers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPost, setNewPost] = useState('');
  const [newMaster, setNewMaster] = useState({ name: '', specialty: '', default_post_id: '' });
  const [newInsurer, setNewInsurer] = useState('');
  const [dragIndex, setDragIndex] = useState(null);
  const [editingPostId, setEditingPostId] = useState(null);
  const [editPostName, setEditPostName] = useState('');
  const [editingMasterId, setEditingMasterId] = useState(null);
  const [editMasterForm, setEditMasterForm] = useState({ name: '', specialty: '', default_post_id: '' });
  const [editingInsurerId, setEditingInsurerId] = useState(null);
  const [editInsurerName, setEditInsurerName] = useState('');

  const load = async () => {
    const [p, m, ins] = await Promise.all([api.posts.list(), api.masters.list(), api.insurers.list()]);
    setPosts(p);
    setMasters(m);
    setInsurers(ins);
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
    if (!confirm('Удалить пост? Все связанные этапы тоже будут удалены.')) return;
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
    });
    setNewMaster({ name: '', specialty: '', default_post_id: '' });
    load();
  }

  async function removeMaster(id) {
    if (!confirm('Удалить мастера?')) return;
    await api.masters.remove(id);
    load();
  }

  function startEditMaster(m) {
    setEditingMasterId(m.id);
    setEditMasterForm({ name: m.name, specialty: m.specialty || '', default_post_id: m.default_post_id || '' });
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

  if (loading) {
    return (
      <div className="panel">
        <div className="list-loading"><div className="spinner" /><span>Загружаем…</span></div>
      </div>
    );
  }

  return (
    <div className="panel-grid">
      <div className="panel">
        <h3>Посты</h3>
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
                      <button className="list-action-btn" title="Сохранить" onClick={saveEditPost}>✓</button>
                      <button className="list-action-btn" title="Отмена" onClick={cancelEditPost}>×</button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="drag-handle" title="Перетащите, чтобы изменить порядок">⠿</span>
                    <span className="list-icon">{iconFor(p.name, '🅿️')}</span>
                    <span className="list-label">{p.name}</span>
                    <span className="list-actions">
                      <button className="list-action-btn" title="Переименовать" onClick={() => startEditPost(p)}>✎</button>
                      <button className="list-action-btn danger" title="Удалить" onClick={() => removePost(p.id)}>×</button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="inline-form">
          <input placeholder="Название поста" value={newPost} onChange={(e) => setNewPost(e.target.value)} />
          <button className="primary" onClick={addPost}>Добавить</button>
        </div>
      </div>

      <div className="panel">
        <h3>Мастера</h3>
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
                    <span className="list-actions">
                      <button className="list-action-btn" title="Сохранить" onClick={saveEditMaster}>✓</button>
                      <button className="list-action-btn" title="Отмена" onClick={cancelEditMaster}>×</button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="list-icon">{iconFor(m.specialty, '👤')}</span>
                    <span className="list-label">{m.name} {m.specialty ? <span className="list-sub">— {m.specialty}</span> : ''}</span>
                    <span className="list-actions">
                      <button className="list-action-btn" title="Редактировать" onClick={() => startEditMaster(m)}>✎</button>
                      <button className="list-action-btn danger" title="Удалить" onClick={() => removeMaster(m.id)}>×</button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="inline-form column">
          <input placeholder="Имя мастера" value={newMaster.name} onChange={(e) => setNewMaster({ ...newMaster, name: e.target.value })} />
          <input placeholder="Специализация" value={newMaster.specialty} onChange={(e) => setNewMaster({ ...newMaster, specialty: e.target.value })} />
          <select value={newMaster.default_post_id} onChange={(e) => setNewMaster({ ...newMaster, default_post_id: e.target.value })}>
            <option value="">Основной пост — не выбран</option>
            {posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="primary" onClick={addMaster}>Добавить мастера</button>
        </div>
      </div>

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
                      <button className="list-action-btn" title="Сохранить" onClick={saveEditInsurer}>✓</button>
                      <button className="list-action-btn" title="Отмена" onClick={cancelEditInsurer}>×</button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="list-icon">🛡️</span>
                    <span className="list-label">{x.name}</span>
                    <span className="list-actions">
                      <button className="list-action-btn" title="Переименовать" onClick={() => startEditInsurer(x)}>✎</button>
                      <button className="list-action-btn danger" title="Удалить" onClick={() => removeInsurer(x.id)}>×</button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="inline-form">
          <input placeholder="Название страховой" value={newInsurer} onChange={(e) => setNewInsurer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addInsurer(); }} />
          <button className="primary" onClick={addInsurer}>Добавить</button>
        </div>
      </div>

      <CompanySettings />
    </div>
  );
}
