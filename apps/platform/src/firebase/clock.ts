import { useSyncExternalStore } from 'react';
import { doc, getDocFromServer, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore';
import { db } from './app';

// Время сервера (Клас-пульт, App.syncClock): часы школьных ПК часто врут на
// минуты и часы, а таймер урока должен совпадать на всех экранах. Страница
// один раз пишет в clock/{uid} серверное время и читает его обратно.

let offset = 0;
let ready = false;
let synced: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Server time by this computer's clock. */
export const serverNow = () => Date.now() + offset;

export function syncClock(uid: string): Promise<void> {
  if (synced) return synced;
  synced = (async () => {
    const ref = doc(db, 'clock', uid);
    const sent = Date.now();
    await setDoc(ref, { t: serverTimestamp() });
    const acked = Date.now();
    const snap = await getDocFromServer(ref);
    const t = snap.get('t') as Timestamp | undefined;
    if (t) offset = t.toMillis() - (sent + acked) / 2;
    ready = true;
    listeners.forEach((l) => l());
  })().catch((err: unknown) => {
    synced = null; // try again next time
    throw err;
  });
  return synced;
}

/** True once this page knows the server time (until then a timer can't be trusted). */
export function useClockReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => ready,
  );
}
