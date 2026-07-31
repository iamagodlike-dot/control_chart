// Группировка вкладок в шапке — чистая часть, вынесена из NavGroup.jsx, чтобы
// гонялась тестами (в .jsx лежит React, node --test его не разберёт).
//
// Управленец видит полтора десятка экранов; плоский ряд из них — стена. Поэтому
// вкладки складываются в несколько подписанных групп: первая в списке — «главная»
// группы, по клику открывается она, остальные под галочкой.
//
// ГЛАВНОЕ ПРАВИЛО: экран, забытый в этих списках, ДОЛЖЕН остаться доступным.
// Раньше он молча пропадал из меню — так у управленца потерялись «Счета
// поставщиков». Теперь такие вкладки возвращаются отдельным списком `loose` и
// рисуются обычными кнопками (см. тест «ни одна вкладка роли не теряется»).

// Все экраны приложения: id, подпись и иконка. Живут здесь, а не в App.jsx,
// чтобы список ролей (roles.js) и группировку можно было сверить тестом — экран,
// выданный роли, но не заведённый здесь, просто не нарисуется.
export const TABS = [
  { id: 'mywork', label: 'Мои машины', icon: 'car' },
  { id: 'earnings', label: 'Мой заработок', icon: 'wallet' },
  { id: 'approval', label: 'Согласование', icon: 'shield' },
  { id: 'intake', label: 'Дефектовка', icon: 'clipboard' },
  { id: 'gantt', label: 'График', icon: 'calendar' },
  { id: 'board', label: 'Загрузка', icon: 'chart' },
  { id: 'monitor', label: 'Монитор', icon: 'clock' },
  { id: 'warehouse', label: 'Склад', icon: 'box' },
  { id: 'parts', label: 'Запчасти', icon: 'wrench' },
  // «Приёмка запчастей», а не просто «Приёмка»: рядом висит экран приёмщика
  // («Дефектовка»), и путать заезд машины с приходом деталей нельзя.
  { id: 'receiving', label: 'Приёмка запчастей', icon: 'box' },
  { id: 'receiving-history', label: 'История приёмки', icon: 'history' },
  { id: 'requests', label: 'Заявки', icon: 'clipboard' },
  { id: 'purchasing', label: 'Закупки', icon: 'cart' },
  { id: 'supplier-invoices', label: 'Счета поставщиков', icon: 'receipt' },
  { id: 'expenses', label: 'Мои траты', icon: 'receipt' },
  { id: 'finance', label: 'Финансы', icon: 'wallet' },
  { id: 'payroll', label: 'Зарплата', icon: 'receipt' },
  { id: 'staffexpenses', label: 'Траты', icon: 'receipt' },
  { id: 'history', label: 'История', icon: 'history' },
];

export const NAV_GROUPS = [
  { id: 'shop', label: 'Цех', icon: 'car', tabs: ['gantt', 'approval', 'intake', 'board', 'monitor'] },
  { id: 'parts', label: 'Запчасти', icon: 'wrench', tabs: ['parts', 'warehouse', 'receiving', 'receiving-history', 'requests', 'purchasing'] },
  { id: 'money', label: 'Деньги', icon: 'wallet', tabs: ['finance', 'payroll', 'staffexpenses', 'expenses'] },
  { id: 'archive', label: 'История', icon: 'history', tabs: ['history'] },
];

// Разложить вкладки роли по группам. `tabs` — метаданные вкладок, `allowed` —
// что этой роли положено, `home` — её стартовый экран. Пустые группы отбрасываем,
// всё, что не попало ни в одну, отдаём отдельно.
//
// Первый экран группы — её «главный»: по клику на название открывается именно он.
// Поэтому стартовый экран роли поднимаем в своей группе наверх: у приёмщика клик
// по «Цеху» должен открывать «Дефектовку», а у управленца — «График». Иначе
// человеку каждый раз пришлось бы лезть в выпадающий список за своим же экраном.
export function splitTabs(tabs, allowed, home = '') {
  const list = Array.isArray(tabs) ? tabs : [];
  const may = new Set(Array.isArray(allowed) ? allowed : []);
  const byId = Object.fromEntries(list.map((t) => [t.id, t]));

  const groups = NAV_GROUPS
    .map((g) => {
      const members = g.tabs.filter((id) => may.has(id)).map((id) => byId[id]).filter(Boolean);
      const hi = members.findIndex((m) => m.id === home);
      if (hi > 0) members.unshift(...members.splice(hi, 1));
      return { ...g, members };
    })
    .filter((g) => g.members.length > 0);

  const grouped = new Set(NAV_GROUPS.flatMap((g) => g.tabs));
  const loose = list.filter((t) => may.has(t.id) && !grouped.has(t.id));

  return { groups, loose };
}
