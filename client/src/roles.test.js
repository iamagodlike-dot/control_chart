// Guards the access-decision rules in roles.js. Zero-dependency —
// run with:  node --test src/roles.test.js
// These branches are the safety net for rolling roles out without locking
// anyone (owner or the whole shop) out — change them only deliberately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAccess, roleTabs, roleHome } from './roles.js';

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
  // Кабинет экспедитора: приёмка + свои траты (без финансов/настроек).
  assert.deepEqual(roleTabs('expeditor'), ['receiving', 'expenses']);
});

test('each role home tab is within its own allowed tabs', () => {
  for (const r of ['owner', 'master', 'expeditor']) {
    assert.ok(roleTabs(r).includes(roleHome(r)), `home of ${r} must be an allowed tab`);
  }
});
