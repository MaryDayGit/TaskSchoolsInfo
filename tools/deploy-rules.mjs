#!/usr/bin/env node
/*
 * Публикует firestore/firestore.rules в проект klas-pult через Firebase Rules API.
 *
 * Зачем не `firebase deploy --only firestore:rules`: перед публикацией он
 * проверяет, включён ли Firestore API (serviceusage), а у ключа сервисного
 * аккаунта Firebase Admin SDK на это нет прав (HTTP 403). Rules API ему доступен.
 *
 * Ключ: GOOGLE_APPLICATION_CREDENTIALS = путь к JSON-файлу сервисного аккаунта.
 * Запуск: node tools/deploy-rules.mjs [projectId]   (по умолчанию klas-pult)
 * Правила с ошибками компиляции Rules API не примет — старые останутся.
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const project = process.argv[2] ?? 'klas-pult';
const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyFile) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set');
  process.exit(1);
}
const key = JSON.parse(readFileSync(keyFile, 'utf8'));
if (key.project_id !== project) {
  console.error(`The key is for "${key.project_id}", not for "${project}"`);
  process.exit(1);
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/firebase',
    aud: key.token_uri,
    iat: now,
    exp: now + 600,
  })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`token: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function api(token, method, path, body) {
  const res = await fetch(`https://firebaserules.googleapis.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const content = readFileSync(new URL('../firestore/firestore.rules', import.meta.url), 'utf8');
const token = await accessToken();
const ruleset = await api(token, 'POST', `projects/${project}/rulesets`, {
  source: { files: [{ name: 'firestore.rules', content }] },
});
const release = `projects/${project}/releases/cloud.firestore`;
await api(token, 'PATCH', release, { release: { name: release, rulesetName: ruleset.name } });
console.log(`Firestore rules released: ${ruleset.name}`);
