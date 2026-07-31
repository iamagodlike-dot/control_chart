'use strict';
const dayjs = require('dayjs');
const config = require('./config');
const { loadGraph, getCompany, getDocsForJob, getJobById, listUnpaidSupplierInvoices } = require('./data');
const {
  badge, effectiveStageStatus, jobOverallStatus, currentStage,
  fmtDate, money, relativeDeadline, esc, plural, toMs,
  PART_STATUS_META, partStatusMeta, partKindLabel, paintStatusMeta, PAYMENT_SHORT, partsSummary, progressBar, carLabel,
  partsReadiness, isApproval, isRepair, APPROVAL_STATUS_META, approvalStatusMeta,
} = require('./format');

// Тонкий разделитель между смысловыми блоками карточки.
const DIV = '┈┈┈┈┈┈┈┈┈┈┈┈';

// Полный адрес «главного» фото машины (последнее загруженное) — для шапки карточки.
function mainPhotoUrl(job) {
  const photos = (Array.isArray(job.photos) ? job.photos : []).filter((p) => p && p.url);
  if (!photos.length) return null;
  const u = photos[photos.length - 1].url;
  return /^https?:\/\//i.test(u) ? u : `${config.photosBaseUrl}${u}`;
}
const { invoiceAmount, confirmedPrepayment, computeDebt, computeCashPeriod, countedInvoices } = require('./money');
const { computeCosting } = require('./costing');

const MAX_LIST = 40; // ограничение, чтобы не упереться в лимит длины сообщения Telegram

function postNameFor(job, g) {
  const cs = currentStage(job);
  if (!cs) return null;
  return g.postsById.get(cs.post_id)?.name || null;
}

function masterNameFor(stage, g) {
  if (!stage || !stage.master_id) return null;
  return g.mastersById.get(stage.master_id)?.name || null;
}

function paymentInfo(job) {
  // Только учитываемые счета: перевыставленный счёт — предыдущая версия того же
  // ремонта, а не вторые деньги (см. money.countedInvoices).
  const invs = countedInvoices((job.documents || []).filter((d) => d.type === 'invoice'));
  const prepay = confirmedPrepayment(job);
  if (!invs.length) return { hasInvoice: false, prepay };
  const billed = invs.reduce((s, i) => s + invoiceAmount(i), 0);
  const due = computeDebt([job], invs).total;
  return { hasInvoice: true, billed, prepay, due };
}

// ─── Карточка одной машины ───
function carCard(job, g, { isManager }) {
  const L = [];
  L.push(`<b>${esc(job.car_model || 'Авто')}</b>  ·  <code>${esc(job.plate_number || '—')}</code>`);

  const client = [job.client_name, job.client_phone].filter(Boolean).map(esc).join('  ·  ');
  if (client) L.push(`Клиент: ${client}`);
  const meta = [];
  if (job.storage_location) meta.push(`Место: ${esc(job.storage_location)}`);
  if (job.order_number) meta.push(`Заказ №${esc(job.order_number)}`);
  if (meta.length) L.push(meta.join('  ·  '));

  // VIN / год / пробег.
  const specs = [];
  if (job.vin) specs.push(`VIN ${esc(job.vin)}`);
  if (job.year) specs.push(`${esc(job.year)} г.`);
  if (job.mileage) specs.push(`${esc(job.mileage)} км`);
  if (specs.length) L.push(specs.join('  ·  '));

  // Кто платит (наличные не показываем — это вариант по умолчанию).
  const pay = paymentTypeLine(job);
  if (pay) L.push(pay);

  L.push(DIV);
  const cs = currentStage(job);
  const overall = jobOverallStatus(job);
  if (cs) {
    const post = g.postsById.get(cs.post_id)?.name || '—';
    L.push(`Текущий этап: ${esc(post)} — ${badge(effectiveStageStatus(cs))}`);
    const master = masterNameFor(cs, g);
    if (master) L.push(`Мастер: ${esc(master)}`);
  } else if (overall === 'done') {
    L.push(`Статус: ${badge('done')} — готово к выдаче`);
  } else {
    L.push('Этапы ещё не назначены');
  }

  // Полоса прогресса по этапам (сколько закрыто из всех).
  const stTotal = (job.stages || []).length;
  if (stTotal) {
    const stDone = job.stages.filter((s) => s.status === 'done').length;
    L.push(`Готовность: ${progressBar(stDone, stTotal)} ${stDone}/${stTotal} ${plural(stTotal, 'этап', 'этапа', 'этапов')}`);
  }

  if (job.deadline) {
    const rel = relativeDeadline(job.deadline);
    L.push(`Срок выдачи: ${fmtDate(job.deadline)}${rel ? `  (${rel})` : ''}`);
  }

  // Сводка по запчастям + покраска (видят все).
  const ps = partsSummary(job.parts);
  if (ps.total) {
    const parts = PART_STATUS_META
      .filter((s) => ps.counts[s.id])
      .map((s) => `${s.dot} ${ps.counts[s.id]} ${s.label.toLowerCase()}`);
    L.push('');
    L.push(`Запчасти: <b>${ps.total}</b> ${plural(ps.total, 'позиция', 'позиции', 'позиций')} — ${parts.join(' · ')}`);
    const obtained = job.parts.filter((p) => p.status === 'in' || p.status === 'issued').length;
    L.push(`   ${progressBar(obtained, ps.total)} ${obtained}/${ps.total} в наличии`);
  }
  if (job.paint && job.paint.status) {
    const pm = paintStatusMeta(job.paint.status);
    if (!ps.total) L.push('');
    L.push(`Покраска: ${pm.dot} ${pm.label}${job.paint.code ? ` · ${esc(job.paint.code)}` : ''}`);
  }

  if (isManager) {
    L.push('');
    const p = paymentInfo(job);
    if (!p.hasInvoice) {
      L.push(p.prepay > 0 ? `Оплата: предоплата ${money(p.prepay)} · счёт ещё не выставлен` : 'Оплата: счёт ещё не выставлен');
    } else if (p.due === 0) {
      L.push(`Счёт ${money(p.billed)} — оплачено${p.prepay > 0 ? ` (предоплата ${money(p.prepay)})` : ''}`);
    } else {
      L.push(`Счёт ${money(p.billed)}${p.prepay > 0 ? ` · предоплата ${money(p.prepay)}` : ''}`);
      L.push(`Остаток: <b>${money(p.due)}</b>`);
    }
  }

  // Себестоимость и прибыль (только управляющим, если заполнена на сайте).
  if (isManager && job.costing) {
    const c = computeCosting(job.costing, g.company);
    if (c && (c.revenue || c.cost_total)) {
      L.push('');
      L.push(`Выручка ${money(c.revenue)} · себестоимость ${money(c.cost_total)}`);
      L.push(`Прибыль: <b>${money(c.profit)}</b> (маржа ${c.margin_pct}%)`);
    }
  }

  return L.join('\n');
}

