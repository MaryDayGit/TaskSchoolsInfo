import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { deleteDoc, doc, getDoc, writeBatch, setDoc } from 'firebase/firestore';
import { RETRY_MS, db } from '../firebase/app';
import { useUser } from '../firebase/auth';
import { errorText, isPermissionDenied } from '../firebase/errors';
import { useConfirm } from '../components/Dialog';
import { Brand } from '../components/Brand';

/** Границы кода совпадают с правилами (validCode: 4–64 символа). */
const CODE_MIN = 4;
const CODE_MAX = 64;

type Mode = 'checking' | 'create' | 'enter' | 'teacher' | 'error';

const TeacherContext = createContext<{ logout: () => void } | null>(null);
export const useTeacher = () => {
  const ctx = useContext(TeacherContext);
  if (!ctx) throw new Error('useTeacher must be used inside <TeacherGate>');
  return ctx;
};

/**
 * Вход учителя по коду (механизм Клас-пульта): браузер становится учительским,
 * создав teachers/{uid} с кодом, который правила сверяют с secret/teacher.
 * При первом запуске код придумывается: secret + setup + teachers одним пакетом.
 */
export function TeacherGate({ children }: { children: ReactNode }) {
  const { user, error: authError } = useUser();
  const uid = user?.uid ?? null;
  const [mode, setMode] = useState<Mode>('checking');
  const [message, setMessage] = useState('');
  const confirm = useConfirm();

  const check = useCallback(async () => {
    if (!uid) return;
    setMode('checking');
    try {
      const me = await getDoc(doc(db, 'teachers', uid));
      if (me.exists()) return setMode('teacher');
      const setup = await getDoc(doc(db, 'setup', 'state'));
      setMode(setup.exists() ? 'enter' : 'create');
    } catch (err) {
      setMessage(errorText(err));
      setMode('error');
      setTimeout(() => void check(), RETRY_MS);
    }
  }, [uid]);

  useEffect(() => {
    void check();
  }, [check]);

  const logout = useCallback(async () => {
    if (!uid) return;
    const ok = await confirm({
      title: 'Вийти з кабінету?',
      text: "На цьому комп'ютері кабінет знову попросить код учителя.",
      ok: 'Вийти',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'teachers', uid));
      setMessage('');
      await check();
    } catch (err) {
      setMessage(errorText(err));
    }
  }, [uid, confirm, check]);

  if (mode === 'teacher') {
    return <TeacherContext.Provider value={{ logout }}>{children}</TeacherContext.Provider>;
  }

  return (
    <main className="login-screen">
      <div className="card login">
        <h1 className="login-title">
          <Brand /> Кабінет учителя
        </h1>
        {!uid || mode === 'checking' ? (
          authError ? (
            <p className="alert alert-error" role="alert">
              {authError}
            </p>
          ) : (
            <div className="spinner" role="status" aria-label="Завантаження" />
          )
        ) : mode === 'error' ? (
          <p className="alert alert-error" role="alert">
            {message}
          </p>
        ) : (
          <CodeForm
            uid={uid}
            creating={mode === 'create'}
            initialMessage={message}
            onDone={() => setMode('teacher')}
            onCodeExists={() => {
              setMessage('Код учителя вже існує. Введіть його.');
              setMode('enter');
            }}
          />
        )}
      </div>
    </main>
  );
}

function CodeForm({
  uid,
  creating,
  initialMessage,
  onDone,
  onCodeExists,
}: {
  uid: string;
  creating: boolean;
  initialMessage: string;
  onDone: () => void;
  onCodeExists: () => void;
}) {
  const [code, setCode] = useState('');
  const [code2, setCode2] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialMessage);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (value.length < CODE_MIN)
      return setMessage(`Код має містити щонайменше ${CODE_MIN} символи.`);
    if (creating && value !== code2.trim())
      return setMessage('Коди не збігаються. Введіть однаковий код двічі.');
    setBusy(true);
    setMessage('');
    try {
      if (creating) {
        const batch = writeBatch(db);
        batch.set(doc(db, 'secret', 'teacher'), { code: value });
        batch.set(doc(db, 'setup', 'state'), { codeSet: true });
        batch.set(doc(db, 'teachers', uid), { code: value });
        await batch.commit();
      } else {
        await setDoc(doc(db, 'teachers', uid), { code: value });
      }
      onDone();
    } catch (err) {
      setBusy(false);
      if (isPermissionDenied(err)) {
        if (creating) onCodeExists();
        else setMessage('Неправильний код.');
      } else setMessage(errorText(err));
    }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {creating && (
        <p>
          Перший запуск. Придумайте код учителя: ним відкривається кабінет. Учні його не знають, тож
          не зможуть керувати екранами чи побачити правильні відповіді.
        </p>
      )}
      <label className="field">
        <span>{creating ? 'Новий код учителя' : 'Код учителя'}</span>
        <input
          className="input"
          type="password"
          autoComplete="off"
          autoFocus
          maxLength={CODE_MAX}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      {creating && (
        <label className="field">
          <span>Повторіть код</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            maxLength={CODE_MAX}
            value={code2}
            onChange={(e) => setCode2(e.target.value)}
          />
        </label>
      )}
      <p className="hint">
        {creating
          ? `Щонайменше ${CODE_MIN} символи. Запишіть код: він знадобиться, щоб відкрити кабінет на іншому комп'ютері.`
          : "Цей браузер запам'ятає вас — наступного разу код не знадобиться."}
      </p>
      {message && (
        <p className="alert alert-error" role="alert">
          {message}
        </p>
      )}
      <button className="btn btn-lg btn-block" disabled={busy}>
        {creating ? 'Зберегти код і відкрити кабінет' : 'Увійти'}
      </button>
    </form>
  );
}
