import { DocumentReference, GeoPoint, Timestamp, type Firestore } from 'firebase-admin/firestore';

/**
 * Резервная копия Firestore в JSON (на Spark нет `gcloud firestore export`).
 * Значения Firestore, которых нет в JSON, помечены: Timestamp → {"__ts": мс},
 * ссылка → {"__ref": путь}, GeoPoint → {"__geo": [lat, lng]}, байты → {"__bytes": base64}.
 */
export interface DumpDoc {
  path: string;
  data: Record<string, unknown>;
}

export interface Dump {
  project: string;
  createdAt: string;
  docs: DumpDoc[];
}

export function encode(v: unknown): unknown {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (v instanceof DocumentReference) return { __ref: v.path };
  if (v instanceof GeoPoint) return { __geo: [v.latitude, v.longitude] };
  if (v instanceof Uint8Array) return { __bytes: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  }
  return v;
}

export function decode(db: Firestore, v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => decode(db, x));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1) {
      if (typeof o.__ts === 'number') return Timestamp.fromMillis(o.__ts);
      if (typeof o.__ref === 'string') return db.doc(o.__ref);
      if (Array.isArray(o.__geo)) return new GeoPoint(o.__geo[0] as number, o.__geo[1] as number);
      if (typeof o.__bytes === 'string') return Buffer.from(o.__bytes, 'base64');
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(db, x)]));
  }
  return v;
}

/** Every document of the database, subcollections included. */
export async function dumpAll(db: Firestore, project: string): Promise<Dump> {
  const docs: DumpDoc[] = [];
  const walk = async (cols: FirebaseFirestore.CollectionReference[]) => {
    for (const col of cols) {
      // listDocuments also returns "missing" parents that only hold subcollections.
      for (const ref of await col.listDocuments()) {
        const snap = await ref.get();
        if (snap.exists)
          docs.push({ path: ref.path, data: encode(snap.data()) as DumpDoc['data'] });
        await walk(await ref.listCollections());
      }
    }
  };
  await walk(await db.listCollections());
  docs.sort((a, b) => a.path.localeCompare(b.path));
  return { project, createdAt: new Date().toISOString(), docs };
}

/** Counts by collection path pattern (`games/*\/answers`). */
export function countByCollection(docs: { path: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of docs) {
    const parts = d.path.split('/');
    const key = parts
      .slice(0, -1)
      .map((p, i) => (i % 2 === 1 ? '*' : p))
      .join('/');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
