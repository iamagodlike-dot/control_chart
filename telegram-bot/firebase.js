'use strict';
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const config = require('./config');

// Подключаемся к Firestore ТОЛЬКО на чтение (данные не меняем).
// Ключ доступа (сервисный аккаунт) лежит в отдельном файле и в git не попадает.

let db = null;
let ready = false;
let reason = '';

const keyPath = path.resolve(__dirname, config.serviceAccountPath);

if (!fs.existsSync(keyPath)) {
  reason = `Файл ключа доступа не найден: ${keyPath}`;
} else {
  try {
    const serviceAccount = require(keyPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: config.projectId,
    });
    db = admin.firestore();
    ready = true;
  } catch (e) {
    reason = `Не удалось подключиться к базе: ${e.message}`;
  }
}

module.exports = {
  db,
  isReady: () => ready,
  reason: () => reason,
};
