import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { deleteDoc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { useParams } from 'react-router';
import { PICTURES, type PictureId } from '@infoklas/shared/pictures';
import { useUser } from '../firebase/auth';
import { errorText, isPermissionDenied } from '../firebase/errors';
import { useDoc } from '../firebase/watch';
import {
  NAME_MAX,
  bindingRef,
  classRef,
  joinCodeRef,
  rosterCol,
  rosterRef,
  type BindingDoc,
  type ClassDoc,
  type RosterDoc,
} from '../data/classes';
import { describeDevice } from '../lib/device';
import { normalizeSecret } from '../lib/secrets';
import { store } from '../lib/storage';
import { clean } from '../lib/text';
import { Brand } from '../components/Brand';
import { useConfirm } from '../components/Dialog';
import { ErrorText, Spinner } from '../components/Modal';
import { Picture } from '../components/Picture';

const LOGGED_OUT =
  'Вчитель видав тобі новий пароль або вийшов з твоїх пристроїв. Увійди ще раз з карткою.';

interface Guest {
  pc: number;
  name: string;
}

/** Student page: the same on a school PC and on a phone at home. */
export function StudentApp() {
  const { user, error: authError } = useUser();
  const binding = useDoc<BindingDoc>(user ? bindingRef(user.uid) : null);
  const [guest, setGuest] = useState<Guest | null>(() => store.get<Guest | null>('guest', null));
  const [notice, setNotice] = useState<string | null>(null);
  const markStale = useCallback(() => {
    store.remove('bound');
    setNotice(LOGGED_OUT);
  }, []);

  // «Новий пароль» and «Вийти з усіх пристроїв» delete this device's binding. Remember
  // that the device was logged in, so the pupil is told why the login screen is back.
  // A cached answer is skipped: offline, the binding may just not be loaded yet.
  const known = !!user && !binding.loading && !binding.pending && !binding.fromCache;
  useEffect(() => {
    if (!known) return;
    if (binding.exists) store.set('bound', true);
    else if (store.get('bound', false)) markStale();
  }, [known, binding.exists, markStale]);

  let body: ReactNode;
  if (!user || binding.loading) {
    body =
      authError || binding.error ? <ErrorText error={authError ?? binding.error} /> : <Spinner />;
  } else if (binding.exists && binding.data && !binding.pending) {
    // Only a binding the server accepted: a wrong password is written locally first
    // and then rejected, and the login form must stay on screen to say so.
    body = <BoundHome uid={user.uid} b={binding.data} onStale={markStale} />;
  } else if (guest) {
    body = (
      <GuestHome
        guest={guest}
        onLeave={() => {
          store.remove('guest');
          setGuest(null);
        }}
      />
    );
  } else {
    body = (
      <LoginFlow
        uid={user.uid}
        notice={notice}
        onGuest={(g) => {
          store.set('guest', g);
          store.set('pcNum', g.pc);
          setGuest(g);
        }}
      />
    );
  }

  return (
    <div className="student">
      <header className="student-bar">
        <span className="brand brand-light">
          <Brand /> ІнфоКлас
        </span>
      </header>
      <main className="student-main">
        <div className="task-card">{body}</div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logged in

function BoundHome({ uid, b, onStale }: { uid: string; b: BindingDoc; onStale: () => void }) {
  const confirm = useConfirm();
  const me = useDoc<RosterDoc>(rosterRef(b.classId, b.studentId));
  const [className, setClassName] = useState<string | null>(null);

  // A new password from the teacher makes this device's binding invalid: the
  // rules then refuse to show the class. Forget the binding and log in again.
  useEffect(() => {
    let cancelled = false;
    getDoc(classRef(b.classId)).then(
      (snap) => {
        if (!cancelled) setClassName((snap.data() as ClassDoc | undefined)?.name ?? null);
      },
      (err) => {
        if (cancelled || !isPermissionDenied(err)) return;
        onStale();
        void deleteDoc(bindingRef(uid));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uid, b.classId, b.studentId, onStale]);

  const leave = async () => {
    const ok = await confirm({
      title: 'Вийти?',
      text: 'Щоб увійти знову, знадобиться твоя картка з паролем.',
      ok: 'Вийти',
    });
    if (!ok) return;
    store.remove('bound');
    await deleteDoc(bindingRef(uid));
  };

  return (
    <div className="stack center" data-testid="student-home">
      <h1>Привіт, {me.data?.displayName ?? '…'}!</h1>
      {className && <p className="badge">Клас {className}</p>}
      <p className="waiting">
        <span className="pulse-dot" aria-hidden="true" /> Чекаємо на завдання
      </p>
      <button className="btn btn-ghost btn-sm" onClick={() => void leave()}>
        Це не я / Вийти
      </button>
    </div>
  );
}

function GuestHome({ guest, onLeave }: { guest: Guest; onLeave: () => void }) {
  return (
    <div className="stack center" data-testid="guest-home">
      <p className="pc-number">ПК {String(guest.pc).padStart(2, '0')}</p>
      <h1>{guest.name}</h1>
      <p className="muted">Ти увійшов(ла) як гість: результати побачить учитель на уроці.</p>
      <p className="waiting">
        <span className="pulse-dot" aria-hidden="true" /> Чекаємо на завдання
      </p>
      <button className="btn btn-ghost btn-sm" onClick={onLeave}>
        Це не я
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login: class code → name → pictures / password

type Pick = { id: string; data: RosterDoc };

function LoginFlow({
  uid,
  notice,
  onGuest,
}: {
  uid: string;
  notice: string | null;
  onGuest: (g: Guest) => void;
}) {
  const params = useParams();
  const [step, setStep] = useState<'code' | 'name' | 'secret' | 'guest'>('code');
  const [code, setCode] = useState(params.code ?? store.get('lastCode', ''));
  const [classId, setClassId] = useState<string | null>(null);
  const [roster, setRoster] = useState<Pick[]>([]);
  const [student, setStudent] = useState<Pick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openClass = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('Код класу — це 6 цифр');
    setBusy(true);
    setError(null);
    try {
      const snap = await getDoc(joinCodeRef(code));
      const id = (snap.data() as { classId?: string } | undefined)?.classId;
      if (!id) {
        setError('Клас з таким кодом не знайдено. Перевір код.');
        return;
      }
      const list = await getDocs(rosterCol(id));
      setClassId(id);
      setRoster(
        list.docs
          .map((d) => ({ id: d.id, data: d.data() as RosterDoc }))
          .sort((a, b) => a.data.displayName.localeCompare(b.data.displayName, 'uk')),
      );
      store.set('lastCode', code);
      setStep('name');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // A link from Google Classroom (/join/123456) opens the class right away.
  useEffect(() => {
    if (params.code) void openClass();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (secret: string): Promise<boolean> => {
    if (!classId || !student) return false;
    try {
      await setDoc(bindingRef(uid), {
        classId,
        studentId: student.id,
        secret: normalizeSecret(student.data.secretKind, secret),
        createdAt: serverTimestamp(),
        device: describeDevice(),
      });
      return true;
    } catch (err) {
      setError(
        isPermissionDenied(err)
          ? student.data.secretKind === 'pictures'
            ? 'Не ті картинки. Спробуй ще раз!'
            : 'Неправильний пароль. Спробуй ще раз!'
          : errorText(err),
      );
      return false;
    }
  };

  if (step === 'guest') return <GuestForm onDone={onGuest} onBack={() => setStep('code')} />;

  if (step === 'code') {
    return (
      <form className="stack" onSubmit={openClass}>
        {notice && <p className="alert alert-info">{notice}</p>}
        <h1 className="center">Введи код класу</h1>
        <p className="muted center">Код — це 6 цифр. Він є на твоїй картці.</p>
        <input
          className="input code-input"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-label="Код класу"
          placeholder="••••••"
        />
        <ErrorText error={error} />
        <button className="btn btn-sun btn-lg btn-block" disabled={busy || code.length !== 6}>
          Далі
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('guest')}>
          Увійти як гість (на уроці, без картки)
        </button>
      </form>
    );
  }

  if (step === 'name' || !student) {
    return (
      <div className="stack">
        <h1 className="center">Хто ти?</h1>
        {roster.length === 0 ? (
          <p className="muted center">У класі ще немає учнів. Попроси вчителя додати тебе.</p>
        ) : (
          <div className="name-grid">
            {roster.map((s) => (
              <button
                key={s.id}
                className="name-btn"
                onClick={() => {
                  setStudent(s);
                  setError(null);
                  setStep('secret');
                }}
              >
                {s.data.displayName}
              </button>
            ))}
          </div>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setStep('code')}>
          ← Інший код
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1 className="center">Привіт, {student.data.displayName}!</h1>
      {student.data.secretKind === 'pictures' ? (
        <PictureLogin
          count={student.data.pictureCount ?? 4}
          onSubmit={login}
          onInput={() => setError(null)}
        />
      ) : (
        <PasswordLogin onSubmit={login} />
      )}
      <ErrorText error={error} />
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setStudent(null);
          setError(null);
          setStep('name');
        }}
      >
        Це не я
      </button>
    </div>
  );
}

function PictureLogin({
  count,
  onSubmit,
  onInput,
}: {
  count: number;
  onSubmit: (secret: string) => Promise<boolean>;
  onInput: () => void;
}) {
  const [picked, setPicked] = useState<PictureId[]>([]);
  const [busy, setBusy] = useState(false);

  const add = async (id: PictureId) => {
    onInput();
    const next = [...picked, id];
    setPicked(next);
    if (next.length === count) {
      setBusy(true);
      const ok = await onSubmit(next.join('-'));
      setBusy(false);
      if (!ok) setPicked([]);
    }
  };

  return (
    <>
      <p className="center muted">Натисни свої {count} картинки по черзі</p>
      <div className="picture-slots" aria-live="polite">
        {Array.from({ length: count }, (_, i) => {
          const id = picked[i];
          return (
            <div key={i} className={`picture-slot${id ? ' filled' : ''}`}>
              {id && <Picture id={id} size={44} />}
            </div>
          );
        })}
      </div>
      <div className="picture-grid">
        {PICTURES.map((p) => (
          <button
            key={p.id}
            className="picture-btn"
            aria-label={p.label}
            title={p.label}
            disabled={busy || picked.length >= count}
            onClick={() => void add(p.id)}
          >
            <Picture id={p.id} size={52} />
          </button>
        ))}
      </div>
      <div className="center">
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy || picked.length === 0}
          onClick={() => setPicked((cur) => cur.slice(0, -1))}
        >
          Стерти
        </button>
      </div>
    </>
  );
}

function PasswordLogin({ onSubmit }: { onSubmit: (secret: string) => Promise<boolean> }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        setBusy(true);
        await onSubmit(value);
        setBusy(false);
      }}
    >
      <input
        className="input input-lg"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Пароль"
        placeholder="Твій пароль з картки"
      />
      <button className="btn btn-sun btn-lg btn-block" disabled={busy || !value.trim()}>
        Увійти
      </button>
    </form>
  );
}

function GuestForm({ onDone, onBack }: { onDone: (g: Guest) => void; onBack: () => void }) {
  const [pc, setPc] = useState(String(store.get<number | ''>('pcNum', '')));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(pc);
        const cleanName = clean(name, NAME_MAX);
        if (!Number.isInteger(n) || n < 1 || n > 99)
          return setError('Номер комп’ютера — від 1 до 99');
        if (!cleanName) return setError("Напиши своє ім'я та прізвище");
        onDone({ pc: n, name: cleanName });
      }}
    >
      <h1 className="center">Давай познайомимось</h1>
      <label className="field">
        <span>Номер комп'ютера</span>
        <input
          className="input input-lg"
          inputMode="numeric"
          value={pc}
          onChange={(e) => setPc(e.target.value.replace(/\D/g, '').slice(0, 2))}
          aria-label="Номер комп'ютера"
        />
        <small className="hint">Номер наклеєно на моніторі.</small>
      </label>
      <label className="field">
        <span>Ім'я та прізвище</span>
        <input
          className="input input-lg"
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          aria-label="Ім'я та прізвище"
        />
      </label>
      <ErrorText error={error} />
      <button className="btn btn-sun btn-lg btn-block">Готово</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
        ← У мене є картка
      </button>
    </form>
  );
}