// Строка «кто платит» для карточки. Наличные (вариант по умолчанию) не
// показываем, чтобы не засорять. Для страховой добавляем компанию и № убытка/полиса.
function paymentTypeLine(job) {
  const t = job.payment_type || 'cash';
  if (t === 'cash') return null;
  if (t === 'insurance') {
    const nums = [];
    if (job.claim_number) nums.push(`№ убытка ${esc(job.claim_number)}`);
    if (job.policy_number) nums.push(`полис ${esc(job.policy_number)}`);
    return `Оплата: ${esc(job.insurer_name || 'страховая')}${nums.length ? ` · ${nums.join(' · ')}` : ''}`;
  }
  return `Оплата: ${esc(PAYMENT_SHORT[t] || t)}`;
}

// ─── Поиск ───
function normalizePlate(s) {
  return String(s || '').toUpperCase().replace(/[\s-]/g, '');
}

async function search(queryRaw, { isManager }) {
  const g = await loadGraph();
  const q = String(queryRaw || '').trim();
  if (!q) return { text: 'Введите госномер, имя клиента или № заказа.' };
  const qUp = q.toUpperCase();
  const qPlate = normalizePlate(q);
  const qLow = q.toLowerCase();

  const matches = g.jobs.filter((j) => {
    const plate = normalizePlate(j.plate_number);
    return (
      (qPlate && plate.includes(qPlate)) ||
      (j.client_name && j.client_name.toLowerCase().includes(qLow)) ||
      (j.order_number && String(j.order_number).toUpperCase().includes(qUp)) ||
      (j.car_model && j.car_model.toLowerCase().includes(qLow))
    );
  });

  if (matches.length === 0) return { text: `По запросу «${esc(q)}» ничего не нашёл.` };
  if (matches.length === 1) return { text: carCard(matches[0], g, { isManager }), jobId: matches[0].id, photo: mainPhotoUrl(matches[0]) };

  // Несколько совпадений — отдаём их как данные для кнопок (клавиатуру строит index.js),
  // чтобы нужную машину можно было открыть нажатием, а не уточнять запрос вручную.
  const CAP = 24;
  const list = matches.slice(0, CAP).map((j) => ({ id: j.id, label: carButtonLabel(j) }));
  const more = matches.length > CAP ? `\n(показаны первые ${CAP} — уточните запрос, если нужной машины нет)` : '';
  return { text: `Нашёл ${matches.length}. Выберите машину:${more}`, matches: list };
}

