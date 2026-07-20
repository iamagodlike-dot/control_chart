/* eslint-disable react-refresh/only-export-components */
// Standalone preview of the REDESIGNED Настройки screen. NO Firebase network:
// the real <PostsMasters> (which renders UsersAdmin + CompanySettings too) runs
// against an in-memory monkeypatch of `api`, so the sidebar sections, cards,
// forms and buttons are the ACTUAL UI — add/edit/delete all work on the seeds.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../api';
import PostsMasters from '../components/PostsMasters';
import '../App.css';

document.documentElement.dataset.theme = 'dark';

// —— in-memory tables ————————————————————————————————————————————————
let idc = 1000;
const nid = () => `x${++idc}`;

const posts = [
  { id: 'p1', name: 'Разборка / дефектовка', sort_order: 0 },
  { id: 'p2', name: 'Жестянка №1', sort_order: 1 },
  { id: 'p3', name: 'Малярный №2', sort_order: 2 },
  { id: 'p4', name: 'Сборка / полировка', sort_order: 3 },
];
const masters = [
  { id: 'm1', name: 'Андрей Волков', specialty: 'Маляр', default_post_id: 'p3', pay_type: 'piece', advance: 40000 },
  { id: 'm2', name: 'Сергей Гущин', specialty: 'Жестянщик', default_post_id: 'p2', pay_type: 'fixed', advance: 40000, salary: 80000 },
  { id: 'm3', name: 'Ильдар Ахметов', specialty: 'Подготовка', default_post_id: 'p1', pay_type: 'piece', advance: 40000 },
];
const insurers = [
  { id: 'i1', name: 'Ингосстрах', sort_order: 0 },
  { id: 'i2', name: 'РЕСО-Гарантия', sort_order: 1 },
  { id: 'i3', name: 'АльфаСтрахование', sort_order: 2 },
];
const suppliers = [
  { id: 's1', name: 'Exist', sort_order: 0 },
  { id: 's2', name: 'Emex', sort_order: 1 },
  { id: 's3', name: 'Разборка на Калинина', sort_order: 2 },
];
const users = [
  { id: 'rpkrsk@gmail.com', email: 'rpkrsk@gmail.com', name: 'Владелец', role: 'owner', active: true },
  { id: 'master1@academy', email: 'master1@academy', name: 'Андрей', role: 'master', masterId: 'm1', active: true },
  { id: 'exp@academy', email: 'exp@academy', name: 'Экспедитор', role: 'expeditor', active: true },
];
let company = {
  name: 'ООО «Авто Академия»', inn: '2464012345', ogrn: '1122464000000',
  address: 'Красноярск, ул. Кузнечная, 12', phone: '+7 391 000-00-00', director: 'Иванов И.И.',
  bank_name: 'Банк ТОЧКА ПАО', bik: '044525104', account: '40702810000000000000',
  vat_mode: 'none', workHourStart: 8, workHourEnd: 20, materials_pct: 25, overhead_pct: 15,
};

const clone = (a) => a.map((x) => ({ ...x }));
const byId = (a, id) => a.find((x) => x.id === id);
const sortByOrder = (a) => clone(a).sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0));

function makeCrud(store, { ordered } = {}) {
  return {
    async list() { return ordered ? sortByOrder(store) : clone(store); },
    async create(data) { store.push({ id: nid(), ...data }); },
    async update(id, patch) { const r = byId(store, id); if (r) Object.assign(r, patch); },
    async remove(id) { const i = store.findIndex((x) => x.id === id); if (i >= 0) store.splice(i, 1); },
    ensureSeeded: async () => {},
  };
}

Object.assign(api.posts, makeCrud(posts, { ordered: true }));
Object.assign(api.masters, makeCrud(masters));
Object.assign(api.insurers, makeCrud(insurers, { ordered: true }));
Object.assign(api.suppliers, makeCrud(suppliers, { ordered: true }));

api.stages.listByPost = async () => [];
api.stages.listByMaster = async () => [];

api.users.list = async () => clone(users);
api.users.upsert = async (email, patch) => {
  const key = String(email).trim().toLowerCase();
  const r = byId(users, key);
  if (r) Object.assign(r, patch);
  else users.push({ id: key, email: key, active: true, ...patch });
};
api.users.remove = async (email) => {
  const key = String(email).trim().toLowerCase();
  const i = users.findIndex((x) => (x.email || x.id) === key);
  if (i >= 0) users.splice(i, 1);
};

api.settings.getCompany = async () => ({ ...company });
api.settings.updateCompany = async (data) => { company = { ...company, ...data }; return { ...company }; };

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="app">
      <main className="app-main">
        <PostsMasters />
      </main>
    </div>
  </StrictMode>,
);
