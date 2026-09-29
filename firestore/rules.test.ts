/*
 * Тесты правил Firestore (firestore/firestore.rules) на эмуляторе.
 * Запуск: npm run test:rules (сам поднимает эмулятор Firestore).
 *
 * Этап 1: это тесты Клас-пульта (klas-pult @ d3f4eac, tests/rules.test.js),
 * перенесённые без изменения смысла. Они обязаны проходить, пока Клас-пульт
 * работает на уроках. Все пользователи анонимные; учитель — тот, у кого есть
 * teachers/{uid}, созданный с правильным кодом из secret/teacher.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { setLogLevel } from 'firebase/firestore';

// Ожидаемые отказы (PERMISSION_DENIED) SDK пишет в консоль — прячем этот шум.
setLogLevel('silent');

const PROJECT_ID = 'demo-klas-pult';
const CODE = '1234';

let env: RulesTestEnvironment;

const anon = (uid: string) =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const teacher = () => anon('teacher-uid');
const student = (uid?: string) => anon(uid || 'anon-1');
const nobody = () => env.unauthenticatedContext().firestore();

const longName = 'а'.repeat(61);

beforeAll(async () => {
  const rules = readFileSync(fileURLToPath(new URL('./firestore.rules', import.meta.url)), 'utf8');
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules } });
});

beforeEach(async () => {
  await env.clearFirestore();
  // Исходные данные — в обход правил
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('secret/teacher').set({ code: CODE });
    await db.doc('setup/state').set({ codeSet: true });
    await db.doc('teachers/teacher-uid').set({ code: CODE });
    await db.doc('control/state').set({ task: null, locked: false, resetAt: 1 });
    await db.doc('tests/t1').set({ title: 'Тест', questions: [], count: 0 });
    await db.doc('keys/t1').set({ answers: [0, 1] });
    await db.doc('results/r1').set({ testId: 't1', pc: 'pc03', name: 'Інший', answers: [0] });
    await db.doc('students/pc03').set({ pc: 'pc03', num: 3, name: 'Інший' });
  });
});

afterAll(async () => {
  if (env) await env.cleanup();
});

// ---------- Код учителя ----------

it('код учителя: secret никто не читает и не меняет', async () => {
  await assertFails(student().doc('secret/teacher').get());
  await assertFails(teacher().doc('secret/teacher').get());
  await assertFails(student().doc('secret/teacher').set({ code: '9999' }));
  await assertFails(teacher().doc('secret/teacher').set({ code: '9999' }));
  await assertFails(teacher().doc('secret/teacher').delete());
  await assertSucceeds(student().doc('setup/state').get());
  await assertFails(nobody().doc('setup/state').get());
  await assertFails(student().doc('setup/state').set({ codeSet: false }));
  await assertFails(student().doc('setup/state').delete());
});

it('код учителя: неверный код не делает учителем, верный — делает', async () => {
  const db = student('anon-5');
  await assertFails(db.doc('teachers/anon-5').set({ code: '0000' }));
  await assertFails(db.doc('keys/t1').get());
  await assertSucceeds(db.doc('teachers/anon-5').set({ code: CODE }));
  await assertSucceeds(db.doc('keys/t1').get());
  await assertSucceeds(db.doc('control/state').set({ locked: true }, { merge: true }));
});

it('код учителя: отметку нельзя записать за другого и нельзя подсмотреть', async () => {
  const db = student('anon-6');
  await assertFails(db.doc('teachers/someone-else').set({ code: CODE }));
  await assertFails(db.doc('teachers/anon-6').set({ code: CODE, admin: true }));
  await assertFails(db.doc('teachers/teacher-uid').get());
  await assertFails(db.collection('teachers').get());
  await assertFails(db.doc('teachers/teacher-uid').delete());
  await assertSucceeds(teacher().doc('teachers/teacher-uid').get());
});

it('«Вийти»: учитель удаляет свою отметку и теряет доступ', async () => {
  await assertSucceeds(teacher().doc('keys/t1').get());
  await assertSucceeds(teacher().doc('teachers/teacher-uid').delete());
  await assertFails(teacher().doc('keys/t1').get());
});

it('первый запуск: код создаётся один раз и только пакетом', async () => {
  await env.clearFirestore();
  const first = student('anon-7');
  // Только secret без флага — нельзя; слишком короткий код — нельзя
  await assertFails(first.doc('secret/teacher').set({ code: CODE }));
  const short = first.batch();
  short.set(first.doc('secret/teacher'), { code: '12' });
  short.set(first.doc('setup/state'), { codeSet: true });
  await assertFails(short.commit());
  // Правильный пакет: код + флаг + «я учитель»
  const batch = first.batch();
  batch.set(first.doc('secret/teacher'), { code: '5555' });
  batch.set(first.doc('setup/state'), { codeSet: true });
  batch.set(first.doc('teachers/anon-7'), { code: '5555' });
  await assertSucceeds(batch.commit());
  await assertSucceeds(first.doc('keys/x').set({ answers: [0] }));
  // Второй раз придумать код уже нельзя
  const second = student('anon-8');
  const again = second.batch();
  again.set(second.doc('secret/teacher'), { code: '6666' });
  again.set(second.doc('setup/state'), { codeSet: true });
  again.set(second.doc('teachers/anon-8'), { code: '6666' });
  await assertFails(again.commit());
  await assertSucceeds(second.doc('teachers/anon-8').set({ code: '5555' }));
});

// ---------- Урок ----------

it('control/state: читают вошедшие, пишет только учитель', async () => {
  await assertSucceeds(student().doc('control/state').get());
  await assertFails(nobody().doc('control/state').get());
  await assertFails(student().doc('control/state').set({ locked: true }, { merge: true }));
  await assertSucceeds(
    teacher()
      .doc('control/state')
      .set(
        { task: { type: 'message', sentAt: 5, target: null, text: 'Привіт' } },
        { mergeFields: ['task'] },
      ),
  );
});

it('students: ученик создаёт и обновляет свою карточку', async () => {
  const db = student();
  await assertSucceeds(db.doc('students/pc07').set({ pc: 'pc07', num: 7, name: 'Оля Петренко' }));
  await assertSucceeds(
    db.doc('students/pc07').set({ lastSeen: 123, openedAt: 5 }, { merge: true }),
  );
  await assertSucceeds(db.doc('students/pc07').set({ submittedAt: 5 }, { merge: true }));
});

it('students: проверки имени, id и полей', async () => {
  const db = student();
  await assertFails(db.doc('students/pc08').set({ pc: 'pc08', num: 8, name: longName }));
  await assertFails(db.doc('students/pc08').set({ pc: 'pc08', num: 8, name: 42 }));
  await assertFails(db.doc('students/pc08').set({ pc: 'pc08', num: 8 }));
  await assertFails(db.doc('students/hacker').set({ pc: 'x', num: 1, name: 'X' }));
  await assertFails(db.doc('students/pc8').set({ pc: 'pc8', num: 8, name: 'X' }));
  await assertFails(db.doc('students/pc08').set({ pc: 'pc08', num: 8, name: 'X', score: 100 }));
  await assertFails(nobody().doc('students/pc09').set({ pc: 'pc09', num: 9, name: 'X' }));
});

it('students: читает и удаляет только учитель', async () => {
  await assertFails(student().doc('students/pc03').get());
  await assertFails(student().collection('students').get());
  await assertFails(student().doc('students/pc03').delete());
  await assertSucceeds(teacher().collection('students').get());
  await assertSucceeds(teacher().doc('students/pc03').delete());
});

it('tests: читают вошедшие, пишет учитель', async () => {
  await assertSucceeds(student().doc('tests/t1').get());
  await assertFails(nobody().doc('tests/t1').get());
  await assertFails(student().doc('tests/t1').set({ title: 'Злам' }));
  await assertSucceeds(teacher().doc('tests/t2').set({ title: 'Новий', questions: [], count: 0 }));
  await assertSucceeds(teacher().doc('tests/t2').delete());
});

it('keys: ученик не может прочитать правильные ответы', async () => {
  await assertFails(student().doc('keys/t1').get());
  await assertFails(student().collection('keys').get());
  await assertFails(student().doc('keys/t1').set({ answers: [] }));
  await assertSucceeds(teacher().doc('keys/t1').get());
  await assertSucceeds(
    teacher()
      .doc('keys/t1')
      .set({ answers: [1] }),
  );
});

it('results: ученик только создаёт, чужие не читает', async () => {
  const db = student();
  const ok = {
    testId: 't1',
    sentAt: 5,
    pc: 'pc07',
    num: 7,
    name: 'Оля',
    answers: [0, -1, 2],
    submittedAt: 1,
  };
  await assertSucceeds(db.collection('results').add(ok));
  await assertFails(db.doc('results/r1').get());
  await assertFails(db.collection('results').get());
  await assertFails(db.collection('results').where('pc', '==', 'pc07').get());
  await assertFails(db.doc('results/r1').set({ answers: [1] }, { merge: true }));
  await assertFails(db.doc('results/r1').delete());
});

it('results: проверки ответов и имени', async () => {
  const db = student();
  const base = { testId: 't1', sentAt: 5, pc: 'pc07', num: 7, name: 'Оля' };
  await assertFails(
    db.collection('results').add(Object.assign({}, base, { answers: new Array(101).fill(0) })),
  );
  await assertSucceeds(
    db.collection('results').add(Object.assign({}, base, { answers: new Array(100).fill(0) })),
  );
  await assertFails(db.collection('results').add(Object.assign({}, base, { answers: '0,1' })));
  await assertFails(
    db.collection('results').add(Object.assign({}, base, { name: longName, answers: [0] })),
  );
  await assertFails(
    nobody()
      .collection('results')
      .add(Object.assign({}, base, { answers: [0] })),
  );
});

it('results: учитель читает и удаляет', async () => {
  await assertSucceeds(teacher().collection('results').get());
  await assertSucceeds(teacher().doc('results/r1').delete());
});

it('clock: только своё серверное время', async () => {
  const now = firebase.firestore.FieldValue.serverTimestamp();
  const db = student('anon-9');
  await assertSucceeds(db.doc('clock/anon-9').set({ t: now }));
  await assertSucceeds(db.doc('clock/anon-9').get());
  await assertFails(db.doc('clock/anon-9').set({ t: 12345 }));
  await assertFails(db.doc('clock/anon-9').set({ t: now, x: 1 }));
  await assertFails(db.doc('clock/other').set({ t: now }));
  await assertFails(db.doc('clock/teacher-uid').get());
  await assertFails(db.collection('clock').get());
  expect(now).toBeTruthy();
});

it('sessions: история только у учителя', async () => {
  await assertSucceeds(
    teacher()
      .doc('sessions/1_t1')
      .set({ testId: 't1', answers: [0], startedAt: 1 }),
  );
  await assertSucceeds(teacher().collection('sessions').get());
  await assertFails(student().doc('sessions/1_t1').get());
  await assertFails(student().collection('sessions').get());
  await assertFails(student().doc('sessions/1_t1').set({ testId: 'x' }));
});

it('students: рука и «закінчив» — разрешённые поля', async () => {
  const db = student();
  await assertSucceeds(
    db.doc('students/pc07').set({ pc: 'pc07', num: 7, name: 'Оля', handAt: 5, handId: 1 }),
  );
  await assertSucceeds(
    db.doc('students/pc07').set({ handAt: null, handId: null, doneAt: 5 }, { merge: true }),
  );
  await assertFails(db.doc('students/pc07').set({ hand: true }, { merge: true }));
});

it('reveals: учитель публикует разбор, ученики только читают', async () => {
  await assertSucceeds(
    teacher()
      .doc('reveals/1_t1')
      .set({ answers: [0], questions: [] }),
  );
  await assertSucceeds(student().doc('reveals/1_t1').get());
  await assertFails(nobody().doc('reveals/1_t1').get());
  await assertFails(
    student()
      .doc('reveals/1_t1')
      .set({ answers: [1] }),
  );
  await assertFails(student().doc('reveals/1_t1').delete());
  await assertSucceeds(teacher().doc('reveals/1_t1').delete());
});

it('прочие коллекции закрыты', async () => {
  await assertFails(student().doc('other/x').get());
  await assertFails(teacher().doc('other/x').set({ a: 1 }));
});
