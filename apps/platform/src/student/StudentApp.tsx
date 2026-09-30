import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { deleteDoc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { useNavigate, useParams, useSearchParams } from 'react-router';
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
import { isJuniorGrade, normalizeSecret } from '../lib/secrets';
import { GameBanner } from './GameBanner';
import { HomeworkList } from './HomeworkList';
import { LessonScreen } from './LessonScreen';
import { pcNum as parsePcNum } from '@infoklas/shared/lesson';
import { roomRef, type RoomDoc } from '../data/room';
import { gamePinRef, type GamePinDoc } from '../data/games';

import { store } from '../lib/storage';
import { clean } from '../lib/text';
import { Brand } from '../components/Brand';
import { useConfirm } from '../components/Dialog';
import { ErrorText, Spinner } from '../components/Modal';
import { Picture } from '../components/Picture';

// Taking a test is a separate part: the waiting screen on weak PCs stays light.
const Homework = lazy(() => import('./Homework'));
const GamePlay = lazy(() => import('./GamePlay'));

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
  // The lesson in the computer lab (rooms/lab): the current class, tasks on screens.
  const room = useDoc<RoomDoc>(user ? roomRef() : null);
  const [guest, setGuest] = useState<Guest | null>(() => store.get<Guest | null>('guest', null));
  // A school PC remembers its number; a phone at home never has one.
  const [pc, setPc] = useState<number | null>(() => parsePcNum(store.get('pcNum', null)));
  const [noPc, setNoPc] = useState(() => store.get('noPc', false));
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

  // «Новий клас» on the teacher's console: a school PC logs out the previous pupil
  // (or guest) and shows the login of the new class; the PC number stays. Values
  // are compared, not times: school PCs' clocks are often wrong (Клас-пульт).
  const resetAt = room.data?.resetAt ?? null;
  const roomKnown = !!user && !room.loading && !room.fromCache && !room.pending;
  useEffect(() => {
    if (!roomKnown || !user) return;
    const seen = store.get<number | null | 'never'>('resetAt', 'never');
    if (seen === resetAt) return;
    store.set('resetAt', resetAt);
    if (seen === 'never' || pc === null) return;
    for (const k of [
      'guest',
      'hand',
      'done',
      'opened',
      'testDone',
      'testDraft',
      'testAnswers',
      'bound',
    ]) {
      store.remove(k);
    }
    setGuest(null);
    setNotice(null);
    if (binding.exists) void deleteDoc(bindingRef(user.uid)).catch(() => {});
  }, [roomKnown, resetAt, pc, user, binding.exists]);

  const theme = room.data?.theme === 'senior' ? 'senior' : 'junior';
  useEffect(() => {
    if (room.data) store.set('theme', theme);
  }, [room.data, theme]);
  const shownTheme = room.data ? theme : store.get('theme', 'junior');

  const lessonClass =
    room.data?.classId && room.data.className
      ? { id: room.data.classId, name: room.data.className }
      : null;

  let body: ReactNode;
  let wide = false;
  if (!user || binding.loading || room.loading) {
    body =
      authError || binding.error ? <ErrorText error={authError ?? binding.error} /> : <Spinner />;
  } else if (binding.exists && binding.data && !binding.pending) {
    // Only a binding the server accepted: a wrong password is written locally first
    // and then rejected, and the login form must stay on screen to say so.
    const b = binding.data;
    const myLesson = lessonClass?.id === b.classId;
    if (myLesson && pc === null && !noPc) {
      body = (
        <PcPrompt
          onDone={(n) => {
            store.set('pcNum', n);
            setPc(n);
          }}
          onSkip={() => {
            store.set('noPc', true);
            setNoPc(true);
          }}
        />
      );
    } else if (myLesson && pc !== null) {
      wide = true;
      body = (
        <BoundLesson
          uid={user.uid}
          b={b}
          room={room.data!}
          roomFromCache={room.fromCache}
          pc={pc}
          onStale={markStale}
        />
      );
    } else {
      body = <BoundHome uid={user.uid} b={b} onStale={markStale} />;
    }
  } else if (guest) {
    wide = true;
    body = (
      <div data-testid="guest-home">
        <LessonScreen
          uid={user.uid}
          room={room.data ?? {}}
          roomFromCache={room.fromCache}
          pc={guest.pc}
          who={{ name: guest.name, studentId: null, classId: null }}
          onNotMe={() => {
            store.remove('guest');
            setGuest(null);
          }}
        />
      </div>
    );
  } else {
    body = (
      <LoginFlow
        key={lessonClass?.id ?? 'none'}
        uid={user.uid}
        notice={notice}
        lessonClass={lessonClass}
        pc={pc}
        onGuest={(g) => {
          store.set('guest', g);
          store.set('pcNum', g.pc);
          setPc(g.pc);
          setGuest(g);
        }}
      />
    );
  }

  return (
    <div className={`student theme-${shownTheme}`}>
      <header className="student-bar">
        <span className="brand brand-light">
          <Brand /> ІнфоКлас
        </span>
      </header>
      <main className="student-main">
        <div className={`task-card${wide ? ' task-card-wide' : ''}`}>{body}</div>
      </main>
    </div>
  );
}

