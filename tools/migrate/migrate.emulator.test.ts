/*
 * Прогон переноса на эмуляторе (как на копии боевых данных): резервная копия
 * Клас-пульта → эмулятор → перенос → сверка количества и баллов по CSV.
 * Запуск: npm run test:rules (эмулятор поднимает firebase emulators:exec).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './admin';
import { countByCollection, decode, dumpAll } from './dump';
import { planKlasPult } from './klaspult';
import { applyPlan, readTarget } from './store';
import { klasPultFixture, seeded } from './test/fixtures';
import { verifyKlasPult } from './verify';

const PROJECT = 'demo-klas-pult-migrate';
const { db } = connect(PROJECT);
const grades = { Гурток: 7, 'Без назви': 5 };

beforeAll(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  const bulk = db.bulkWriter();
  for (const d of klasPultFixture()) {
    void bulk.set(db.doc(d.path), decode(db, d.data) as FirebaseFirestore.DocumentData);
  }
  await bulk.close();
});

afterAll(async () => {
  await db.terminate();
});

describe('migration from Клас-пульт on the emulator', () => {
  it('backup reads every document back', async () => {
    const dump = await dumpAll(db, PROJECT);
    const fixture = klasPultFixture();
    expect(dump.docs).toHaveLength(fixture.length);
    expect(countByCollection(dump.docs)).toEqual(countByCollection(fixture));
  });

  it('moves everything; counts and History scores match Клас-пульт (CSV)', async () => {
    const source = (await dumpAll(db, PROJECT)).docs;
    const plan = planKlasPult(source, await readTarget(db), { grades, random: seeded(7) });
    const res = await applyPlan(db, plan.writes);
    expect(res.failed).toEqual([]);
    expect(res.created).toBe(plan.writes.length);

    const v = await verifyKlasPult(db, source);
    expect(v.migrated).toBe(v.sessions);
    expect(v.guestResults).toBe(v.results);
    expect(v.newCsv.split('\r\n')).toEqual(v.oldCsv.split('\r\n'));
    process.stdout.write(
      `\n[migrate] ${v.sessions} сесій, ${v.results} відповідей → ${res.created} документів; CSV збігаються\n`,
    );

    // Old collections are untouched (rollback stays possible).
    const after = countByCollection((await dumpAll(db, PROJECT)).docs);
    const before = countByCollection(source);
    for (const col of ['tests', 'keys', 'sessions', 'results', 'control', 'students', 'secret']) {
      expect(after[col]).toBe(before[col]);
    }
  });

  it('a second run creates nothing', async () => {
    const source = (await dumpAll(db, PROJECT)).docs;
    const plan = planKlasPult(source, await readTarget(db), { grades, random: seeded(8) });
    expect(plan.writes).toEqual([]);
  });
});
