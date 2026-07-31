// Guards the access-decision rules in roles.js. Zero-dependency —
// run with:  node --test src/roles.test.js
// These branches are the safety net for rolling roles out without locking
// anyone (owner or the whole shop) out — change them only deliberately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAccess, roleTabs, roleHome, ROLE_ORDER } from './roles.js';

test('bootstrap — empty list → first login is owner (so it can assign roles)', () => {
  const d = decideAccess([], 'boss@shop.ru');
  assert.equal(d.status, 'ready');
  assert.equal(d.role, 'owner');
});

test('known active user → its role', () => {
  const list = [{ email: 'master@shop.ru', role: 'master', active: true }];
  assert.deepEqual(
    { status: decideAccess(list, 'master@shop.ru').status, role: decideAccess(list, 'master@shop.ru').role },
    { status: 'ready', role: 'master' },
  );
});

test('email match is case-insensitive and trims', () => {
  const list = [{ email: 'Boss@Shop.ru', role: 'owner', active: true }];
  assert.equal(decideAccess(list, '  BOSS@shop.RU ').role, 'owner');
});

test('record keyed by doc id (no email field) still matches', () => {
  const list = [{ id: 'exp@shop.ru', role: 'expeditor', active: true }];
  assert.equal(decideAccess(list, 'exp@shop.ru').role, 'expeditor');
});

test('deactivated user → denied (even though signed in)', () => {
  const list = [{ email: 'ex@shop.ru', role: 'master', active: false }];
  assert.equal(decideAccess(list, 'ex@shop.ru').status, 'denied');
});

test('unknown email but list is non-empty → denied (an outsider)', () => {
  const list = [{ email: 'boss@shop.ru', role: 'owner', active: true }];
  assert.equal(decideAccess(list, 'stranger@evil.ru').status, 'denied');
});

test('unknown role string falls back to owner, never locks a real record out', () => {
  const list = [{ email: 'x@shop.ru', role: 'wat', active: true }];
  const d = decideAccess(list, 'x@shop.ru');
  assert.equal(d.status, 'ready');
  assert.equal(d.role, 'owner');
});

test('missing active flag counts as active (only explicit false denies)', () => {
  const list = [{ email: 'a@shop.ru', role: 'expeditor' }];
  assert.equal(decideAccess(list, 'a@shop.ru').status, 'ready');
});

test('tab maps: owner sees финансы+настройки, line staff do not', () => {
  assert.ok(roleTabs('owner').includes('finance'));
  assert.ok(roleTabs('owner').includes('config'));
  assert.ok(!roleTabs('master').includes('finance'));
  assert.ok(!roleTabs('expeditor').includes('finance'));
  assert.ok(!roleTabs('expeditor').includes('config'));
  // Кабинет экспедитора: приёмка + история приёмки + закупки (видит одобренное) +
  // свои траты. Заявки НЕ создаёт — вкладки 'requests' у него нет.
  assert.ok(!roleTabs('expeditor').includes('requests'));
  assert.deepEqual(roleTabs('expeditor'), ['receiving', 'receiving-history', 'purchasing', 'expenses']);
});

test('запчастист: только склад и запчасти, без денег и настроек', () => {
  const tabs = roleTabs('partsman');
  assert.deepEqual(tabs, ['parts', 'warehouse']);
  assert.ok(!tabs.includes('finance'));
  assert.ok(!tabs.includes('config'));
  // Известная роль — не должна проваливаться в fallback «owner».
  const d = decideAccess([{ email: 'zap@shop.ru', role: 'partsman', active: true }], 'zap@shop.ru');
  assert.equal(d.role, 'partsman');
});

// Derived from ROLE_ORDER, not a hardcoded list — a role added to roles.js with a
// home tab it can't see would otherwise slip through untested.
test('each role home tab is within its own allowed tabs', () => {
  for (const r of ROLE_ORDER) {
    assert.ok(roleTabs(r).includes(roleHome(r)), `home of ${r} must be an allowed tab`);
  }
});

test('мастер-приёмщик: дефектовка, цех и запчасти — без денег и настроек', () => {
  const tabs = roleTabs('receptionist');
  assert.deepEqual(tabs, ['intake', 'approval', 'gantt', 'board', 'monitor',
    'parts', 'warehouse', 'receiving', 'receiving-history']);
  assert.equal(roleHome('receptionist'), 'intake');
  // «Заявки» и «Закупки» — это запись потраченных денег, приёмщику они закрыты
  // вместе с остальными денежными экранами.
  for (const forbidden of ['finance', 'payroll', 'staffexpenses', 'config',
    'supplier-invoices', 'purchasing', 'requests', 'expenses']) {
    assert.ok(!tabs.includes(forbidden), `приёмщику не положен экран ${forbidden}`);
  }
  // Известная роль — не должна проваливаться в fallback «owner».
  const d = decideAccess([{ email: 'priem@shop.ru', role: 'receptionist', active: true }], 'priem@shop.ru');
  assert.equal(d.status, 'ready');
  assert.equal(d.role, 'receptionist');
});

test('управленец видит экран «Приёмка авто»', () => {
  assert.ok(roleTabs('owner').includes('intake'));
});

test('учредитель: только счета поставщиков, без прочих экранов; роль не падает в fallback', () => {
  const tabs = roleTabs('founder');
  assert.deepEqual(tabs, ['supplier-invoices']);
  assert.ok(!tabs.includes('finance'));
  assert.ok(!tabs.includes('config'));
  assert.ok(!tabs.includes('parts'));
  const d = decideAccess([{ email: 'inv@shop.ru', role: 'founder', active: true }], 'inv@shop.ru');
  assert.equal(d.status, 'ready');
  assert.equal(d.role, 'founder'); // известная роль, не «owner»
});

test('управленец видит вкладку «Счета поставщиков»', () => {
  assert.ok(roleTabs('owner').includes('supplier-invoices'));
});
