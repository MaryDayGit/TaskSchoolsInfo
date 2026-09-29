import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { serverTimestamp } from 'firebase/firestore';
import {
  HEARTBEAT_MS,
  TYPE_LABELS,
  domainOf,
  durationText,
  pcId as toPcId,
  pcLabel,
  safeUrl,
  taskKey,
  timerLeft,
  visibleTask,
  type LessonTask,
} from '@infoklas/shared/lesson';
import { isEmulator } from '../firebase/app';
import { serverNow, syncClock, useClockReady } from '../firebase/clock';
import { writePc, type RoomDoc } from '../data/room';
import { Icon } from '../components/Icon';
import { Spinner } from '../components/Modal';
import { countWrite } from '../lib/metrics';
import { store } from '../lib/storage';
import { questionsLabel } from '../lib/text';

// Страница ученика на уроке (Клас-пульт, student.js): номер ПК, задание на
// экране, блокировка «Дивимось на дошку», таймер по времени сервера, рука,
// «Я закінчив(ла)», тест на уроке. Задание перерисовывается только при смене
// его ключа (type + sentAt): блокировка или таймер не сбрасывают начатый тест.

const LessonTest = lazy(() => import('./LessonTest'));

const BLINK_MS = 700;
const BLINK_STEPS = 10;
const OFFLINE_DELAY_MS = 3000;

/** On the emulator a test may speed up the heartbeat (?hb=100) to measure writes. */
const heartbeatMs = () => {
  const hb = isEmulator ? Number(new URLSearchParams(window.location.search).get('hb')) : 0;
  return hb > 0 ? hb : HEARTBEAT_MS;
};

export interface Who {
  name: string;
  /** null for a guest. */
  studentId: string | null;
  classId: string | null;
}

let blinkTimer: ReturnType<typeof setInterval> | null = null;
function blinkTitle(text: string) {
  const base = 'ІнфоКлас';
  if (blinkTimer) clearInterval(blinkTimer);
  let step = 0;
  document.title = text;
  blinkTimer = setInterval(() => {
    step++;
    if (step >= BLINK_STEPS) {
      if (blinkTimer) clearInterval(blinkTimer);
      blinkTimer = null;
      document.title = base;
      return;
    }
    document.title = step % 2 ? base : text;
  }, BLINK_MS);
}