/** A pupil of the lesson class on a school PC. */
function BoundLesson({
  uid,
  b,
  room,
  roomFromCache,
  pc,
  onStale,
}: {
  uid: string;
  b: BindingDoc;
  room: RoomDoc;
  roomFromCache: boolean;
  pc: number;
  onStale: () => void;
}) {
  const confirm = useConfirm();
  const me = useDoc<RosterDoc>(rosterRef(b.classId, b.studentId));
  const [params, setParams] = useSearchParams();
  const playing = params.get('g');
  const gameNotice = useGameCode(b.classId);
  // A new password makes the binding invalid: the roster row stays readable, but
  // the class is not — the same check as on the home screen.
  useEffect(() => {
    let cancelled = false;
    getDoc(classRef(b.classId)).catch((err: unknown) => {
      if (cancelled || !isPermissionDenied(err)) return;
      onStale();
      void deleteDoc(bindingRef(uid));
    });
    return () => {
      cancelled = true;
    };
  }, [uid, b.classId, onStale]);

  if (me.loading) return <Spinner />;
  if (playing) {
    return (
      <Suspense fallback={<Spinner />}>
        <GamePlay
          gameId={playing}
          studentId={b.studentId}
          onBack={() => setParams({}, { replace: true })}
        />
      </Suspense>
    );
  }
  return (
    <div data-testid="student-home">
      <LessonScreen
        top={
          <>
            {gameNotice && <p className="alert alert-info">{gameNotice}</p>}
            <GameBanner classId={b.classId} onOpen={(id) => setParams({ g: id })} />
          </>
        }
        uid={uid}
        room={room}
        roomFromCache={roomFromCache}
        pc={pc}
        who={{ name: me.data?.displayName ?? '…', studentId: b.studentId, classId: b.classId }}
        onNotMe={async () => {
          const ok = await confirm({
            title: 'Вийти?',
            text: 'Щоб увійти знову, знадобиться твоя картка з паролем.',
            ok: 'Вийти',
          });
          if (!ok) return;
          store.remove('bound');
          await deleteDoc(bindingRef(uid));
        }}
      />
    </div>
  );
}

/**
 * /g/123456 (the game code on the projector, or its QR code) once the pupil is
 * logged in: opens the game of their class, or says it is another class's game.
 */
