/*
 * «Виртуальные» ученики для нагрузочной проверки: отдельные клиенты Firebase в
 * Node (свой анонимный вход, своя привязка к ученику), которые работают с базой
 * так же, как страница ученика, и под теми же правилами Firestore. Так на
 * эмуляторе можно проверить класс из 30 человек без 30 окон браузера.
 */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';

let n = 0;

export class VirtualPupil {
  private app: FirebaseApp;
  db: Firestore;
  uid = '';

  constructor(
    readonly studentId: string,
    readonly classId: string,
    private secret: string,
  ) {
    this.app = initializeApp(
      { apiKey: 'demo-key', projectId: 'demo-klas-pult', authDomain: 'x' },
      `pupil-${++n}`,
    );
    const auth = getAuth(this.app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    this.db = getFirestore(this.app);
    connectFirestoreEmulator(this.db, '127.0.0.1', 8080);
  }

  /** The same as a pupil logging in with the password: anonymous user + binding. */
  async login() {
    const cred = await signInAnonymously(getAuth(this.app));
    this.uid = cred.user.uid;
    await setDoc(doc(this.db, 'bindings', this.uid), {
      classId: this.classId,
      studentId: this.studentId,
      secret: this.secret,
      createdAt: serverTimestamp(),
      device: 'load test',
    });
  }

  /** Resolves with the first snapshot data for which `test` is true. */
  waitFor<T>(path: string, test: (data: Record<string, unknown> | undefined) => T | null) {
    return new Promise<T>((resolve, reject) => {
      const stop = onSnapshot(
        doc(this.db, path),
        (snap) => {
          const r = test(snap.data());
          if (r !== null) {
            stop();
            resolve(r);
          }
        },
        reject,
      );
    });
  }

  close() {
    return deleteApp(this.app);
  }
}
