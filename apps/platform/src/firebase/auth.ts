import { useSyncExternalStore } from 'react';
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { RETRY_MS, auth } from './app';
import { errorText } from './errors';

interface AuthState {
  user: User | null;
  /** Последняя ошибка входа (вход повторяется сам каждые 5 с). */
  error: string | null;
}

let state: AuthState = { user: null, error: null };
const listeners = new Set<() => void>();
let signingIn = false;

function emit(next: Partial<AuthState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/**
 * Анонимный вход — только если никто не вошёл. Вход общий для вкладок сайта:
 * безусловный signInAnonymously в одной вкладке сменил бы пользователя и в
 * соседней (учитель потерял бы кабинет). Урок Клас-пульта.
 */
function signIn() {
  if (signingIn) return;
  signingIn = true;
  signInAnonymously(auth).then(
    () => {
      signingIn = false;
    },
    (err: unknown) => {
      signingIn = false;
      emit({ error: errorText(err) });
      setTimeout(() => {
        if (!auth.currentUser) signIn();
      }, RETRY_MS);
    },
  );
}

onAuthStateChanged(auth, (user) => {
  if (user) emit({ user, error: null });
  else {
    emit({ user: null });
    signIn();
  }
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => state;

/**
 * Текущий (анонимный) пользователь; `user: null`, пока вход не завершён.
 * useSyncExternalStore: вход может завершиться между рендером и подпиской
 * компонента (например, пока грузится часть кабинета) — обновление не теряется.
 */
export function useUser(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