function useGameCode(classId: string) {
  const { pin } = useParams();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!pin) return;
    let cancelled = false;
    getDoc(gamePinRef(pin)).then(
      (snap) => {
        if (cancelled) return;
        const g = snap.data() as GamePinDoc | undefined;
        if (!g) setNotice(`Гру з кодом ${pin} не знайдено: можливо, вона вже завершилась.`);
        else if (g.classId !== classId)
          setNotice('Ця гра — для іншого класу. Натисни «Це не я / Вийти» і увійди у свій клас.');
        else navigate(`/?g=${g.gameId}`, { replace: true });
      },
      (err: unknown) => !cancelled && setNotice(errorText(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [pin, classId, navigate]);
  return notice;
}

/** Asked once on a school PC when the pupil's class is on the lesson. */
function PcPrompt({ onDone, onSkip }: { onDone: (n: number) => void; onSkip: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const n = parsePcNum(value);
        if (n === null) return setError('Введи номер від 1 до 99 — він наклеєний на моніторі.');
        onDone(n);
      }}
    >
      <h1 className="center">Ти в комп'ютерному класі?</h1>
      <label className="field">
        <span>Номер комп'ютера</span>
        <input
          className="input input-lg"
          inputMode="numeric"
          value={value}
          aria-label="Номер комп'ютера"
          onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 2))}
        />
        <small className="hint">Номер наклеєно на моніторі.</small>
      </label>
      <ErrorText error={error} />
      <button className="btn btn-sun btn-lg btn-block">Готово</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onSkip}>
        Я не за комп'ютером класу
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Logged in

