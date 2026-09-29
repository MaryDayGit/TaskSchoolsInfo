/*
 * Тесты правил этапа 5: живая игра (games, players, answers, gameKeys, gameResults).
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
const { Timestamp, FieldValue } = firebase.firestore;
const now = () => FieldValue.serverTimestamp();

const anon = (uid: string) =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const teacher = () => anon('teacher-uid');
const ola = () => anon('ola-uid'); // s1, class c1
const ivan = () => anon('ivan-uid'); // s2, class c2
const guest = () => anon('guest-uid');

const Q = [{ id: 'q1', type: 'single', prompt: '2 + 2?', options: [{ id: 'a', text: '4' }] }];
const game = (over: Record<string, unknown> = {}) => ({
  classId: 'c1',
  className: 'c1',
  quizId: 'quiz1',
  title: 'Бліц',
  questions: Q,
  status: 'question',
  index: 0,
  deadline: Timestamp.fromMillis(Date.now() + 20_000),
  starts: { '0': Date.now() },
  junior: false,
  createdAt: 1,
  active: true,
  ...over,
});
const answer = (over: Record<string, unknown> = {}) => ({
  studentId: 's1',
  index: 0,
  value: 'a',
  at: now(),
  ...over,
});
const put = (db: firebase.firestore.Firestore, over: Record<string, unknown> = {}) => {
  const a = answer(over);
  return db.doc(`games/g1/answers/${String(a.studentId)}_${String(a.index)}`).set(a);
};

const seed = (fn: (db: firebase.firestore.Firestore) => Promise<unknown>) =>
  env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore() as firebase.firestore.Firestore));

beforeAll(async () => {
  const rules = readFileSync(fileURLToPath(new URL('./firestore.rules', import.meta.url)), 'utf8');
  env = await initializeTestEnvironment({ projectId: 'demo-klas-pult-game', firestore: { rules } });
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
      await db.doc(`studentSecrets/${s}`).set({ classId: c, secret });
      await db
        .doc(`bindings/${uid}`)
        .set({ classId: c, studentId: s, secret, createdAt: 1, device: 'x' });
    }
    await db.doc('games/g1').set(game());
    await db.doc('gameKeys/g1').set({ questions: [{ ...Q[0], correctOptionId: 'a' }] });
  });
});

afterAll(async () => {
  if (env) await env.cleanup();
});

describe('games', () => {
  it('pupils of the class see the game; others do not; only the teacher runs it', async () => {
    await assertSucceeds(ola().doc('games/g1').get());
    await assertSucceeds(ola().collection('games').where('classId', '==', 'c1').get());
    await assertSucceeds(
      ola().collection('games').where('classId', '==', 'c1').where('active', '==', true).get(),
    );
    await assertFails(ola().collection('games').where('active', '==', true).get());
    await assertFails(ivan().doc('games/g1').get());
    await assertFails(guest().doc('games/g1').get());
    await assertFails(ola().doc('games/g1').update({ status: 'finished' }));
    await assertSucceeds(
      teacher()
        .doc('games/g2')
        .set(game({ status: 'lobby', index: -1 })),
    );
    await assertFails(
      teacher()
        .doc('games/g3')
        .set(game({ status: 'paused' })),
    );
    await assertFails(
      teacher()
        .doc('games/g3')
        .set(game({ extra: 1 })),
    );
  });

  it('the key with the answers is the host’s only', async () => {
    await assertSucceeds(teacher().doc('gameKeys/g1').get());
    await assertFails(ola().doc('gameKeys/g1').get());
  });

  it('a pupil joins once as themself while the game is on', async () => {
    await assertSucceeds(ola().doc('games/g1/players/s1').set({ joinedAt: now() }));
    await assertFails(ola().doc('games/g1/players/s1').set({ joinedAt: now() }));
    await assertFails(ola().doc('games/g1/players/s2').set({ joinedAt: now() }));
    await assertFails(ivan().doc('games/g1/players/s2').set({ joinedAt: now() }));
    await assertFails(ola().collection('games/g1/players').get());
    await assertSucceeds(teacher().collection('games/g1/players').get());
  });
});

describe('answers', () => {
  it('an answer to the current question before the deadline is accepted once', async () => {
    await assertSucceeds(put(ola()));
    await assertFails(put(ola(), { value: 'b' }));
    await assertSucceeds(ola().doc('games/g1/answers/s1_0').get());
  });

  it('an answer after the deadline (+1.5 s) is rejected', async () => {
    await seed((db) =>
      db.doc('games/g1').update({ deadline: Timestamp.fromMillis(Date.now() - 3000) }),
    );
    await assertFails(put(ola()));
  });

  it('a late answer inside the 1.5 s grace is still accepted', async () => {
    await seed((db) =>
      db.doc('games/g1').update({ deadline: Timestamp.fromMillis(Date.now() - 300) }),
    );
    await assertSucceeds(put(ola()));
  });

  it('an answer to another question or while not asking is rejected', async () => {
    await assertFails(put(ola(), { index: 1 }));
    await seed((db) => db.doc('games/g1').update({ status: 'reveal' }));
    await assertFails(put(ola()));
  });

  it('only for yourself, from the class, with the server time and a sane value', async () => {
    await assertFails(put(ola(), { studentId: 's2' }));
    await assertFails(ola().doc('games/g1/answers/s2_0').set(answer()));
    await assertFails(put(ivan(), { studentId: 's2' }));
    await assertFails(put(guest(), { studentId: 'g' }));
    await assertFails(put(ola(), { at: Timestamp.now() }));
    await assertFails(put(ola(), { value: 'x'.repeat(501) }));
    await assertFails(put(ola(), { value: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }));
    await assertFails(put(ola(), { points: 1000 }));
  });

  it('pupils cannot read other answers; the host reads all', async () => {
    await seed((db) =>
      db.doc('games/g1/answers/s2_0').set({ ...answer({ studentId: 's2' }), at: 1 }),
    );
    await assertFails(ola().doc('games/g1/answers/s2_0').get());
    await assertFails(ola().collection('games/g1/answers').get());
    await assertSucceeds(teacher().collection('games/g1/answers').get());
  });
});

describe('game results', () => {
  const row = {
    gameId: 'g1',
    classId: 'c1',
    studentId: 's1',
    score: 900,
    correctCount: 1,
    total: 1,
    answers: {},
  };
  it('only the host writes results; a pupil reads their own', async () => {
    await assertSucceeds(teacher().doc('gameResults/g1_s1').set(row));
    await assertFails(ola().doc('gameResults/g1_s1').set(row));
    await assertFails(teacher().doc('gameResults/wrong-id').set(row));
    await assertSucceeds(ola().doc('gameResults/g1_s1').get());
    await assertSucceeds(
      ola()
        .collection('gameResults')
        .where('classId', '==', 'c1')
        .where('studentId', '==', 's1')
        .get(),
    );
    await assertFails(ivan().doc('gameResults/g1_s1').get());
  });
});
