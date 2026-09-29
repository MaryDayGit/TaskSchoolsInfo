import { isEmulator } from '../firebase/app';

/**
 * Counts Firestore writes of the pupil's lesson page on the emulator only, so an
 * e2e scenario can measure a lesson against the Spark limit (20 000 writes a day).
 */
export function countWrite(n = 1) {
  if (!isEmulator) return;
  const w = window as unknown as { __infoklasWrites?: number };
  w.__infoklasWrites = (w.__infoklasWrites ?? 0) + n;
}
