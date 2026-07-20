'use strict';
// Разовый деплой правил Firestore через Firebase Rules API служебным ключом
// (когда нет firebase CLI). Сначала сохраняет текущие правила в backup-файл (для
// отката), затем создаёт новый ruleset из ../firestore.rules и переключает релиз
// cloud.firestore на него. Правила API валидирует до публикации.
const fs = require('fs');
const path = require('path');
const { JWT } = require('google-auth-library');

const PROJECT = process.env.FIREBASE_PROJECT_ID || 'gannt-9b15d';
const BASE = 'https://firebaserules.googleapis.com/v1';
const sa = require('./service-account.json');
const rulesPath = path.resolve(__dirname, '..', 'firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf8');

async function main() {
  const client = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const { access_token } = await client.authorize();
  const H = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };

  const req = async (method, url, body) => {
    const res = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { ok: res.ok, status: res.status, json };
  };

  // 1) Текущий релиз (бэкап)
  const rel = await req('GET', `${BASE}/projects/${PROJECT}/releases/cloud.firestore`);
  if (!rel.ok) { console.error('❌ Нет доступа к Rules API (GET release):', rel.status, JSON.stringify(rel.json)); process.exit(2); }
  const oldRuleset = rel.json.rulesetName;
  console.log('Текущий ruleset:', oldRuleset);

  const cur = await req('GET', `${BASE}/${oldRuleset}`);
  if (cur.ok && cur.json.source) {
    const backup = path.resolve(__dirname, 'firestore.rules.backup');
    fs.writeFileSync(backup, (cur.json.source.files || []).map((f) => f.content).join('\n'));
    console.log('Бэкап текущих правил →', backup);
  }

  // 2) Создать новый ruleset
  const created = await req('POST', `${BASE}/projects/${PROJECT}/rulesets`, {
    source: { files: [{ name: 'firestore.rules', content: rulesContent }] },
  });
  if (!created.ok) { console.error('❌ Не удалось создать ruleset:', created.status, JSON.stringify(created.json)); process.exit(3); }
  const newRuleset = created.json.name;
  console.log('Новый ruleset:', newRuleset);

  // 3) Переключить релиз на новый ruleset
  let upd = await req('PATCH', `${BASE}/projects/${PROJECT}/releases/cloud.firestore?updateMask=rulesetName`, {
    name: `projects/${PROJECT}/releases/cloud.firestore`,
    rulesetName: newRuleset,
  });
  if (!upd.ok) {
    // запасной вариант — без updateMask
    upd = await req('PATCH', `${BASE}/projects/${PROJECT}/releases/cloud.firestore`, {
      name: `projects/${PROJECT}/releases/cloud.firestore`,
      rulesetName: newRuleset,
    });
  }
  if (!upd.ok) { console.error('❌ Не удалось переключить релиз:', upd.status, JSON.stringify(upd.json)); console.error('Откат: релиз всё ещё на', oldRuleset); process.exit(4); }

  // 4) Проверка
  const check = await req('GET', `${BASE}/projects/${PROJECT}/releases/cloud.firestore`);
  console.log('✅ Правила опубликованы. Релиз теперь на:', check.json.rulesetName);
  console.log('Откат при необходимости: PATCH release → rulesetName =', oldRuleset);
}

main().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