// Подпись машины на кнопке: госномер · модель · клиент (без HTML — это текст кнопки).
function carButtonLabel(j) {
  return `${j.plate_number || '—'} · ${j.car_model || 'Авто'}${j.client_name ? ` · ${j.client_name}` : ''}`;
}

// Карточка машины по её id — для открытия из списка/кнопок (callback car:<id>).
async function openCar(jobId, { isManager }) {
  const g = await loadGraph();
  const job = g.jobsById.get(jobId);
  if (!job) return null;
  return { text: carCard(job, g, { isManager }), photo: mainPhotoUrl(job) };
}

// Список машин в работе для выбора кнопками, постранично (по госномеру).
const BROWSE_PAGE = 8;

async function carsBrowse(page = 0) {
  const g = await loadGraph();
  const active = g.activeJobs.slice().sort(
    (a, b) => normalizePlate(a.plate_number).localeCompare(normalizePlate(b.plate_number), 'ru'),
  );
  const pages = Math.max(1, Math.ceil(active.length / BROWSE_PAGE));
  const p = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const cars = active
    .slice(p * BROWSE_PAGE, p * BROWSE_PAGE + BROWSE_PAGE)
    .map((j) => ({ id: j.id, label: carButtonLabel(j) }));
  return { cars, page: p, pages, total: active.length };
}

// ─── Машины в работе (по постам) ───
async function carsInWork() {
  const g = await loadGraph();
  const active = g.activeJobs;

  const byPost = new Map(); // postId -> jobs[]
  const ready = [];
  const noStage = [];

  for (const j of active) {
    const overall = jobOverallStatus(j);
    if (overall === 'done') { ready.push(j); continue; }
    const cs = currentStage(j);
    if (!cs) { noStage.push(j); continue; }
    if (!byPost.has(cs.post_id)) byPost.set(cs.post_id, []);
    byPost.get(cs.post_id).push(j);
  }

  const L = ['<b>Машины в работе</b>', ''];
  const jobLine = (j) => {
    const cs = currentStage(j);
    const st = badge(cs ? effectiveStageStatus(cs) : jobOverallStatus(j));
    const master = masterNameFor(cs, g);
    const dl = j.deadline ? ` · до ${fmtDate(j.deadline)}` : '';
    return `  • ${carLabel(j)} — ${st}${master ? ` · ${esc(master)}` : ''}${dl}`;
  };

  for (const post of g.posts) {
    const jobs = byPost.get(post.id);
    if (!jobs || !jobs.length) continue;
    L.push(`<b>Пост «${esc(post.name)}»</b>  (${jobs.length})`);
    jobs.slice(0, MAX_LIST).forEach((j) => L.push(jobLine(j)));
    L.push('');
  }
  if (ready.length) {
    L.push(`<b>Готовы к выдаче</b>  (${ready.length})`);
    ready.slice(0, MAX_LIST).forEach((j) => L.push(jobLine(j)));
    L.push('');
  }
  if (noStage.length) {
    L.push(`<b>Без этапов</b>  (${noStage.length})`);
    noStage.slice(0, MAX_LIST).forEach((j) => L.push(jobLine(j)));
    L.push('');
  }

  if (L.length <= 2) return 'Сейчас в работе нет машин.';
  L.push(`Всего в работе: <b>${active.length}</b> авто`);
  return L.join('\n');
}

// ─── Загрузка мастеров ───
async function mastersLoad() {
  const g = await loadGraph();

  // master_id -> список {машина, этап} по активным незакрытым этапам
  const byMaster = new Map();
  for (const j of g.activeJobs) {
    for (const s of j.stages || []) {
      if (s.status === 'done' || !s.master_id) continue;
      if (!byMaster.has(s.master_id)) byMaster.set(s.master_id, []);
      byMaster.get(s.master_id).push({ job: j, stage: s });
    }
  }

  const rows = g.masters.map((m) => ({ master: m, items: byMaster.get(m.id) || [] }));
  const busy = rows.filter((r) => r.items.length).sort((a, b) => b.items.length - a.items.length);
  const free = rows.filter((r) => !r.items.length);

  if (!busy.length) return 'Сейчас нет активных задач у мастеров.';

  const L = ['<b>Загрузка мастеров</b>', ''];
  for (const r of busy) {
    const jobsCount = new Set(r.items.map((i) => i.job.id)).size;
    L.push(`<b>${esc(r.master.name)}</b> — ${jobsCount} ${plural(jobsCount, 'машина', 'машины', 'машин')}`);
    for (const { job, stage } of r.items) {
      const post = g.postsById.get(stage.post_id)?.name || '—';
      const st = badge(effectiveStageStatus(stage));
      const dl = job.deadline ? ` · до ${fmtDate(job.deadline)}` : '';
      const title = stage.title ? ` (${esc(stage.title)})` : '';
      L.push(`  • ${carLabel(job)} — ${esc(post)}${title} · ${st}${dl}`);
    }
    L.push('');
  }
  if (free.length) {
    L.push(`Свободны: ${free.map((r) => esc(r.master.name)).join(', ')}`);
  }
  return L.join('\n');
}

