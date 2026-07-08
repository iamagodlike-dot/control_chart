// Вход для серверного рендера документов. Импортирует ТЕ ЖЕ React-компоненты,
// что рисуют документы на сайте, — так вёрстка получается идентичной.
// Собирается в bundle.cjs через esbuild (см. build.sh).
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import OrderDocument from '../../client/src/components/OrderDocument.jsx';
import DocSheet from '../../client/src/components/DocSheet.jsx';
import { buildPaymentQrString } from '../../client/src/orderDoc.js';

export function renderDoc(snapshot, qrDataUrl) {
  const el = snapshot.type === 'order'
    ? createElement(OrderDocument, { snapshot })
    : createElement(DocSheet, { snapshot, qrDataUrl });
  return renderToStaticMarkup(el);
}

export { buildPaymentQrString };
