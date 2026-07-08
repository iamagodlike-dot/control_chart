'use strict';
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { renderDoc, buildPaymentQrString } = require('./docrender/bundle.cjs');

// Печать сохранённых документов в PDF — точно как на сайте:
// те же React-компоненты (bundle.cjs) + те же стили (orderDoc.css) + headless-браузер.

const CSS = fs.readFileSync(path.join(__dirname, 'assets', 'orderDoc.css'), 'utf8');
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'assets', 'logo-mark.png')).toString('base64');
const FONT_REG = fs.readFileSync(path.join(__dirname, 'fonts', 'Roboto-Regular.ttf')).toString('base64');
const FONT_BOLD = fs.readFileSync(path.join(__dirname, 'fonts', 'Roboto-Bold.ttf')).toString('base64');

const DOC_LABEL = { order: 'Заказ-наряд', act: 'Акт работ', invoice: 'Счёт', handover: 'Акт приёма-передачи' };
const DOC_SLUG = { order: 'zakaz-naryad', act: 'akt-rabot', invoice: 'schet', handover: 'akt-priema-peredachi' };

function fileSafe(s) {
  return String(s || '').replace(/[/\\:*?"<>|\s]+/g, '-');
}

// Собираем полный HTML-документ (шрифт + стили + логотип + разметка).
async function buildHtml(snapshot) {
  let qr = null;
  if (snapshot.type === 'invoice' && snapshot.show_qr) {
    try {
      qr = await QRCode.toDataURL(buildPaymentQrString(snapshot), { margin: 1, width: 256 });
    } catch { /* без QR, если реквизиты неполные */ }
  }
  let inner = renderDoc(snapshot, qr);
  inner = inner.replace(/\/logo-mark\.png/g, LOGO); // логотип в файл, без внешних запросов

  const head = `
    @font-face{font-family:'Roboto';font-style:normal;font-weight:400;src:url(data:font/ttf;base64,${FONT_REG}) format('truetype');}
    @font-face{font-family:'Roboto';font-style:normal;font-weight:700;src:url(data:font/ttf;base64,${FONT_BOLD}) format('truetype');}
    html,body{margin:0;padding:0;background:#fff;}
    #zn-print-mount{display:block!important;}
    #zn-print-mount .zn-sheet{box-shadow:none;margin:0;width:auto;min-height:auto;padding:0;}
  `;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${head}\n${CSS}</style></head><body><div id="zn-print-mount">${inner}</div></body></html>`;
}

function fileName(snapshot) {
  const slug = DOC_SLUG[snapshot.type] || 'document';
  return `${slug}-${fileSafe(snapshot.doc_number || '')}.pdf`;
}

// ── Puppeteer (headless-браузер) держим тёплым между запросами ──
let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    const puppeteer = require('puppeteer');
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

async function renderPdf(snapshot) {
  const html = await buildHtml(snapshot);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    return { buffer: Buffer.from(pdf), filename: fileName(snapshot) };
  } finally {
    await page.close();
  }
}

module.exports = { buildHtml, renderPdf, fileName, DOC_LABEL };
