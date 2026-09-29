/*
 * Тесты правил этапа 4: пульт урока (rooms, pcs, guestResults) и тест на уроке.
 * Запуск: npm run test:rules (вместе с остальными тестами правил).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { setLogLevel } from 'firebase/firestore';

setLogLevel('silent');

let env: RulesTestEnvironment;
const now = () => firebase.firestore.FieldValue.serverTimestamp();

const anon = (uid: string) =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const teacher = () => anon('teacher-uid');
const ola = () => anon('ola-uid'); // bound to s1 in class c1 (the lesson class)
const ivan = () => anon('ivan-uid'); // bound to s2 in class c2
const guest = () => anon('guest-uid'); // not bound
const nobody = () => env.unauthenticatedContext().firestore();

const Q = [{ id: 'q1', type: 'single', prompt: '2 + 2?', options: [{ id: 'a', text: '4' }] }];
const KEY = [{ ...Q[0], correctOptionId: 'a' }];

const lesson = (over: Record<string, unknown> = {}) => ({
  classId: 'c1',
  kind: 'lesson',
  quizId: 'quiz1',
  title: 'Додавання',
  questions: Q,
  dueAt: null,
  maxAttempts: 1,
  reveal: 'never',
  revealNow: false,
  roomId: 'lab',
  createdAt: 1,
  ...over,
});

const card = (over: Record<string, unknown> = {}) => ({
  pc: 'pc03',
  num: 3,
  name: 'Оля К.',
  studentId: 's1',
  lastSeen: now(),
  ...over,
});

const guestResult = (over: Record<string, unknown> = {}) => ({
  assignmentId: 'L1',
  pcId: 'pc07',
  name: 'Марко',
  answers: { q1: 'a' },
  submittedAt: now(),
  ...over,
});

const seed = (fn: (db: firebase.firestore.Firestore) => Promise<unknown>) =>
  env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore() as firebase.firestore.Firestore));

beforeAll(async () => {
  const rules = readFileSync(fileURLToPath(new URL('./firestore.rules', import.meta.url)), 'utf8');
  env = await initializeTestEnvironment({
    projectId: 'demo-klas-pult-lesson',
    firestore: { rules },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (db) => {
    await db.doc('teachers/teacher-uid').set({ code: '1234' });
    for (const [c, s, uid, secret] of [
      ['c1', 's1', 'ola-uid', 'cat-sun-owl-star'],
      ['c2', 's2', 'ivan-uid', 'ракета47'],
    ] as const) {
      await db
        .doc(`classes/${c}`)
        .set({ name: c, grade: 5, joinCode: '000000', createdAt: 1, archived: false });
      await db
        .doc(`classes/${c}/roster/${s}`)
        .set({ displayName: s, secretKind: 'password', createdAt: 1 });
      await db.doc(`studentSecrets/${s}`).set({ classId: c, secret });
      await db
        .doc(`bindings/${uid}`)
        .set({ classId: c, studentId: s, secret, createdAt: 1, device: 'x' });
    }
    await db
      .doc('rooms/lab')
      .set({ classId: 'c1', className: 'c1', task: null, locked: false, resetAt: 1 });
    await db.doc('assignments/L1').set(lesson());
    await db.doc('assignmentKeys/L1').set({ questions: KEY });
    await db.doc('assignments/H1').set(lesson({ kind: 'homework', maxAttempts: null }));
  });
});

afterAll(async () => {
  if (env) await env.cleanup();
});

describe('room (lesson state)', () => {
  it('everyone signed in reads it; only the teacher writes it', async () => {
    await assertSucceeds(guest().doc('rooms/lab').get());
    await assertFails(nobody().doc('rooms/lab').get());
    await assertFails(ola().doc('rooms/lab').set({ locked: true }, { merge: true }));
    await assertFails(guest().doc('rooms/lab').update({ task: null }));
    await assertSucceeds(
      teacher()
        .doc('rooms/lab')
        .set({ locked: true, theme: 'senior', handsDown: { pc03: 5 } }, { merge: true }),
    );
    await assertFails(teacher().doc('rooms/lab').set({ extra: 1 }, { merge: true }));
    await assertFails(teacher().doc('rooms/lab').set({ theme: 'pink' }, { merge: true }));
  });
});

describe('PC cards', () => {
  it('a pupil of the lesson class writes their card with their own studentId', async () => {
    await assertSucceeds(ola().doc('rooms/lab/pcs/pc03').set(card()));
    await assertSucceeds(
      ola().doc('rooms/lab/pcs/pc03').set({ openedAt: 1000, lastSeen: now() }, { merge: true }),
    );
  });

  it('a guest writes a card without a studentId', async () => {
    await assertSucceeds(
      guest()
        .doc('rooms/lab/pcs/pc07')
        .set(card({ pc: 'pc07', num: 7, name: 'Марко', studentId: null })),
    );
  });

  it('nobody claims another student or a class that is not on the lesson', async () => {
    await assertFails(
      guest()
        .doc('rooms/lab/pcs/pc07')
        .set(card({ studentId: 's1' })),
    );
    await assertFails(
      ola()
        .doc('rooms/lab/pcs/pc03')
        .set(card({ studentId: 's2' })),
    );
    // Ivan is bound, but his class is not the lesson class.
    await assertFails(
      ivan()
        .doc('rooms/lab/pcs/pc05')
        .set(card({ studentId: 's2' })),
    );
  });

  it('card ids and fields are strict, names are short', async () => {
    await assertFails(
      guest()
        .doc('rooms/lab/pcs/pc7')
        .set(card({ studentId: null })),
    );
    await assertFails(
      guest()
        .doc('rooms/lab/pcs/pc100')
        .set(card({ studentId: null })),
    );
    await assertFails(
      guest()
        .doc('rooms/lab/pcs/pc07')
        .set(card({ studentId: null, score: 5 })),
    );
    await assertFails(
      guest()
        .doc('rooms/lab/pcs/pc07')
        .set(card({ studentId: null, name: 'x'.repeat(61) })),
    );
    await assertFails(
      nobody()
        .doc('rooms/lab/pcs/pc07')
        .set(card({ studentId: null })),
    );
  });

  it('only the teacher reads and deletes cards', async () => {
    await seed((db) =>
      db.doc('rooms/lab/pcs/pc03').set({ pc: 'pc03', num: 3, name: 'Оля', studentId: 's1' }),
    );
    await assertFails(ola().doc('rooms/lab/pcs/pc03').get());
    await assertFails(guest().collection('rooms/lab/pcs').get());
    await assertSucceeds(teacher().collection('rooms/lab/pcs').get());
    await assertFails(ola().doc('rooms/lab/pcs/pc03').delete());
    await assertSucceeds(teacher().doc('rooms/lab/pcs/pc03').delete());
  });
});

describe('a test on the lesson', () => {
  it('a guest reads the lesson test questions, but not homework', async () => {
    await assertSucceeds(guest().doc('assignments/L1').get());
    await assertFails(guest().doc('assignments/H1').get());
    await assertFails(guest().collection('assignments').where('classId', '==', 'c1').get());
    await assertFails(nobody().doc('assignments/L1').get());
  });

  it('a pupil submits once into the journal', async () => {
    const sub = {
      assignmentId: 'L1',
      classId: 'c1',
      studentId: 's1',
      attempt: 1,
      answers: { q1: 'a' },
      submittedAt: now(),
      pcId: 'pc03',
    };
    await assertSucceeds(ola().doc('submissions/L1_s1_1').set(sub));
    await assertFails(
      ola()
        .doc('submissions/L1_s1_2')
        .set({ ...sub, attempt: 2 }),
    );
  });

  it('guests submit to guestResults for lesson tests only', async () => {
    await assertSucceeds(guest().collection('guestResults').add(guestResult()));
    await assertFails(
      guest()
        .collection('guestResults')
        .add(guestResult({ assignmentId: 'H1' })),
    );
    await assertFails(
      guest()
        .collection('guestResults')
        .add(guestResult({ pcId: 'pc7' })),
    );
    await assertFails(
      guest()
        .collection('guestResults')
        .add(guestResult({ name: '' })),
    );
    await assertFails(
      guest()
        .collection('guestResults')
        .add(guestResult({ submittedAt: 5 })),
    );
    await assertFails(
      guest()
        .collection('guestResults')
        .add(guestResult({ score: 1 })),
    );
    await assertFails(nobody().collection('guestResults').add(guestResult()));
  });

  it('only the teacher reads guest results', async () => {
    await seed((db) => db.doc('guestResults/g1').set({ ...guestResult(), submittedAt: 1 }));
    await assertFails(guest().doc('guestResults/g1').get());
    await assertFails(guest().collection('guestResults').get());
    await assertSucceeds(
      teacher().collection('guestResults').where('assignmentId', '==', 'L1').get(),
    );
  });

  it('the key opens to everyone only while the teacher shows results', async () => {
    await assertFails(guest().doc('assignmentKeys/L1').get());
    await assertFails(ola().doc('assignmentKeys/L1').get());
    await seed((db) => db.doc('assignments/L1').update({ revealNow: true }));
    await assertSucceeds(guest().doc('assignmentKeys/L1').get());
    await assertSucceeds(ola().doc('assignmentKeys/L1').get());
    await seed((db) => db.doc('assignments/L1').update({ revealNow: false }));
    await assertFails(guest().doc('assignmentKeys/L1').get());
    // Homework keys never open this way.
    await seed((db) => db.doc('assignments/H1').update({ revealNow: true }));
    await seed((db) => db.doc('assignmentKeys/H1').set({ questions: KEY }));
    await assertFails(guest().doc('assignmentKeys/H1').get());
  });
});
