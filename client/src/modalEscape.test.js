import test from 'node:test';
import assert from 'node:assert/strict';
import { domDepth, topmost } from './modalEscape.js';

// DOM здесь не нужен: обеим функциям хватает цепочки parentElement, поэтому окна
// изображаем простыми объектами. Проверяем ровно то, на чём легко ошибиться, —
// кого из открытых окон разбудит Escape.

const node = (parent = null) => ({ parentElement: parent });

const body = node();
const card = node(body);            // карточка машины
const docs = node(card);            // документы — внутри карточки
const viewer = node(docs);          // просмотр фото — внутри документов
const popover = node(body);         // календарь: портал в body, но визуально сверху

test('глубина считается по цепочке родителей', () => {
  assert.equal(domDepth(body), 1);
  assert.equal(domDepth(card), 2);
  assert.equal(domDepth(viewer), 4);
  assert.equal(domDepth(null), 0);
});

test('Escape будит самое вложенное окно, а не открытое последним', () => {
  const items = [
    { el: viewer, id: 'viewer' },
    { el: card, id: 'card' },
    { el: docs, id: 'docs' },
  ];
  assert.equal(topmost(items).id, 'viewer');
  // Порядок в списке ничего не решает — иначе порядок монтирования эффектов
  // (снизу вверх) закрывал бы родителя вместо ребёнка.
  assert.equal(topmost([...items].reverse()).id, 'viewer');
});

test('попап поверх окна выигрывает у более глубокой модалки', () => {
  const items = [
    { el: viewer, id: 'viewer' },
    { el: popover, id: 'popover', level: 1 },
  ];
  assert.equal(topmost(items).id, 'popover');
});

test('окно без элемента в подсчёте не участвует', () => {
  assert.equal(topmost([{ el: null, id: 'unmounted' }, { el: card, id: 'card' }]).id, 'card');
  assert.equal(topmost([]), null);
  assert.equal(topmost([{ el: null, id: 'unmounted' }]), null);
});
