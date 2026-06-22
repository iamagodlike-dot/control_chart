import { useEffect, useState } from 'react';
import { api } from '../api';

const ICON_RULES = [
  [/рихт/i, '🔨'],
  [/свар/i, '⚡'],
  [/маляр|покрас/i, '🎨'],
  [/полиров/i, '✨'],
  [/разбор/i, '🔧'],
  [/сбор/i, '🛠️'],
  [/диагност/i, '🔍'],
  [/шин|колес/i, '🛞'],
  [/подгот/i, '🧰'],
  [/электр/i, '🔌'],
];

function iconFor(text, fallback) {
  if (!text) return fallback;
  const rule = ICON_RULES.find(([re]) => re.test(text));
  return rule ? rule[1] : fallback;
}

export default function PostsMasters() {
  const [posts, setPosts] = useState([]);
  const [masters, setMasters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPost, setNewPost] = useState('');
  const [newMaster, setNewMaster] = useState({ name: '', specialty: '', default_post_id: '' });
  const [dragIndex, setDragIndex] = useState(null);

  const load = async () => {
    const [p, m] = await Promise.all([api.posts.list(), api.masters.list()]);
    setPosts(p);
    setMasters(m);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { reorderPosts(dragIndex, i); setDragIndex(null); }}
                className={dragIndex === i ? 'is-dragging' : ''}
              >
                <span className="drag-handle" title="Перетащите, чтобы изменить порядок">⠿</span>
                <span className="list-icon">{iconFor(p.name, '🅿️')}</span>
                <span className="list-label">{p.name}</span>
                <button className="danger small" onClick={() => removePost(p.id)}>×</button>
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
              <li key={m.id}>
                <span className="list-icon">{iconFor(m.specialty, '👤')}</span>
                <span className="list-label">{m.name} {m.specialty ? <span className="list-sub">— {m.specialty}</span> : ''}</span>
                <button className="danger small" onClick={() => removeMaster(m.id)}>×</button>
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
    </div>
  );
}
