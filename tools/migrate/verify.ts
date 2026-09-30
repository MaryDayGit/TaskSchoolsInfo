/*
 * Сверка переноса из Клас-пульта: количество документов и баллы.
 * Для каждой сессии Клас-пульта считает баллы так, как их считал Клас-пульт
 * (legacyStats.ts), и так, как их показывает новая вкладка «Історія»
 * (historyStats из перенесённых документов), и сравнивает два CSV.
 *
 *   npx tsx tools/migrate/verify.ts [--from backup.json] [--out-dir .]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { historyStats, lessonRows, pcLabel, toCsv, type Question } from '@infoklas/shared';
import { args, connect, str } from './admin';
import { dumpAll, type Dump, type DumpDoc } from './dump';
import { legacyCompute } from './legacyStats';
import { ms, normalizeName } from './plan';

/** Names are cleaned on the way (spaces, 60 characters, «—» for empty), as in klaspult.ts. */
const guestName = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 60) || '—';

export interface VerifyResult {
  sessions: number;
  migrated: number;
  results: number;
  guestResults: number;
  oldCsv: string;
  newCsv: string;
  same: boolean;
}

export async function verifyKlasPult(db: Firestore, source: DumpDoc[]): Promise<VerifyResult> {
  const col = (name: string) =>
    source
      .filter((d) => d.path.split('/').length === 2 && d.path.startsWith(`${name}/`))
      .map((d) => ({ id: d.path.slice(name.length + 1), data: d.data }));
  const sessions = col('sessions');
  const results = col('results').filter((r) => r.data.sessionId);
  const header = ['Тест', 'Клас', 'ПК', 'Учень', 'Бал', 'Максимум'];
  const oldRows: string[][] = [];
  const newRows: string[][] = [];
  const summaries: string[][] = [['Тест', 'Здали', 'Середній %']];
  const newSummaries: string[][] = [['Тест', 'Здали', 'Середній %']];
  let migrated = 0;
  let guestCount = 0;
  const sorted = [...sessions].sort(
    (a, b) => (ms(a.data.startedAt) ?? 0) - (ms(b.data.startedAt) ?? 0) || a.id.localeCompare(b.id),
  );
  for (const s of sorted) {
    // An empty label becomes the class «Без назви»; a label may match an existing
    // class written in another case («6-б»), so classes are compared case-insensitively.
    const label = normalizeName(String(s.data.classLabel ?? '')) || 'без назви';
    const title = String(s.data.title ?? '');
    const old = legacyCompute(
      s.data,
      results.filter((r) => r.data.sessionId === s.id).map((r) => r.data),
    );
    for (const r of old.rows) {
      oldRows.push([
        title,
        label,
        pcLabel(r.num),
        guestName(r.name),
        String(r.score ?? ''),
        String(old.total),
      ]);
    }
    summaries.push([`${title} ${label}`, String(old.rows.length), String(old.avgPercent)]);

    const a = await db.doc(`assignments/${s.id}`).get();
    if (!a.exists) continue;
    migrated++;
    const key = (await db.doc(`assignmentKeys/${s.id}`).get()).get('questions') as Question[];
    const guests = await db.collection('guestResults').where('assignmentId', '==', s.id).get();
    guestCount += guests.size;
    const cls = await db.doc(`classes/${String(a.get('classId'))}`).get();
    const stats = historyStats(
      key,
      lessonRows({
        questions: key,
        submissions: [],
        guests: guests.docs.map((g) => ({
          pcId: g.get('pcId') as string,
          name: g.get('name') as string,
          answers: g.get('answers') as Record<string, string>,
          submittedAt: (g.get('submittedAt') as FirebaseFirestore.Timestamp).toMillis(),
        })),
        names: new Map(),
      }),
    );
    for (const r of stats.rows) {
      newRows.push([
        String(a.get('title')),
        normalizeName(String(cls.get('name') ?? '')),
        pcLabel(Number(r.pcId!.slice(2))),
        r.name,
        String(r.correctCount),
        String(stats.total),
      ]);
    }
    newSummaries.push([
      `${String(a.get('title'))} ${normalizeName(String(cls.get('name') ?? ''))}`,
      String(stats.submitted),
      String(stats.avgPercent),
    ]);
  }
  const oldCsv = toCsv([header, ...oldRows]) + toCsv(summaries);
  const newCsv = toCsv([header, ...newRows]) + toCsv(newSummaries);
  return {
    sessions: sessions.length,
    migrated,
    results: results.filter((r) => sessions.some((s) => s.id === r.data.sessionId)).length,
    guestResults: guestCount,
    oldCsv,
    newCsv,
    same: oldCsv === newCsv,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { flags } = args();
  const { db, project } = connect(str(flags.project));
  const from = str(flags.from);
  const dump: Dump = from
    ? (JSON.parse(readFileSync(from, 'utf8')) as Dump)
    : await dumpAll(db, project);
  const r = await verifyKlasPult(db, dump.docs);
  const dir = str(flags['out-dir']) ?? '.';
  writeFileSync(join(dir, 'verify-klas-pult.csv'), r.oldCsv);
  writeFileSync(join(dir, 'verify-platform.csv'), r.newCsv);
  console.log(`Сесій Клас-пульта: ${r.sessions}, перенесено: ${r.migrated}`);
  console.log(`Відповідей учнів: ${r.results}, у новій Історії: ${r.guestResults}`);
  console.log(
    r.same
      ? 'Бали збігаються (verify-klas-pult.csv = verify-platform.csv).'
      : 'Бали НЕ збігаються: порівняйте verify-klas-pult.csv і verify-platform.csv.',
  );
  if (!r.same || r.sessions !== r.migrated || r.results !== r.guestResults) process.exit(1);
}
