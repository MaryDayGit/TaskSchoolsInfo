import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

/**
 * Конфиг проекта klas-pult (Project settings → Your apps → klas-pult-web).
 * apiKey не секрет: данные защищают правила Firestore.
 */
const PRODUCTION_CONFIG = {
  apiKey: 'AIzaSyCTPJzgqET1Wns3NwdjPB85dv99SlHzL4U',
  authDomain: 'klas-pult.firebaseapp.com',
  projectId: 'klas-pult',
  storageBucket: 'klas-pult.firebasestorage.app',
  messagingSenderId: '150727200214',
  appId: '1:150727200214:web:914e486c824388732ee877',
};

/**
 * На localhost всегда используется демо-проект эмуляторов (как в Клас-пульте):
 * локальная проверка не может задеть боевые данные.
 */
export const isEmulator = ['localhost', '127.0.0.1'].includes(window.location.hostname);

const app = initializeApp(
  isEmulator
    ? {
        apiKey: 'demo-key',
        projectId: 'demo-klas-pult',
        authDomain: 'demo-klas-pult.firebaseapp.com',
      }
    : PRODUCTION_CONFIG,
);

// initializeAuth instead of getAuth: only the persistence we need and no popup/redirect
// resolver (no Google sign-in yet), which keeps the student page noticeably smaller.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});
export const db = getFirestore(app);

if (isEmulator) {
  const host = window.location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
}

/** Пауза перед повтором подписки или входа после ошибки (как в Клас-пульте). */
export const RETRY_MS = 5000;
