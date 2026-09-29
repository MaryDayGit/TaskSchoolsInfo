/*
 * Тесты правил этапа 3: банк тестов, задания, ключи, сдачи.
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
const HOUR = 3600 * 1000;
const future = () => Timestamp.fromMillis(Date.now() + 24 * HOUR);
const past = () => Timestamp.fromMillis(Date.now() - HOUR);

const anon = (uid: string) =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const teacher = () => anon('teacher-uid');
const ola = () => anon('ola-uid'); // bound to s1 in class c1
const ivan = () => anon('ivan-uid'); // bound to s2 in class c2
const stranger = () => anon('stranger-uid'); // signed in, not bound

const Q = [{ id: 'q1', type: 'single', prompt: '2 + 2?', options: [{ id: 'a', text: '4' }] }];
const KEY = [{ ...Q[0], correctOptionId: 'a' }];

const assignment = (over: Record<string, unknown> = {}) => ({
  classId: 'c1',
  kind: 'homework',
  quizId: 'quiz1',
  title: 'Додавання',
  questions: Q,
  dueAt: future(),
  maxAttempts: 2,
  reveal: 'immediate',
  revealNow: false,
  roomId: null,
  createdAt: now(),
  ...over,
});

const submission = (over: Record<string, unknown> = {}) => ({
  assignmentId: 'a1',
  classId: 'c1',
  studentId: 's1',
  attempt: 1,
  answers: { q1: 'a' },
  submittedAt: now(),
  ...over,
});
const subId = (s: { assignmentId: unknown; studentId: unknown; attempt: unknown }) =>
  `submissions/${String(s.assignmentId)}_${String(s.studentId)}_${String(s.attempt)}`;
const submit = (db: firebase.firestore.Firestore, over: Record<string, unknown> = {}) => {
  const s = submission(over);
  return db.doc(subId(s)).set(s);
};

const seed = (fn: (db: firebase.firestore.Firestore) => Promise<unknown>) =>
  env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore() as firebase.firestore.Firestore));

beforeAll(async () => {
  const rules = readFileSync(fileURLToPath(new URL('./firestore.rules', import.meta.url)), 'utf8');
  env = await initializeTestEnvironment({
    projectId: 'demo-klas-pult-assignments',
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
      .doc('quizzes/quiz1')
      .set({ title: 'Додавання', folder: '5 клас', questions: KEY, createdAt: 1, updatedAt: 1 });
    await db.doc('assignments/a1').set(assignment({ createdAt: 1 }));
    await db.doc('assignmentKeys/a1').set({ questions: KEY });
    await db
      .doc('assignments/late')
      .set(assignment({ dueAt: past(), reveal: 'after_due', createdAt: 1 }));
    await db.doc('assignmentKeys/late').set({ questions: KEY });
    await db
      .doc('assignments/open')
      .set(assignment({ dueAt: future(), reveal: 'after_due', createdAt: 1 }));
    await db.doc('assignmentKeys/open').set({ questions: KEY });
    await db.doc('assignments/closed').set(assignment({ reveal: 'never', createdAt: 1 }));
    await db.doc('assignmentKeys/closed').set({ questions: KEY });
    await db.doc('assignments/b1').set(assignment({ classId: 'c2', createdAt: 1 }));
  });
});

afterAll(async () => {
  if (env) await env.cleanup();
});

describe('quizzes (bank)', () => {
  it('only the teacher reads and writes the bank', async () => {
    await assertSucceeds(teacher().doc('quizzes/quiz1').get());
    await assertSucceeds(teacher().collection('quizzes').get());
    await assertFails(ola().doc('quizzes/quiz1').get());
    await assertFails(ola().collection('quizzes').get());
    await assertFails(stranger().collection('quizzes').get());
    await assertFails(
      ola()
        .doc('quizzes/x')
        .set({ title: 'x', folder: '', questions: KEY, createdAt: 1, updatedAt: 1 }),
    );
  });

  it('validates quiz fields', async () => {
    const ok = { title: 'Тест', folder: '', questions: KEY, createdAt: now(), updatedAt: now() };
    await assertSucceeds(teacher().doc('quizzes/q2').set(ok));
    await assertFails(
      teacher()
        .doc('quizzes/q3')
        .set({ ...ok, title: '' }),
    );
    await assertFails(
      teacher()
        .doc('quizzes/q3')
        .set({ ...ok, folder: 'x'.repeat(61) }),
    );
    await assertFails(
      teacher()
        .doc('quizzes/q3')
        .set({ ...ok, questions: [] }),
    );
    await assertFails(
      teacher()
        .doc('quizzes/q3')
        .set({ ...ok, questions: Array(51).fill(KEY[0]) }),
    );
    await assertFails(
      teacher()
        .doc('quizzes/q3')
        .set({ ...ok, extra: 1 }),
    );
  });
});

describe('assignments', () => {
  it('students of the class read assignments; others do not', async () => {
    await assertSucceeds(ola().doc('assignments/a1').get());
    await assertSucceeds(ola().collection('assignments').where('classId', '==', 'c1').get());
    await assertFails(ola().doc('assignments/b1').get());
    await assertFails(ola().collection('assignments').where('classId', '==', 'c2').get());
    await assertFails(ola().collection('assignments').get());
    await assertFails(stranger().doc('assignments/a1').get());
    await assertSucceeds(teacher().collection('assignments').get());
  });

  it('only the teacher creates valid assignments for an existing class', async () => {
    await assertSucceeds(teacher().doc('assignments/n1').set(assignment()));
    await assertSucceeds(
      teacher()
        .doc('assignments/n2')
        .set(assignment({ dueAt: null, maxAttempts: null })),
    );
    await assertFails(ola().doc('assignments/n3').set(assignment()));
    await assertFails(ola().doc('assignments/a1').update({ dueAt: future() }));
    await assertFails(
      teacher()
        .doc('assignments/n3')
        .set(assignment({ classId: 'nope' })),
    );
    await assertFails(
      teacher()
        .doc('assignments/n3')
        .set(assignment({ maxAttempts: 0 })),
    );
    await assertFails(
      teacher()
        .doc('assignments/n3')
        .set(assignment({ maxAttempts: 21 })),
    );
    await assertFails(
      teacher()
        .doc('assignments/n3')
        .set(assignment({ reveal: 'sometimes' })),
    );
    await assertFails(
      teacher()
        .doc('assignments/n3')
        .set(assignment({ kind: 'exam' })),
    );
    await assertFails(
      teacher()
        .doc('assignments/n3')
        .set(assignment({ dueAt: 'tomorrow' })),
    );
    await assertFails(
      teacher()
        .doc('assignments/n3')
        .set(assignment({ extra: true })),
    );
  });

  it('the teacher updates settings and the summary, but cannot move it to another class', async () => {
    await assertSucceeds(
      teacher()
        .doc('assignments/a1')
        .update({ dueAt: past(), summary: { submitted: 3, avgPercent: 80, updatedAt: now() } }),
    );
    await assertFails(teacher().doc('assignments/a1').update({ classId: 'c2' }));
  });
});

describe('submissions', () => {
  it('a student submits the first attempt, then the next one in order', async () => {
    await assertSucceeds(submit(ola()));
    await assertSucceeds(submit(ola(), { attempt: 2 }));
  });

  it('the same attempt cannot be submitted twice', async () => {
    await assertSucceeds(submit(ola()));
    await assertFails(submit(ola(), { answers: { q1: 'b' } }));
  });

  it('an attempt number cannot be skipped, and the limit holds', async () => {
    await assertFails(submit(ola(), { attempt: 2 }));
    await assertFails(submit(ola(), { attempt: 0 }));
    await assertSucceeds(submit(ola()));
    await assertSucceeds(submit(ola(), { attempt: 2 }));
    await assertFails(submit(ola(), { attempt: 3 }));
  });

  it('no submissions after the due date', async () => {
    await assertFails(submit(ola(), { assignmentId: 'late' }));
  });

  it('only for yourself, your class and with the server time', async () => {
    // Another student's id (also a different document id).
    await assertFails(submit(ola(), { studentId: 's2' }));
    // Right student, but the document id names someone else.
    const s = submission();
    await assertFails(ola().doc('submissions/a1_s2_1').set(s));
    // Assignment of another class.
    await assertFails(submit(ola(), { assignmentId: 'b1' }));
    await assertFails(submit(ola(), { classId: 'c2' }));
    // Not bound at all.
    await assertFails(submit(stranger()));
    // Client clock instead of the server's.
    await assertFails(submit(ola(), { submittedAt: Timestamp.now() }));
    // A score field is not accepted either.
    await assertFails(submit(ola(), { score: 100 }));
  });

  it('a new password stops old devices from submitting', async () => {
    await seed((db) => db.doc('studentSecrets/s1').set({ classId: 'c1', secret: 'new-secret' }));
    await assertFails(submit(ola()));
  });

  it('a student reads only their own submissions; the teacher reads all', async () => {
    await seed(async (db) => {
      await db.doc('submissions/a1_s1_1').set({ ...submission(), submittedAt: 1 });
      await db.doc('submissions/b1_s2_1').set({
        ...submission({ assignmentId: 'b1', classId: 'c2', studentId: 's2' }),
        submittedAt: 1,
      });
    });
    await assertSucceeds(ola().doc('submissions/a1_s1_1').get());
    await assertSucceeds(
      ola()
        .collection('submissions')
        .where('classId', '==', 'c1')
        .where('assignmentId', '==', 'a1')
        .where('studentId', '==', 's1')
        .get(),
    );
    await assertFails(ola().doc('submissions/b1_s2_1').get());
    // The whole class's submissions are not readable, with or without the class filter.
    await assertFails(ola().collection('submissions').where('assignmentId', '==', 'a1').get());
    await assertFails(
      ola()
        .collection('submissions')
        .where('classId', '==', 'c1')
        .where('assignmentId', '==', 'a1')
        .get(),
    );
    await assertFails(ivan().doc('submissions/a1_s1_1').get());
    await assertSucceeds(
      teacher().collection('submissions').where('assignmentId', '==', 'a1').get(),
    );
    await assertFails(ola().doc('submissions/a1_s1_1').delete());
  });
});

describe('answer keys', () => {
  it('"immediate": the key opens after the student submitted', async () => {
    await assertFails(ola().doc('assignmentKeys/a1').get());
    await assertSucceeds(submit(ola()));
    await assertSucceeds(ola().doc('assignmentKeys/a1').get());
    // Other class never.
    await assertFails(ivan().doc('assignmentKeys/a1').get());
  });

  it('"after_due": closed before the due date even after submitting, open after it', async () => {
    await assertSucceeds(submit(ola(), { assignmentId: 'open' }));
    await assertFails(ola().doc('assignmentKeys/open').get());
    await assertSucceeds(ola().doc('assignmentKeys/late').get());
    await assertFails(stranger().doc('assignmentKeys/late').get());
  });

  it('"never" stays closed unless the teacher shows results on the lesson', async () => {
    await assertSucceeds(submit(ola(), { assignmentId: 'closed' }));
    await assertFails(ola().doc('assignmentKeys/closed').get());
    await seed((db) => db.doc('assignments/closed').update({ revealNow: true }));
    await assertSucceeds(ola().doc('assignmentKeys/closed').get());
  });

  it('only the teacher writes keys', async () => {
    await assertSucceeds(teacher().doc('assignmentKeys/n1').set({ questions: KEY }));
    await assertFails(ola().doc('assignmentKeys/a1').set({ questions: KEY }));
    await assertFails(teacher().doc('assignmentKeys/n2').set({ questions: KEY, extra: 1 }));
  });
});