export function LessonScreen({
  uid,
  room,
  roomFromCache,
  pc,
  who,
  onNotMe,
}: {
  uid: string;
  room: RoomDoc;
  roomFromCache: boolean;
  pc: number;
  who: Who;
  onNotMe: () => void;
}) {
  const id = toPcId(pc);
  const task = visibleTask(room.task, id);
  const key = taskKey(task);
  const card = { pc: id, num: pc, name: who.name, studentId: who.studentId };
  const cardRef = useRef(card);
  cardRef.current = card;

  const write = (extra: Record<string, unknown> = {}) => {
    countWrite();
    writePc(id, { ...cardRef.current, ...extra }).catch(() => {});
  };

  // ---- Connection: a red bar if the problem lasts 3 s ----
  const [online, setOnline] = useState(navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const problem = !online || roomFromCache;
  const [showBar, setShowBar] = useState(false);
  useEffect(() => {
    if (!problem) return setShowBar(false);
    const t = setTimeout(() => setShowBar(true), OFFLINE_DELAY_MS);
    return () => clearTimeout(t);
  }, [problem]);

  // ---- «В мережі»: once now and every 60 s. Not while offline: a queued write
  // could bring back a card the teacher deleted with «Новий клас». ----
  const problemRef = useRef(problem);
  problemRef.current = problem;
  useEffect(() => {
    const beat = () => {
      if (!problemRef.current) write();
    };
    beat();
    const t = setInterval(beat, heartbeatMs());
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, who.name, who.studentId]);

  // ---- Clock: once, after the first answer from the server ----
  useEffect(() => {
    if (!roomFromCache) syncClock(uid).catch(() => {});
  }, [uid, roomFromCache]);

  // ---- Blink the tab title when a new task arrives while the page is open ----
  const shownKey = useRef<string | null>(null);
  useEffect(() => {
    if (shownKey.current !== null && shownKey.current !== key && task)
      blinkTitle('(!) Нове завдання');
    shownKey.current = key;
  }, [key, task]);

  // ---- Hand ----
  const [hand, setHand] = useState<{ id: number } | null>(() => store.get('hand', null));
  const raise = () => {
    const h = { id: Date.now() };
    setHand(h);
    store.set('hand', h);
    write({ handAt: serverTimestamp(), handId: h.id });
  };
  const lower = () => {
    setHand(null);
    store.remove('hand');
    write({ handAt: null, handId: null });
  };
  const downId = room.handsDown?.[id];
  useEffect(() => {
    if (hand && downId === hand.id) lower();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downId, hand]);

  // ---- «Я закінчив(ла)» for links and messages ----
  const [done, setDone] = useState<number | null>(() => store.get<number | null>('done', null));
  const canFinish = task?.type === 'link' || task?.type === 'message';
  const finished = !!task && done === task.sentAt;
  const toggleDone = () => {
    if (!task) return;
    if (finished) {
      setDone(null);
      store.remove('done');
      write({ doneAt: null });
    } else {
      setDone(task.sentAt);
      store.set('done', task.sentAt);
      write({ doneAt: task.sentAt });
    }
  };

  /** «Відкрив(ла)»: one write per task. */
  const markOpened = (t: LessonTask) => {
    if (store.get('opened', null) === t.sentAt) return;
    store.set('opened', t.sentAt);
    write({ openedAt: t.sentAt });
  };

  const locked = room.locked === true;
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (locked && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, [locked]);

  return (
    <>
      <div
        ref={mainRef}
        className="lesson-screen"
        inert={locked}
        aria-hidden={locked || undefined}
        data-testid="lesson-screen"
      >
        <header className="who">
          <div className="who-pc">
            <span className="who-pc-label">Комп’ютер</span>
            <span className="who-pc-num">{pcLabel(pc)}</span>
          </div>
          <div className="who-actions">
            <button
              type="button"
              className={`act-btn${hand ? ' active' : ''}`}
              aria-pressed={!!hand}
              onClick={hand ? lower : raise}
            >
              <Icon name="hand" /> {hand ? 'Опустити руку' : 'Підняти руку'}
            </button>
            {canFinish && (
              <button
                type="button"
                className={`act-btn act-done${finished ? ' active' : ''}`}
                aria-pressed={finished}
                onClick={toggleDone}
              >
                <Icon name={finished ? 'check' : 'flag'} />{' '}
                {finished ? 'Закінчив(ла)' : 'Я закінчив(ла)'}
              </button>
            )}
          </div>
          <div className="who-name">
            <span className="who-name-text">{who.name}</span>
            <button type="button" className="link-btn who-not-me" onClick={onNotMe}>
              це не я
            </button>
          </div>
        </header>
        <div className="task-area" aria-live="polite">
          {!task ? (
            <p className="waiting">
              <span className="pulse-dot" aria-hidden="true" /> Чекаємо на завдання
            </p>
          ) : (
            <TaskCard key={key} task={task} who={who} pcId={id} card={card} onOpened={markOpened} />
          )}
        </div>
      </div>
      <TimerBar room={room} />
      {locked && (
        <div className="lock" role="alert">
          <div className="eyes" aria-hidden="true">
            <span className="eye">
              <span className="pupil" />
            </span>
            <span className="eye">
              <span className="pupil" />
            </span>
          </div>
          <p className="lock-text">Дивимось на дошку</p>
        </div>
      )}
      {showBar && (
        <div className="offline-bar" role="alert">
          Немає зв’язку…
        </div>
      )}
    </>
  );
}

function TaskCard({
  task,
  who,
  pcId,
  card,
  onOpened,
}: {
  task: LessonTask;
  who: Who;
  pcId: string;
  card: Record<string, unknown>;
  onOpened: (t: LessonTask) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [testStarted, setTestStarted] = useState(false);

  // A message counts as seen once shown.
  useEffect(() => {
    if (task.type === 'message') onOpened(task);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (task.type === 'test' && (testStarted || store.get('testDone', null) === task.sentAt)) {
    return (
      <Suspense fallback={<Spinner />}>
        <LessonTest task={task} who={who} pcId={pcId} card={card} onOpened={() => onOpened(task)} />
      </Suspense>
    );
  }

  const kind = (
    <p className="task-kind">
      <Icon name={task.type} /> {TYPE_LABELS[task.type]}
    </p>
  );

  if (task.type === 'link') {
    const url = safeUrl(task.url);
    const domain = url ? domainOf(url) : '';
    const title = task.title || domain || 'Посилання';
    return (
      <section className="lesson-card" data-type="link" data-testid="task-card">
        {kind}
        <h2 className="task-title">{title}</h2>
        {domain && domain !== title && <p className="task-domain">{domain}</p>}
        {url ? (
          <button
            type="button"
            className="btn btn-sun btn-huge"
            onClick={() => {
              window.open(url, '_blank', 'noopener');
              setOpened(true);
              onOpened(task);
            }}
          >
            Відкрити <Icon name="arrow" />
          </button>
        ) : (
          <p className="alert alert-error">Посилання некоректне. Скажи вчителю.</p>
        )}
        {opened && (
          <p className="task-note">
            <Icon name="check" /> Відкрито в новій вкладці
          </p>
        )}
      </section>
    );
  }

  if (task.type === 'message') {
    return (
      <section className="lesson-card" data-type="message" data-testid="task-card">
        {kind}
        <p className="task-message">{task.text}</p>
      </section>
    );
  }

  const draft = store.get<{ sentAt: number } | null>('testDraft', null);
  return (
    <section className="lesson-card" data-type="test" data-testid="task-card">
      {kind}
      <h2 className="task-title">{task.title || 'Тест'}</h2>
      {task.count ? <p className="task-domain">{questionsLabel(task.count)}</p> : null}
      <button type="button" className="btn btn-sun btn-huge" onClick={() => setTestStarted(true)}>
        {draft?.sentAt === task.sentAt ? 'Продовжити тест' : 'Почати тест'}
      </button>
    </section>
  );
}

/**
 * The timer on screens: the rest is computed by server time, not by this PC's
 * clock. Until the clock is synced the full duration is shown (a PC whose clock
 * is hours off would otherwise flash «Час вийшов!»).
 */
function TimerBar({ room }: { room: RoomDoc }) {
  const t = room.timer && room.timer.id ? room.timer : null;
  const ready = useClockReady();
  const timer = t
    ? { id: t.id, durationMs: t.durationMs, startedAt: t.startedAt?.toMillis() ?? 0 }
    : null;
  const [, tick] = useState(0);
  const left = ready ? timerLeft(timer, serverNow()) : null;
  const ended = useRef<number | null>(null);

  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer?.id]);

  useEffect(() => {
    if (timer && left !== null && left <= 0 && ended.current !== timer.id) {
      ended.current = timer.id;
      blinkTitle('(!) Час вийшов');
    }
  });

  if (!timer) return null;
  const cls =
    left !== null && left <= 0
      ? ' timer-done'
      : left !== null && left <= 10_000
        ? ' timer-soon'
        : '';
  return (
    <div className={`timer${cls}`} role="timer" aria-label="Таймер" data-testid="timer">
      <Icon name="clock" />
      <span className="timer-value">
        {left === null
          ? durationText(timer.durationMs)
          : left > 0
            ? durationText(left)
            : 'Час вийшов!'}
      </span>
    </div>
  );
}
