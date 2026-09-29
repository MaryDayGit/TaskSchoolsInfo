/*
 * Тесты правил единой платформы (этап 2): классы, ученики, вход учеников.
 * Запуск: npm run test:rules (вместе с тестами правил Клас-пульта).
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
const pupil = (uid = 'pupil-uid') => anon(uid);
const nobody = () => env.unauthenticatedContext().firestore();

const CLASS = { name: '3-А', grade: 3, joinCode: '111111', createdAt: 1, archived: false };
const binding = (over: Record<string, unknown> = {}) => ({
  classId: 'c1',
  studentId: 's1',
  secret: 'cat-sun-owl-star',
  createdAt: now(),
  device: 'Windows · Chrome 109',
  ...over,
});

beforeAll(async () => {
  const rules = readFileSync(fileURLToPath(new URL('./firestore.rules', import.meta.url)), 'utf8');
  env = await initializeTestEnvironment({
    projectId: 'demo-klas-pult-platform',
    firestore: { rules },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('teachers/teacher-uid').set({ code: '1234' });
    await db.doc('classes/c1').set(CLASS);
    await db.doc('joinCodes/111111').set({ classId: 'c1' });
    await db.doc('classes/c1/roster/s1').set({ displayName: 'Оля К.', secretKind: 'pictures', pictureCount: 4, createdAt: 1 });
    await db.doc('studentSecrets/s1').set({ classId: 'c1', secret: 'cat-sun-owl-star' });
    await db.doc('classes/c2').set({ ...CLASS, name: '7-Б', grade: 7, joinCode: '222222' });
    await db.doc('joinCodes/222222').set({ classId: 'c2' });
    await db.doc('classes/c2/roster/s2').set({ displayName: 'Іван', secretKind: 'password', createdAt: 1 });
    await db.doc('studentSecrets/s2').set({ classId: 'c2', secret: 'ракета47' });
  });
});

afterAll(async () => {
  if (env) await env.cleanup();
});

describe('classes', () => {
  it('teacher creates a class together with its join code', async () => {
    const db = teacher();
    const batch = db.batch();
    batch.set(db.doc('classes/c3'), { ...CLASS, name: '5-В', grade: 5, joinCode: '333333' });
    batch.set(db.doc('joinCodes/333333'), { classId: 'c3' });
    await assertSucceeds(batch.commit());
  });

  it('a class needs its own join code; a taken code cannot be reused', async () => {
    const db = teacher();
    await assertFails(db.doc('classes/c3').set({ ...CLASS, joinCode: '333333' }));
    const taken = db.batch();
    taken.set(db.doc('classes/c3'), { ...CLASS, joinCode: '111111' });
    taken.set(db.doc('joinCodes/111111'), { classId: 'c3' });
    await assertFails(taken.commit());
  });

  it('validates class fields', async () => {
    const db = teacher();
    const bad = async (data: Record<string, unknown>) => {
      const b = db.batch();
      b.set(db.doc('classes/c9'), data);
      b.set(db.doc('joinCodes/999999'), { classId: 'c9' });
      await assertFails(b.commit());
    };
    await bad({ ...CLASS, joinCode: '999999', grade: 10 });
    await bad({ ...CLASS, joinCode: '999999', grade: 1 });
    await bad({ ...CLASS, joinCode: '999999', name: '' });
    await bad({ ...CLASS, joinCode: '999999', name: 'x'.repeat(41) });
    await bad({ ...CLASS, joinCode: '999999', extra: true });
  });

  it('teacher changes the join code atomically', async () => {
    const db = teacher();
    const batch = db.batch();
    batch.update(db.doc('classes/c1'), { joinCode: '444444' });
    batch.set(db.doc('joinCodes/444444'), { classId: 'c1' });
    batch.delete(db.doc('joinCodes/111111'));
    await assertSucceeds(batch.commit());
    await assertFails(db.doc('classes/c1').update({ joinCode: '555555' }));
  });

  it('students cannot create or change classes', async () => {
    const db = pupil();
    const batch = db.batch();
    batch.set(db.doc('classes/c3'), { ...CLASS, joinCode: '333333' });
    batch.set(db.doc('joinCodes/333333'), { classId: 'c3' });
    await assertFails(batch.commit());
    await assertFails(db.doc('classes/c1').update({ name: 'Злам' }));
    await assertFails(db.doc('classes/c1').delete());
    await assertFails(db.collection('classes').get());
  });

  it('join codes: get by code only, no listing', async () => {
    await assertSucceeds(pupil().doc('joinCodes/111111').get());
    await assertFails(pupil().collection('joinCodes').get());
    await assertFails(nobody().doc('joinCodes/111111').get());
    await assertFails(pupil().doc('joinCodes/111111').set({ classId: 'c2' }));
  });
});

describe('roster and secrets', () => {
  it('anyone signed in sees the names of a class', async () => {
    await assertSucceeds(pupil().collection('classes/c1/roster').get());
    await assertFails(nobody().collection('classes/c1/roster').get());
  });

  it('only the teacher writes the roster', async () => {
    const row = { displayName: 'Петро', secretKind: 'pictures', pictureCount: 4, createdAt: 1 };
    await assertFails(pupil().doc('classes/c1/roster/s9').set(row));
    await assertSucceeds(teacher().doc('classes/c1/roster/s9').set(row));
    await assertFails(teacher().doc('classes/c1/roster/s8').set({ ...row, pictureCount: 5 }));
    await assertFails(teacher().doc('classes/c1/roster/s8').set({ ...row, displayName: 'x'.repeat(61) }));
    await assertFails(teacher().doc('classes/c1/roster/s8').set({ ...row, secret: 'leak' }));
  });

  it('students never read passwords', async () => {
    await assertFails(pupil().doc('studentSecrets/s1').get());
    await assertFails(pupil().collection('studentSecrets').get());
    await assertSucceeds(teacher().doc('studentSecrets/s1').get());
  });

  it('a password belongs to an existing roster row', async () => {
    await assertFails(teacher().doc('studentSecrets/s9').set({ classId: 'c1', secret: 'x' }));
    const db = teacher();
    const batch = db.batch();
    batch.set(db.doc('classes/c1/roster/s9'), { displayName: 'Петро', secretKind: 'password', createdAt: 1 });
    batch.set(db.doc('studentSecrets/s9'), { classId: 'c1', secret: 'сова12' });
    await assertSucceeds(batch.commit());
  });
});

describe('student login (bindings)', () => {
  it('the right pictures bind this browser to the student', async () => {
    await assertSucceeds(pupil().doc('bindings/pupil-uid').set(binding()));
    await assertSucceeds(pupil().doc('bindings/pupil-uid').get());
  });

  it('wrong password, wrong class or foreign uid are rejected', async () => {
    await assertFails(pupil().doc('bindings/pupil-uid').set(binding({ secret: 'dog-dog-dog-dog' })));
    await assertFails(pupil().doc('bindings/pupil-uid').set(binding({ classId: 'c2' })));
    await assertFails(pupil().doc('bindings/someone-else').set(binding()));
    await assertFails(pupil().doc('bindings/pupil-uid').set(binding({ studentId: 'nope' })));
    await assertFails(nobody().doc('bindings/pupil-uid').set(binding()));
  });

  it('binding fields are strict', async () => {
    await assertFails(pupil().doc('bindings/pupil-uid').set(binding({ createdAt: 12345 })));
    await assertFails(pupil().doc('bindings/pupil-uid').set(binding({ device: 'x'.repeat(61) })));
    await assertFails(pupil().doc('bindings/pupil-uid').set(binding({ admin: true })));
  });

  it('a binding cannot be changed, only deleted and created again', async () => {
    const db = pupil();
    await assertSucceeds(db.doc('bindings/pupil-uid').set(binding()));
    await assertFails(db.doc('bindings/pupil-uid').set(binding({ studentId: 's2', classId: 'c2', secret: 'ракета47' })));
    await assertSucceeds(db.doc('bindings/pupil-uid').delete());
    await assertSucceeds(db.doc('bindings/pupil-uid').set(binding({ studentId: 's2', classId: 'c2', secret: 'ракета47' })));
  });

  it("students don't see other devices; the teacher does", async () => {
    await assertSucceeds(pupil().doc('bindings/pupil-uid').set(binding()));
    await assertFails(pupil('other').doc('bindings/pupil-uid').get());
    await assertFails(pupil('other').collection('bindings').get());
    await assertSucceeds(teacher().collection('bindings').where('studentId', '==', 's1').get());
    await assertSucceeds(teacher().doc('bindings/pupil-uid').delete());
  });

  it('a bound student reads only their own class', async () => {
    await assertFails(pupil().doc('classes/c1').get());
    await assertSucceeds(pupil().doc('bindings/pupil-uid').set(binding()));
    await assertSucceeds(pupil().doc('classes/c1').get());
    await assertFails(pupil().doc('classes/c2').get());
  });

  it('a new password logs out old devices', async () => {
    await assertSucceeds(pupil().doc('bindings/pupil-uid').set(binding()));
    await assertSucceeds(pupil().doc('classes/c1').get());
    await assertSucceeds(teacher().doc('studentSecrets/s1').set({ classId: 'c1', secret: 'fox-fox-owl-sun' }));
    await assertFails(pupil().doc('classes/c1').get());
  });

  it('old 3-picture passwords still work', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('studentSecrets/s1').set({ classId: 'c1', secret: 'cat-sun-owl' });
    });
    await assertSucceeds(pupil().doc('bindings/pupil-uid').set(binding({ secret: 'cat-sun-owl' })));
  });
});