function BoundHome({ uid, b, onStale }: { uid: string; b: BindingDoc; onStale: () => void }) {
  const confirm = useConfirm();
  const me = useDoc<RosterDoc>(rosterRef(b.classId, b.studentId));
  const [cls, setCls] = useState<ClassDoc | null>(null);
  const [params, setParams] = useSearchParams();
  const open = params.get('a');
  const playing = params.get('g');
  const gameNotice = useGameCode(b.classId);

  // A new password from the teacher makes this device's binding invalid: the
  // rules then refuse to show the class. Forget the binding and log in again.
  useEffect(() => {
    let cancelled = false;
    getDoc(classRef(b.classId)).then(
      (snap) => {
        if (!cancelled) setCls((snap.data() as ClassDoc | undefined) ?? null);
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

  if (playing) {
    return (
      <Suspense fallback={<Spinner />}>
        <GamePlay
          gameId={playing}
          studentId={b.studentId}
          onBack={() => setParams({}, { replace: true })}
        />
      </Suspense>
    );
  }

  if (open) {
    return (
      <Suspense fallback={<Spinner />}>
        <Homework
          assignmentId={open}
          classId={b.classId}
          studentId={b.studentId}
          junior={cls ? isJuniorGrade(cls.grade) : false}
          onBack={() => setParams({}, { replace: true })}
        />
      </Suspense>
    );
  }

  return (
    <div className="stack" data-testid="student-home">
      <div className="stack center">
        <h1>Привіт, {me.data?.displayName ?? '…'}!</h1>
        {cls && <p className="badge">Клас {cls.name}</p>}
      </div>
      {gameNotice && <p className="alert alert-info">{gameNotice}</p>}
      <GameBanner classId={b.classId} onOpen={(id) => setParams({ g: id })} />
      <HomeworkList
        classId={b.classId}
        studentId={b.studentId}
        onOpen={(id) => setParams({ a: id })}
      />
      <div className="center">
        <button className="btn btn-ghost btn-sm" onClick={() => void leave()}>
          Це не я / Вийти
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login: class code → name → pictures / password

type Pick = { id: string; data: RosterDoc };

function LoginFlow({
  uid,
  notice,
  lessonClass,
  pc,
  onGuest,
}: {
  uid: string;
  notice: string | null;
  /** The class on the lesson in the lab: its pupils pick their name without a code. */
  lessonClass: { id: string; name: string } | null;
  pc: number | null;
  onGuest: (g: Guest) => void;
}) {
  const params = useParams();
  // A school PC (it remembers its number) goes straight to the names of the lesson
  // class; elsewhere (a phone at home) the lesson is one button on the code screen.
  const straightToLesson = !!lessonClass && pc !== null && !params.code;
  const [step, setStep] = useState<'code' | 'game' | 'name' | 'secret' | 'guest'>(
    straightToLesson ? 'name' : 'code',
  );
  const navigate = useNavigate();
  const [gamePin, setGamePin] = useState(params.pin ?? '');
  /** Logging in to join a game (the heading says so). */
  const [forGame, setForGame] = useState(!!params.pin);
  const [fromLesson, setFromLesson] = useState(straightToLesson);
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
      await loadRoster(id);
      setFromLesson(false);
      store.set('lastCode', code);
      setStep('name');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const loadRoster = async (id: string) => {
    const list = await getDocs(rosterCol(id));
    setClassId(id);
    setRoster(
      list.docs
        .map((d) => ({ id: d.id, data: d.data() as RosterDoc }))
        .sort((a, b) => a.data.displayName.localeCompare(b.data.displayName, 'uk')),
    );
  };

  /** The game code: its class's names, then the game opens after the login (useGameCode). */
  const openGame = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!/^\d{6}$/.test(gamePin)) return setError('Код гри — це 6 цифр');
    setBusy(true);
    setError(null);
    try {
      const snap = await getDoc(gamePinRef(gamePin));
      const g = snap.data() as GamePinDoc | undefined;
      if (!g) {
        setError('Гру з таким кодом не знайдено. Перевір код на екрані вчителя.');
        setStep('game');
        return;
      }
      await loadRoster(g.classId);
      setFromLesson(false);
      setForGame(true);
      if (params.pin !== gamePin) navigate(`/g/${gamePin}`, { replace: true });
      setStep('name');
    } catch (err) {
      setError(errorText(err));
      setStep('game');
    } finally {
      setBusy(false);
    }
  };

  // A link from Google Classroom (/join/123456) opens the class right away; the
  // game code (/g/123456, QR on the projector) the class of that game; on a
  // lesson in the lab the names of the lesson class are shown without a code.
  useEffect(() => {
    if (params.pin) void openGame();
    else if (params.code) void openClass();
    else if (straightToLesson) openLesson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openLesson() {
    if (!lessonClass) return;
    setFromLesson(true);
    setStep('name');
    setBusy(true);
    setError(null);
    loadRoster(lessonClass.id)
      .catch((err: unknown) => {
        setError(errorText(err));
        setStep('code');
        setFromLesson(false);
      })
      .finally(() => setBusy(false));
  }

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

  if (step === 'game') {
    return (
      <form className="stack" onSubmit={openGame}>
        <h1 className="center">Введи код гри</h1>
        <p className="muted center">Код — 6 цифр на екрані вчителя (проектор).</p>
        <input
          className="input code-input"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          autoFocus
          value={gamePin}
          onChange={(e) => setGamePin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-label="Код гри"
          placeholder="••••••"
        />
        <ErrorText error={error} />
        <button className="btn btn-sun btn-lg btn-block" disabled={busy || gamePin.length !== 6}>
          До гри
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setError(null);
            setStep('code');
          }}
        >
          ← Код класу
        </button>
      </form>
    );
  }

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
        {lessonClass && (
          <button type="button" className="btn btn-secondary" onClick={openLesson}>
            Я на уроці: {lessonClass.name}
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setError(null);
            setStep('game');
          }}
        >
          Увійти в гру за кодом
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
        {/* A /join link skips the code step, so the notice is shown here too. */}
        {notice && <p className="alert alert-info">{notice}</p>}
        {fromLesson && lessonClass && (
          <p className="center">
            {pc !== null && <span className="badge">Комп’ютер {String(pc).padStart(2, '0')}</span>}{' '}
            <span className="badge" data-testid="lesson-badge">
              Урок: {lessonClass.name}
            </span>
          </p>
        )}
        {forGame && (
          <p className="center">
            <span className="badge" data-testid="game-join-badge">
              Вхід у живу гру
            </span>
          </p>
        )}
        <h1 className="center">Хто ти?</h1>
        {busy ? (
          <Spinner />
        ) : roster.length === 0 ? (
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
        <div className="row row-center">
          <button className="btn btn-ghost btn-sm" onClick={() => setStep('code')}>
            {fromLesson ? 'Я з іншого класу (ввести код)' : '← Інший код'}
          </button>
          {fromLesson && (
            <button className="btn btn-ghost btn-sm" onClick={() => setStep('guest')}>
              Увійти як гість
            </button>
          )}
        </div>
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
