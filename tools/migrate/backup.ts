/*
 * Резервная копия всей базы в JSON-файл.
 *   GOOGLE_APPLICATION_CREDENTIALS=ключ.json npx tsx tools/migrate/backup.ts --out backup.json
 * На эмуляторе: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 … --project demo-klas-pult
 */
import { writeFileSync } from 'node:fs';
import { args, connect, str } from './admin';
import { countByCollection, dumpAll } from './dump';

const { flags } = args();
const { db, project } = connect(str(flags.project));
const out = str(flags.out) ?? `backup-${project}-${new Date().toISOString().slice(0, 10)}.json`;
const dump = await dumpAll(db, project);
writeFileSync(out, JSON.stringify(dump, null, 1));
console.log(`Збережено ${dump.docs.length} документів у ${out}`);
for (const [col, n] of Object.entries(countByCollection(dump.docs))) console.log(`  ${col}: ${n}`);