// ─── Сводка за день ───
async function dailySummary() {
  const g = await loadGraph();
  const now = dayjs();
  const active = g.activeJobs;

  const todayOut = active.filter((j) => j.deadline && dayjs(j.deadline).isValid() && dayjs(j.deadline).isSame(now, 'day'));
  const overdue = active.filter((j) => {
    if (!j.deadline) return false;
    const d = dayjs(j.deadline);
    return d.isValid() && d.startOf('day').isBefore(now.startOf('day')) && jobOverallStatus(j) !== 'done';
  });
  // Машины, у которых текущий этап идёт с задержкой (по сроку этапа, ещё до даты выдачи).
  const stageDelayed = active.filter((j) => jobOverallStatus(j) === 'delayed');

  const perPost = new Map();
  for (const j of active) {
    const cs = currentStage(j);
    if (!cs) continue;
    const name = g.postsById.get(cs.post_id)?.name || '—';
    perPost.set(name, (perPost.get(name) || 0) + 1);
  }

  const L = [];
  L.push('<b>Доброе утро!</b>');
  L.push('');
  L.push(`В работе — <b>${active.length}</b> авто.`);
  L.push('');
  if (todayOut.length) {
    L.push(`Сегодня плановая выдача — ${todayOut.length}:`);
    todayOut.slice(0, 15).forEach((j) => L.push(`  • ${carLabel(j)}`));
  } else {
    L.push('Плановых выдач на сегодня нет.');
  }
  L.push('');
  if (overdue.length) {
    L.push(`Просрочена выдача — ${overdue.length}:`);
    overdue.slice(0, 15).forEach((j) => L.push(`  • ${carLabel(j)} (срок был ${fmtDate(j.deadline)})`));
  } else {
    L.push('Просроченных по выдаче нет.');
  }
  L.push('');
  // Задержки по этапам (этап просрочен, но дата выдачи ещё не наступила).
  const stageOnly = stageDelayed.filter((j) => !overdue.includes(j));
  if (stageOnly.length) {
    L.push(`Идут с задержкой по этапам — ${stageOnly.length}:`);
    stageOnly.slice(0, 15).forEach((j) => L.push(`  • ${carLabel(j)}`));
    L.push('');
  }
  const posts = [...perPost.entries()];
  if (posts.length) L.push('На постах: ' + posts.map(([n, c]) => `${esc(n)} ${c}`).join(' · '));

  return L.join('\n');
}

// ─── Долги по машинам ───
async function debts() {
  const g = await loadGraph();
  const { total, perJob } = computeDebt(g.jobs, g.invoices);
  if (perJob.size === 0) return { text: '<b>Долги</b>\n\nДолгов нет — все счета закрыты.', cars: [] };

  const rows = [...perJob.entries()]
    .map(([jobId, due]) => ({ job: g.jobsById.get(jobId), due }))
    .filter((r) => r.job)
    .sort((a, b) => b.due - a.due);

  const L = ['<b>Долги по машинам</b>', ''];
  for (const { job, due } of rows) {
    const archived = job.archived ? ' · выдана' : '';
    L.push(`• ${carLabel(job)} — <b>${money(due)}</b>${archived}`);
    const who = [job.client_name, job.client_phone].filter(Boolean).map(esc).join(' · ');
    if (who) L.push(`   ${who}`);
  }
  L.push('');
  L.push(`Итого долг: <b>${money(total)}</b> · ${rows.length} ${plural(rows.length, 'машина', 'машины', 'машин')}`);
  const cars = rows.slice(0, 18).map((r) => ({ id: r.job.id, plate: r.job.plate_number || '—' }));
  return { text: L.join('\n'), cars };
}

// ─── Выручка за период ───
const PERIOD_LABEL = {
  today: 'сегодня',
  week: 'эта неделя',
  month: 'этот месяц',
  year: 'этот год',
};

async function revenue(period) {
  const g = await loadGraph();
  const c = computeCashPeriod(g.invoices, period);
  const label = PERIOD_LABEL[period] || period;
  const L = [`<b>Выручка — ${label}</b>`, ''];
  L.push(`Оплачено: <b>${money(c.paid)}</b> (${c.paidCount} ${plural(c.paidCount, 'счёт', 'счёта', 'счетов')})`);
  L.push(`Выставлено счетов: ${money(c.billed)} (${c.count})`);
  L.push('');
  L.push('<i>«Оплачено» — деньги, полученные по закрытым счетам за период.</i>');
  return L.join('\n');
}

