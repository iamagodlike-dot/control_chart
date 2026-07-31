// Тесты меню в шапке. Запуск:  node --test src/nav.test.js
//
// Главное, что здесь проверяется, — что человек не теряет доступ к экрану из-за
// того, что кто-то забыл вписать его в группу. Именно так у управленца пропали
// «Счета поставщиков»: экран существовал, роль его имела, а в меню его не было.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_GROUPS, TABS, splitTabs } from './nav.js';
import { ROLES, ROLE_ORDER, roleHome, roleTabs } from './roles.js';

const idsOf = ({ groups, loose }) => [
  ...groups.flatMap((g) => g.members.map((m) => m.id)),
  ...loose.map((t) => t.id),
];

test('ни одна вкладка роли не теряется в меню', () => {
  for (const role of ROLE_ORDER) {
    // 'config' — шестерёнка в шапке, в ряду вкладок её нет по замыслу.
    const expected = roleTabs(role).filter((id) => id !== 'config');
    const shown = idsOf(splitTabs(TABS, roleTabs(role)));
    assert.deepEqual(
      [...shown].sort(),
      [...expected].sort(),
      `у роли «${ROLES[role].label}» меню показывает не те экраны`,
    );
  }
});

test('«Счета поставщиков» не входят ни в одну группу — и всё равно видны', () => {
  const grouped = new Set(NAV_GROUPS.flatMap((g) => g.tabs));
  assert.ok(!grouped.has('supplier-invoices'), 'экран не в группе — именно этот случай и чиним');
  const { loose } = splitTabs(TABS, roleTabs('owner'));
  assert.ok(loose.some((t) => t.id === 'supplier-invoices'));
});

test('у каждой роли есть метаданные вкладки — иначе экран просто не нарисуется', () => {
  const known = new Set(TABS.map((t) => t.id));
  for (const role of ROLE_ORDER) {
    for (const id of roleTabs(role)) {
      if (id === 'config') continue;
      assert.ok(known.has(id), `вкладка «${id}» роли «${role}» не заведена в TABS`);
    }
  }
});

test('приёмщик: цех и запчасти группами, денежных групп нет', () => {
  const { groups, loose } = splitTabs(TABS, roleTabs('receptionist'), roleHome('receptionist'));
  assert.deepEqual(groups.map((g) => g.label), ['Цех', 'Запчасти']);
  assert.deepEqual(loose, []);
  assert.ok(!groups.some((g) => g.label === 'Деньги'));
});

test('клик по названию группы открывает свой экран, а не чужой', () => {
  // У приёмщика в «Цеху» наверх поднимается «Дефектовка»…
  const priem = splitTabs(TABS, roleTabs('receptionist'), roleHome('receptionist'));
  assert.equal(priem.groups[0].members[0].id, 'intake');
  // …а у управленца там по-прежнему «График».
  const owner = splitTabs(TABS, roleTabs('owner'), roleHome('owner'));
  assert.equal(owner.groups[0].members[0].id, 'gantt');
  // Порядок внутри группы в остальном сохраняется — перетасовки нет.
  assert.deepEqual(priem.groups[0].members.map((m) => m.id), ['intake', 'gantt', 'approval', 'board', 'monitor']);
  // Стартовый экран вне групп ничего не ломает.
  assert.deepEqual(splitTabs(TABS, ['history'], 'mywork').groups[0].members.map((m) => m.id), ['history']);
});

test('пустые группы отбрасываются, группа с одним экраном остаётся', () => {
  const { groups } = splitTabs(TABS, ['history']);
  assert.deepEqual(groups.map((g) => g.label), ['История']);
  assert.equal(groups[0].members.length, 1);
  assert.deepEqual(splitTabs(TABS, []).groups, []);
});
