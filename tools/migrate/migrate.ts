/*
 * Перенос данных в единую платформу. Только добавляет документы, старые не меняет.
 *
 *   Клас-пульт (тот же проект Firebase):
 *     npx tsx tools/migrate/migrate.ts klas-pult --dry-run
 *     npx tsx tools/migrate/migrate.ts klas-pult [--from backup.json] [--grade "Гурток=7"]
 *   ІнфоКлас (PostgreSQL):
 *     npx tsx tools/migrate/migrate.ts infoklas --pg "postgres://…" [--dry-run]
 *
 * Куда: GOOGLE_APPLICATION_CREDENTIALS=ключ.json (боевая база) или
 * FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 --project demo-klas-pult (эмулятор).
 * --plan plan.json сохраняет план (что будет создано) в файл.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { args, connect, str } from './admin';
import { dumpAll, type Dump } from './dump';
import { planInfoKlas, readInfoKlasRows } from './infoklas';
import { planKlasPult } from './klaspult';
import { countWrites } from './plan';
import { applyPlan, readTarget } from './store';

const { flags, rest } = args();
const source = rest[0];
if (source !== 'klas-pult' && source !== 'infoklas') {
  console.error('Вкажіть, звідки переносити: klas-pult або infoklas.');
  process.exit(2);
}
const dryRun = flags['dry-run'] === true;
const { db, project, emulator } = connect(str(flags.project));
console.log(
  `База: ${emulator ? 'емулятор' : 'бойова'} (${project})${dryRun ? ', сухий прогін' : ''}`,
);

const target = await readTarget(db);
let plan;
if (source === 'klas-pult') {
  const from = str(flags.from);
  const dump: Dump = from
    ? (JSON.parse(readFileSync(from, 'utf8')) as Dump)
    : await dumpAll(db, project);
  const grades: Record<string, number> = {};
  const g = flags.grade;
  for (const item of typeof g === 'string' ? g.split(',') : []) {
    const [name, grade] = item.split('=');
    if (name && grade) grades[name.trim()] = Number(grade);
  }
  plan = planKlasPult(dump.docs, target, { grades });
} else {
  const url = str(flags.pg) ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Вкажіть --pg "postgres://…" або DATABASE_URL.');
    process.exit(2);
  }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const rows = await readInfoKlasRows((sql) => client.query(sql));
  await client.end();
  plan = planInfoKlas(rows, target);
}

for (const n of plan.notes) console.log(n);
for (const w of plan.warnings) console.log(`Увага: ${w}`);
console.log('Буде створено:');
for (const [col, n] of Object.entries(countWrites(plan.writes))) console.log(`  ${col}: ${n}`);
const planFile = str(flags.plan);
if (planFile) writeFileSync(planFile, JSON.stringify(plan, null, 1));

if (!dryRun) {
  const r = await applyPlan(db, plan.writes);
  console.log(`Створено ${r.created}, вже були ${r.existed}, помилок ${r.failed.length}.`);
  for (const f of r.failed) console.log(`  ${f}`);
  if (r.failed.length) process.exit(1);
}