// ─── Аналитика ───
function avg(arr) {
  const v = arr.filter((n) => Number.isFinite(n) && n >= 0);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

async function analytics() {
  const g = await loadGraph();
  const now = dayjs();
  const dayMs = 86400000;

  // Среднее время в сервисе по завершённым (выданным) машинам.
  const finished = g.jobs.filter((j) => j.archived && toMs(j.archived_at) && toMs(j.created_at));
  const finishedDays = finished.map((j) => (toMs(j.archived_at) - toMs(j.created_at)) / dayMs);
  const avgFinished = avg(finishedDays);

  // Средний «возраст» машин в работе.
  const activeAges = g.activeJobs.map((j) => (now.valueOf() - (toMs(j.created_at) || now.valueOf())) / dayMs);
  const avgActive = avg(activeAges);

  // Загрузка и задержки по постам.
  const perPost = new Map(); // postId -> {count, delayed}
  let delayedStages = 0;
  for (const j of g.activeJobs) {
    const cs = currentStage(j);
    if (cs) {
      const rec = perPost.get(cs.post_id) || { count: 0, delayed: 0 };
      rec.count += 1;
      if (effectiveStageStatus(cs) === 'delayed') rec.delayed += 1;
      perPost.set(cs.post_id, rec);
    }
    for (const s of j.stages || []) {
      if (s.status !== 'done' && effectiveStageStatus(s) === 'delayed') delayedStages += 1;
    }
  }

  const L = ['<b>Аналитика</b>', ''];
  L.push(avgFinished != null
    ? `Среднее время в сервисе: <b>${avgFinished}</b> ${plural(avgFinished, 'день', 'дня', 'дней')} (по ${finished.length} ${plural(finished.length, 'машине', 'машинам', 'машинам')})`
    : 'Среднее время в сервисе: пока нет завершённых машин');
  L.push(`Сейчас в работе: <b>${g.activeJobs.length}</b>${avgActive != null ? ` (средний возраст ${avgActive} ${plural(avgActive, 'день', 'дня', 'дней')})` : ''}`);

  const posts = g.posts.filter((p) => perPost.has(p.id));
  if (posts.length) {
    L.push('');
    L.push('<b>По постам:</b>');
    for (const p of posts) {
      const r = perPost.get(p.id);
      L.push(`  • ${esc(p.name)} — ${r.count} ${plural(r.count, 'авто', 'авто', 'авто')}${r.delayed ? `, ${r.delayed} с задержкой` : ''}`);
    }
  }
  L.push('');
  L.push(delayedStages
    ? `Этапов с задержкой: <b>${delayedStages}</b>`
    : 'Задержек по этапам нет');
  return L.join('\n');
}

// ─── Скоро выдача ───
async function upcoming() {
  const g = await loadGraph();
  const now = dayjs();
  const withDl = g.activeJobs
    .filter((j) => j.deadline && dayjs(j.deadline).isValid())
    .map((j) => ({ j, d: dayjs(j.deadline), days: dayjs(j.deadline).startOf('day').diff(now.startOf('day'), 'day') }))
    .sort((a, b) => a.d.valueOf() - b.d.valueOf());

  const overdue = withDl.filter((x) => x.days < 0 && jobOverallStatus(x.j) !== 'done');
  const today = withDl.filter((x) => x.days === 0);
  const tomorrow = withDl.filter((x) => x.days === 1);
  const week = withDl.filter((x) => x.days >= 2 && x.days <= 7);

  const line = (x, showDate) => {
    const cs = currentStage(x.j);
    const st = badge(cs ? effectiveStageStatus(cs) : jobOverallStatus(x.j));
    const master = cs && cs.master_id ? g.mastersById.get(cs.master_id)?.name : null;
    const dl = showDate ? ` · ${fmtDate(x.j.deadline)}` : '';
    return `  • ${carLabel(x.j)} — ${st}${master ? ` · ${esc(master)}` : ''}${dl}`;
  };

  const L = ['<b>Скоро выдача</b>', ''];
  const section = (title, arr, showDate = false) => {
    if (!arr.length) return;
    L.push(`<b>${title}</b> (${arr.length})`);
    arr.forEach((x) => L.push(line(x, showDate)));
    L.push('');
  };
  section('Просрочено', overdue, true);
  section('Сегодня', today);
  section('Завтра', tomorrow);
  section('На этой неделе', week, true);

  if (L.length <= 2) return { text: '<b>Скоро выдача</b>\n\nНа ближайшую неделю плановых выдач нет.', cars: [] };
  const cars = [...overdue, ...today, ...tomorrow, ...week].slice(0, 18).map((x) => ({ id: x.j.id, plate: x.j.plate_number || '—' }));
  return { text: L.join('\n').trimEnd(), cars };
}

// ─── Вечернее напоминание (возвращает текст или null, если напоминать не о чем) ───
async function eveningReminder() {
  const g = await loadGraph();
  const now = dayjs();
  const active = g.activeJobs;
  const tomorrow = active.filter((j) => j.deadline && dayjs(j.deadline).isValid() && dayjs(j.deadline).isSame(now.add(1, 'day'), 'day'));
  const dueTodayOpen = active.filter((j) => j.deadline && dayjs(j.deadline).isValid() && dayjs(j.deadline).isSame(now, 'day'));
  if (!tomorrow.length && !dueTodayOpen.length) return null;

  const L = ['<b>Напоминание</b>', ''];
  if (dueTodayOpen.length) {
    L.push(`Срок сегодня, но ещё не выдано — ${dueTodayOpen.length}:`);
    dueTodayOpen.slice(0, 15).forEach((j) => L.push(`  • ${carLabel(j)}`));
    L.push('');
  }
  if (tomorrow.length) {
    L.push(`Завтра плановая выдача — ${tomorrow.length}:`);
    tomorrow.slice(0, 15).forEach((j) => L.push(`  • ${carLabel(j)}`));
  }
  return L.join('\n').trimEnd();
}

// ─── Согласование со страховой: доска в виде списка ───
// Разворот кнопки «Согласования» под сводкой учредителя: машины по под-статусам,
// в том же порядке, что колонки доски на сайте. Возвращает {text, cars}.
async function approvals() {
  const g = await loadGraph();
  const now = dayjs();
  const onApproval = g.activeJobs.filter(isApproval);
  if (!onApproval.length) {
    return { text: '<b>Согласование со страховой</b>\n\nСейчас на согласовании нет ни одной машины.', cars: [] };
  }

  // Сколько машина уже висит на согласовании. approval_since проставляется при
  // переводе на доску; у заведённых сразу на согласование его нет — берём created_at.
  const daysOn = (j) => {
    const ms = toMs(j.approval_since) ?? toMs(j.created_at);
    if (ms == null) return '';
    const d = now.startOf('day').diff(dayjs(ms).startOf('day'), 'day');
    if (d <= 0) return 'сегодня';
    return `${d} ${plural(d, 'день', 'дня', 'дней')}`;
  };

  const byStatus = new Map();
  for (const j of onApproval) {
    const m = approvalStatusMeta(j.approval_status);
    if (!byStatus.has(m.id)) byStatus.set(m.id, []);
    byStatus.get(m.id).push(j);
  }

  const L = [`<b>Согласование со страховой</b> — ${onApproval.length} ${plural(onApproval.length, 'авто', 'авто', 'авто')}`, ''];
  for (const m of APPROVAL_STATUS_META) {
    const list = byStatus.get(m.id);
    if (!list || !list.length) continue;
    L.push(`${m.dot} <b>${m.label}</b> — ${list.length}`);
    list.slice(0, 12).forEach((j) => {
      const since = daysOn(j);
      const ins = j.insurer_name ? ` · ${esc(j.insurer_name)}` : '';
      L.push(`  • ${carLabel(j)}${ins}${since ? ` · ${since}` : ''}`);
    });
    if (list.length > 12) L.push(`  …и ещё ${list.length - 12}`);
    L.push('');
  }

  const cars = onApproval.slice(0, 18).map((j) => ({ id: j.id, plate: j.plate_number || '—' }));
  return { text: L.join('\n').trimEnd(), cars };
}

// ─── Сводка учредителя: состояние ремонтов одним экраном ───
// Ровно то, за чем учредитель следит каждый день: что приехало нового, где стоит
// согласование, каким машинам не хватает запчастей и сколько счетов ждут оплаты.
// Возвращает {text, cars, invoices, approvals} — кнопки под сообщением рисует index.js.

const NEW_CARS_WINDOW_H = 24; // «недавно добавленные» — за сутки (сводка ежедневная)
const SHORT_LIST = 5;         // сколько машин с нехваткой показываем списком

async function founderDigest(now = dayjs()) {
  const [g, unpaid] = await Promise.all([loadGraph(), listUnpaidSupplierInvoices()]);
  const active = g.activeJobs;
  const onApproval = active.filter(isApproval);
  const repair = active.filter(isRepair);

  // 1. Недавно добавленные — по created_at (пишется при заведении машины).
  const since = now.subtract(NEW_CARS_WINDOW_H, 'hour').valueOf();
  const fresh = active
    .filter((j) => {
      const t = toMs(j.created_at);
      return t != null && t >= since;
    })
    .sort((a, b) => (toMs(b.created_at) || 0) - (toMs(a.created_at) || 0));

  // 2. Укомплектованность — только машины в ремонте, где запчасти вообще заведены
  // (у машины без позиций считать нечего, она не «недоукомплектована»).
  const withParts = repair
    .map((j) => ({ j, r: partsReadiness(j.parts) }))
    .filter((x) => x.r.total > 0);
  const complete = withParts.filter((x) => x.r.complete);
  const short = withParts
    .filter((x) => !x.r.complete)
    .sort((a, b) => b.r.missing - a.r.missing || a.r.obtained - b.r.obtained);
  const missingTotal = short.reduce((s, x) => s + x.r.missing, 0);

  // 3. Счета поставщиков к оплате.
  const invSum = unpaid.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const L = ['<b>Состояние ремонтов</b>', ''];
  L.push(`В работе — <b>${active.length}</b> ${plural(active.length, 'авто', 'авто', 'авто')}: ${repair.length} в ремонте, ${onApproval.length} на согласовании.`);
  L.push(DIV);

  // Новые авто.
  if (fresh.length) {
    L.push(`<b>Новые за сутки</b> — ${fresh.length}`);
    fresh.slice(0, 10).forEach((j) => L.push(`  • ${carLabel(j)}`));
    if (fresh.length > 10) L.push(`  …и ещё ${fresh.length - 10}`);
  } else {
    L.push('<b>Новые за сутки</b> — нет');
  }
  L.push('');

  // Согласования — счётчики по под-статусам доски.
  if (onApproval.length) {
    const counts = new Map();
    for (const j of onApproval) {
      const m = approvalStatusMeta(j.approval_status);
      counts.set(m.id, (counts.get(m.id) || 0) + 1);
    }
    L.push(`<b>Согласование со страховой</b> — ${onApproval.length}`);
    APPROVAL_STATUS_META.filter((m) => counts.get(m.id)).forEach((m) => {
      L.push(`  ${m.dot} ${m.label} — ${counts.get(m.id)}`);
    });
  } else {
    L.push('<b>Согласование со страховой</b> — нет машин');
  }
  L.push('');

  // Укомплектованность по запчастям.
  if (!withParts.length) {
    L.push('<b>Запчасти</b> — ни по одной машине позиции ещё не заведены');
  } else {
    L.push(`<b>Запчасти</b> — укомплектованы ${complete.length} из ${withParts.length}`);
    if (short.length) {
      L.push(`  Ждём ${missingTotal} ${plural(missingTotal, 'позицию', 'позиции', 'позиций')} на ${short.length} ${plural(short.length, 'авто', 'авто', 'авто')}:`);
      short.slice(0, SHORT_LIST).forEach(({ j, r }) => {
        L.push(`  • ${carLabel(j)} — ${progressBar(r.obtained, r.total)} ${r.obtained}/${r.total} · ждём ${r.missing}`);
      });
      if (short.length > SHORT_LIST) L.push(`  …и ещё ${short.length - SHORT_LIST}`);
    }
  }
  L.push('');

  // Счета поставщиков.
  L.push(unpaid.length
    ? `<b>Счета к оплате</b> — ${unpaid.length} на <b>${money(invSum)}</b>`
    : '<b>Счета к оплате</b> — нет');

  // Кнопки-номера: сначала те, где не хватает запчастей, затем новые машины.
  const cars = [];
  const seen = new Set();
  for (const j of [...short.slice(0, SHORT_LIST).map((x) => x.j), ...fresh]) {
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    cars.push({ id: j.id, plate: j.plate_number || '—' });
    if (cars.length >= 6) break;
  }

  return {
    text: L.join('\n').trimEnd(),
    cars,
    invoices: unpaid.length,
    approvals: onApproval.length,
  };
}

// Список сохранённых документов машины: заголовок с машиной + кнопки по каждому.
const DOC_LABEL = { order: 'Заказ-наряд', invoice: 'Счёт', act: 'Акт работ', handover: 'Акт приёма-передачи' };

async function jobDocuments(jobId) {
  const [job, docs] = await Promise.all([getJobById(jobId), getDocsForJob(jobId)]);
  const head = `<b>Документы</b>${job ? ` — ${carLabel(job)}` : ''}`;
  const list = docs.map((d) => ({
    id: d.id,
    label: `${DOC_LABEL[d.type] || 'Документ'} №${d.doc_number || '—'}${d.doc_date ? ` · ${fmtDate(d.doc_date)}` : ''}`,
  }));
  return { text: head, docs: list };
}

// ─── Запчасти по машине (полный список) ───
const PARTS_PER_GROUP = 30; // на всякий случай — не упереться в лимит длины сообщения

// canSeeSupply — показывать поставщика и закупку. Это управляющий ИЛИ запчастист:
// поставщик и цена закупки — его рабочий инструмент. Продажная цена остаётся только
// у управляющего, поэтому флаг отдельный (по умолчанию — как раньше, по isManager).
async function partsView(jobId, { isManager, canSeeSupply = isManager }) {
  const job = await getJobById(jobId);
  if (!job) return 'Машина не найдена.';
  const parts = Array.isArray(job.parts) ? job.parts : [];
  const hasPaint = !!(job.paint && job.paint.status);
  const title = `<b>Запчасти</b> — ${esc(job.car_model || 'Авто')}  ·  <code>${esc(job.plate_number || '—')}</code>`;
  if (!parts.length && !hasPaint) {
    return `${title}\n\nПо этой машине запчасти пока не заведены.`;
  }

  // Список позиций группами по статусу — внутри «сворачиваемой цитаты», чтобы
  // длинный перечень не растягивал сообщение (Telegram <blockquote expandable>).
  const body = [];
  for (const meta of PART_STATUS_META) {
    const group = parts.filter((p) => partStatusMeta(p.status).id === meta.id);
    if (!group.length) continue;
    if (body.length) body.push('');
    body.push(`${meta.dot} <b>${meta.label}</b> (${group.length})`);
    group.slice(0, PARTS_PER_GROUP).forEach((p) => {
      const code = p.code ? ` · арт. ${esc(p.code)}` : '';
      const kind = partKindLabel(p.kind) ? ` · ${partKindLabel(p.kind)}` : '';
      let line = `  • ${esc(p.name || 'без названия')}${code} · ×${Number(p.qty) || 1}${kind}`;
      if (meta.id === 'ordered' && p.eta) line += ` · ждём ${esc(p.eta)}`;   // срок — всем
      if (canSeeSupply && p.supplier) line += ` · ${esc(p.supplier)}`;       // поставщик — управляющим и запчастисту
      body.push(line);
    });
    if (group.length > PARTS_PER_GROUP) body.push(`  …и ещё ${group.length - PARTS_PER_GROUP}`);
  }

  const L = [title, ''];
  if (body.length) L.push(`<blockquote expandable>${body.join('\n')}</blockquote>`);

  if (hasPaint) {
    const pm = paintStatusMeta(job.paint.status);
    const extra = [job.paint.code, job.paint.type, job.paint.volume].filter(Boolean).map(esc).join(' · ');
    L.push(`<b>Покраска</b>: ${pm.dot} ${pm.label}${extra ? ` · ${extra}` : ''}`);
  }

  // Деньги по запчастям. Управляющий видит обе суммы; запчастист — только закупку
  // (по ней он и работает), продажная цена = маржа, её ему не показываем.
  if (canSeeSupply && parts.length) {
    const sale = parts.reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
    const cost = parts.reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.cost) || 0), 0);
    if (isManager && (sale || cost)) L.push(`Закупка: ${money(cost)} · продажа: ${money(sale)}`);
    else if (cost) L.push(`Закупка: ${money(cost)}`);
  }
  if (parts.length) {
    const obtained = parts.filter((p) => p.status === 'in' || p.status === 'issued').length;
    L.push(`Всего: <b>${parts.length}</b> ${plural(parts.length, 'позиция', 'позиции', 'позиций')} · ${progressBar(obtained, parts.length)} ${obtained}/${parts.length} в наличии`);
  }
  return L.join('\n').trimEnd();
}

// ─── Фото машины: относительные пути из базы → полные ссылки, сгруппированы до/после ───
async function jobPhotos(jobId) {
  const job = await getJobById(jobId);
  if (!job) return null;
  const photos = Array.isArray(job.photos) ? job.photos : [];
  const abs = (u) => (/^https?:\/\//i.test(u) ? u : `${config.photosBaseUrl}${u}`);
  const before = [];
  const after = [];
  for (const p of photos) {
    if (!p || !p.url) continue;
    (p.category === 'after' ? after : before).push(abs(p.url)); // старые без категории → «до»
  }
  return {
    car: `${job.car_model || 'Авто'} ${job.plate_number || ''}`.trim(),
    before,
    after,
    total: before.length + after.length,
  };
}

module.exports = { search, carsInWork, mastersLoad, dailySummary, carCard, debts, revenue, analytics, upcoming, eveningReminder, jobDocuments, partsView, jobPhotos, openCar, carsBrowse, founderDigest, approvals, PERIOD_LABEL };
