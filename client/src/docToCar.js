// «Обновить карточку машины» из редактора документа — ОДИН путь для заказ-наряда и
// для акта/счёта. Раньше эта функция была скопирована в оба редактора; расходились они
// молча (правишь один — второй остаётся с прежним поведением), а пользователь видел
// «в одном документе кнопка работает иначе, чем в другом».
//
// План переноса считает чистая planDocItemsToCar (orderDoc.js); здесь — только
// подтверждение, запись в базу и обратная простановка ссылок src_id.

import { api } from './api';
import { planDocItemsToCar, describeDocToCarPlan } from './orderDoc';
import { genPartId } from './parts';

const filled = (v) => !!String(v ?? '').trim();

// Возвращает 'ok' | 'cancel' | 'empty'; бросает исключение — вызывающий показывает ошибку.
// setSnapshot нужен, чтобы записать в строки документа src_id: без этого добавленная в
// документе строка остаётся без связи с карточкой, и её ПОСЛЕДУЮЩЕЕ переименование
// снова создало бы дубль (см. planDocItemsToCar).
export async function applyDocToCar({ job, snapshot, recipient = 'all', docId = null, setSnapshot }) {
  const jobId = job?.id || job?.job_id;
  if (!jobId) return 'empty';
  const veh = snapshot.vehicle || {};
  const cust = snapshot.customer || {};
  const upd = {};
  if (filled(veh.car_model)) upd.car_model = veh.car_model;
  if (filled(veh.plate_number)) upd.plate_number = veh.plate_number;
  if (filled(veh.vin)) upd.vin = veh.vin;
  if (filled(veh.year)) upd.year = veh.year;
  if (filled(veh.mileage)) upd.mileage = veh.mileage;
  if (filled(cust.name)) upd.client_name = cust.name;
  if (filled(cust.phone)) upd.client_phone = cust.phone;

  const plan = planDocItemsToCar(job, snapshot, recipient, genPartId);
  const hasServices = (snapshot.services || []).some((s) => filled(s && s.name));
  const hasParts = (snapshot.parts || []).some((p) => filled(p && p.code) || filled(p && p.name));
  if (!Object.keys(upd).length && !hasServices && !hasParts) return 'empty';
  if (!window.confirm(describeDocToCarPlan(plan, { head: !!Object.keys(upd).length }))) return 'cancel';

  const payload = { ...upd };
  // Услуги пишем целым (слитым) массивом, только если в документе есть работы — иначе
  // карточку не трогаем. Запчасти — пооперационно (сохраняют закупку/склад/приёмку).
  if (hasServices) payload.services = plan.services;
  if (Object.keys(payload).length) await api.jobs.update(jobId, payload);
  // Последовательно: транзакции на один job-док не должны конфликтовать.
  for (const p of plan.partOps) await api.jobs.savePart(jobId, p);

  // Ссылки на позиции карточки — в снапшот. Печатный лист и суммы от этого не меняются.
  if (setSnapshot) {
    setSnapshot((s) => ({
      ...s,
      services: (s.services || []).map((x) => (plan.links.services[x.id] ? { ...x, src_id: plan.links.services[x.id] } : x)),
      parts: (s.parts || []).map((x) => (plan.links.parts[x.id] ? { ...x, src_id: plan.links.parts[x.id] } : x)),
    }));
  }
  // У уже сохранённого документа ссылки дописываем и в базу — чтобы связь пережила
  // закрытие редактора. Пишем поверх ХРАНИМЫХ строк (перечитываем документ), а не
  // поверх снапшота: иначе кнопка «Обновить карточку» заодно тихо сохраняла бы в
  // документ несохранённые правки цен — сохранение документа делает только «Сохранить».
  // Не удалось (правила доступа) — не беда: карточка обновлена, а сопоставление
  // откатится на «артикул+название», как было до src_id.
  if (docId) {
    const withLinks = (arr, map) => (arr || []).map((x) => (map[x.id] ? { ...x, src_id: map[x.id] } : x));
    try {
      const stored = await api.orderDocuments.get(docId);
      if (stored) {
        await api.orderDocuments.update(docId, {
          services: withLinks(stored.services, plan.links.services),
          parts: withLinks(stored.parts, plan.links.parts),
        });
      }
    } catch { /* связь не сохранилась в документе — на карточку это не влияет */ }
  }
  return 'ok';
}
