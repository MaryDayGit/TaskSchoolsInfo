/**
 * localStorage with a prefix, JSON and try/catch everywhere (private mode and
 * locked-down school PCs may forbid storage). Same idea as App.store in Клас-пульт.
 */
const PREFIX = 'infoklas.';

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* storage unavailable: the value just isn't remembered */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
};
