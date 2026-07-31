// Выбор счетов, участвующих в деньгах. Zero-dependency —
// run with:  node --test src/invoices.test.js
//
// Главное, что здесь доказывается:
//  1. дубли одного ремонта больше не складываются (ради этого всё и делалось);
//  2. РАЗНЫЕ убытки и допродажи клиента складываться НЕ перестали — иначе фикс
//     дублей молча съел бы половину выручки по многоубыточным машинам;
//  3. одиночный счёт (весь легаси-прод) ведёт себя ровно как раньше.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countedInvoices, countedInvoiceIds, invoiceRole, invoiceStream, invoiceStatus,
  countedSummary, ROLE_EXTRA, ROLE_VOID,
} from './invoices.js';

// Счёт: id, машина, поток, момент выставления.
function inv(id, job_id, recipient, created_at, extra = {}) {
  return { id, job_id, recipient, created_at, type: 'invoice', ...extra };
}
const ids = (list) => countedInvoices(list).map((i) => i.id).sort();

// ===== ОДИН СЧЁТ: ничего не изменилось =====
test('единственный счёт всегда учитывается', () => {
  assert.deepEqual(ids([inv('a', 'j1', 'insurance', 100)]), ['a']);
});

test('легаси-счёт без recipient и без created_at не выпадает', () => {
  const legacy = { id: 'a', job_id: 'j1', type: 'invoice', doc_date: '2026-01-10' };
  assert.deepEqual(ids([legacy]), ['a']);
});

// ===== ДУБЛИ: считается последний =====
test('два счёта по одному убытку — считается последний выставленный', () => {
  const list = [inv('old', 'j1', 'insurance', 100), inv('new', 'j1', 'insurance', 200)];
  assert.deepEqual(ids(list), ['new']);
  assert.deepEqual(ids(list.slice().reverse()), ['new'], 'порядок в массиве не влияет');
});

test('легаси-счёт без recipient и новый по тому же убытку — это один поток', () => {
  // Ровно тот случай с прода: старый счёт сохранён до появления убытков.
  const list = [
    { id: 'old', job_id: 'j1', type: 'invoice', created_at: 100 },
    inv('new', 'j1', 'insurance', 200),
  ];
  assert.deepEqual(ids(list), ['new']);
});

test('обычная машина: recipient «all» — тот же поток, что «insurance»', () => {
  const list = [inv('old', 'j1', 'all', 100), inv('new', 'j1', 'all', 200)];
  assert.deepEqual(ids(list), ['new']);
  assert.equal(invoiceStream(inv('x', 'j1', 'all', 1)), 'insurance');
});

test('при равных датах выбор устойчив (не зависит от порядка)', () => {
  const list = [inv('a', 'j1', 'insurance', 100), inv('b', 'j1', 'insurance', 100)];
  assert.deepEqual(ids(list), ids(list.slice().reverse()));
});

// ===== РАЗНЫЕ ПОТОКИ: складываются =====
test('счета разных убытков и допродаж клиента складываются', () => {
  const list = [
    inv('ins', 'j1', 'insurance', 100),
    inv('cl2', 'j1', 'cl_k3f9', 110),
    inv('client', 'j1', 'client', 120),
  ];
  assert.deepEqual(ids(list), ['cl2', 'client', 'ins']);
});

test('дубли внутри второго убытка схлопываются, первый убыток не трогают', () => {
  const list = [
    inv('ins', 'j1', 'insurance', 100),
    inv('cl2-old', 'j1', 'cl_k3f9', 110),
    inv('cl2-new', 'j1', 'cl_k3f9', 120),
  ];
  assert.deepEqual(ids(list), ['cl2-new', 'ins']);
});

test('счета разных машин не смешиваются', () => {
  const list = [inv('a', 'j1', 'insurance', 100), inv('b', 'j2', 'insurance', 200)];
  assert.deepEqual(ids(list), ['a', 'b']);
});

test('счёт без машины считается сам по себе', () => {
  const list = [inv('free1', null, 'all', 100), inv('free2', null, 'all', 200)];
  assert.deepEqual(ids(list), ['free1', 'free2']);
});

// ===== РУЧНЫЕ ПОМЕТКИ =====
test('«доп. счёт» складывается с основным', () => {
  const list = [
    inv('avans', 'j1', 'insurance', 100, { billing_role: ROLE_EXTRA }),
    inv('ostatok', 'j1', 'insurance', 200),
  ];
  assert.deepEqual(ids(list), ['avans', 'ostatok']);
});

test('«доп. счёт» не отменяет правило для остальных', () => {
  const list = [
    inv('avans', 'j1', 'insurance', 100, { billing_role: ROLE_EXTRA }),
    inv('old', 'j1', 'insurance', 150),
    inv('new', 'j1', 'insurance', 200),
  ];
  assert.deepEqual(ids(list), ['avans', 'new']);
});

test('помеченный «не учитывать» выпадает, и основным становится предыдущий', () => {
  const list = [
    inv('good', 'j1', 'insurance', 100),
    inv('dubl', 'j1', 'insurance', 200, { billing_role: ROLE_VOID }),
  ];
  assert.deepEqual(ids(list), ['good']);
});

test('все счета помечены «не учитывать» — денег по машине нет', () => {
  const list = [inv('a', 'j1', 'insurance', 100, { billing_role: ROLE_VOID })];
  assert.deepEqual(ids(list), []);
});

test('роль по умолчанию — обычный счёт', () => {
  assert.equal(invoiceRole({}), 'auto');
  assert.equal(invoiceRole({ billing_role: 'ерунда' }), 'auto');
  assert.equal(invoiceRole({ billing_role: ROLE_EXTRA }), 'extra');
});

// ===== ПОДПИСИ ДЛЯ ИНТЕРФЕЙСА =====
test('статус счёта в списке', () => {
  const list = [
    inv('old', 'j1', 'insurance', 100),
    inv('new', 'j1', 'insurance', 200),
    inv('extra', 'j1', 'insurance', 150, { billing_role: ROLE_EXTRA }),
    inv('dubl', 'j1', 'insurance', 180, { billing_role: ROLE_VOID }),
  ];
  const cnt = countedInvoiceIds(list);
  assert.equal(invoiceStatus(list[0], cnt), 'replaced');
  assert.equal(invoiceStatus(list[1], cnt), 'main');
  assert.equal(invoiceStatus(list[2], cnt), 'extra');
  assert.equal(invoiceStatus(list[3], cnt), 'void');
});

test('подпись «что считается» появляется только когда что-то отброшено', () => {
  assert.equal(countedSummary([inv('a', 'j1', 'insurance', 100)]), '');
  // Два разных убытка — оба считаются, объяснять нечего.
  assert.equal(countedSummary([inv('a', 'j1', 'insurance', 100), inv('b', 'j1', 'client', 200)]), '');
  const s = countedSummary([
    inv('old', 'j1', 'insurance', 100, { doc_number: 'СЧ-0001' }),
    inv('new', 'j1', 'insurance', 200, { doc_number: 'СЧ-0002' }),
  ]);
  assert.match(s, /СЧ-0002/);
  assert.match(s, /не учитывается: 1/);
});
