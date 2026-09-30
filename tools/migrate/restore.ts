/*
 * Резервная копия → ЭМУЛЯТОР (прогон переноса на копии боевых данных).
 * В боевую базу не пишет никогда.
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx tools/migrate/restore.ts backup.json
 */
import { readFileSync } from 'node:fs';
import { args, connect, str } from './admin';
import { decode, type Dump } from './dump';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Відновлення лише в емулятор: задайте FIRESTORE_EMULATOR_HOST.');
  process.exit(2);
}
const { flags, rest } = args();
const file = rest[0];
if (!file) {
  console.error('Вкажіть файл резервної копії.');
  process.exit(2);
}
const dump = JSON.parse(readFileSync(file, 'utf8')) as Dump;
const { db, project } = connect(str(flags.project));
const bulk = db.bulkWriter();
for (const d of dump.docs) {
  void bulk.set(db.doc(d.path), decode(db, d.data) as FirebaseFirestore.DocumentData);
}
await bulk.close();
console.log(`Відновлено ${dump.docs.length} документів з ${dump.project} в емулятор ${project}.`);
