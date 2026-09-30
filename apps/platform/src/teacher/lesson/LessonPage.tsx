import { useEffect, useState } from 'react';
import { collection } from 'firebase/firestore';
import { db } from '../../firebase/app';
import { useUser } from '../../firebase/auth';
import { syncClock } from '../../firebase/clock';
import { errorText } from '../../firebase/errors';
import { useDoc, useQuery } from '../../firebase/watch';
import type { ClassDoc } from '../../data/classes';
import {
  ROOM_ID,
  endLesson,
  roomRef,
  setLocked,
  setTheme,
  startLesson,
  type RoomDoc,
  type Theme,
} from '../../data/room';
import { useConfirm } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { ErrorText, Spinner } from '../../components/Modal';
import { NowPanel } from './NowPanel';
import { PcGrid } from './PcGrid';
import { LessonResults } from './LessonResults';
import { SendPanel } from './SendPanel';
import { TimerPanel } from './TimerPanel';
import { usePcs } from './usePcs';

/**
 * «Урок»: the Клас-пульт console. Left: class, send, on screens, timer.
 * Right: PC cards and results of the last test. One lab (rooms/lab).
 */
export function LessonPage() {
  const { user } = useUser();
  const room = useDoc<RoomDoc>(roomRef());
  const pcs = usePcs();
  const [selected, setSelected] = useState<string[]>([]);
  // Клас-пульт also worked without a class (guests only): one tap away.
  const [withoutClass, setWithoutClass] = useState(false);

  // Server time for the timer panel (school laptops' clocks drift too).
  useEffect(() => {
    if (user) syncClock(user.uid).catch(() => {});
  }, [user]);

  // Selected cards that disappeared (new class) are dropped.
  const ids = pcs.pcs.map((p) => p.id).join(',');
  useEffect(() => {
    setSelected((cur) => cur.filter((id) => ids.split(',').includes(id)));
  }, [ids]);

  if (room.loading) return <Spinner />;
  const r: RoomDoc = room.data ?? {};
  const locked = r.locked === true;

  // Before the lesson: one card — choose the class and start.
  if (!r.classId && !withoutClass) {
    return (
      <main className="page lesson" data-room={ROOM_ID}>
        <h1>Урок</h1>
        <ErrorText error={room.error ?? pcs.error} />
        <StartCard room={r} onWithoutClass={() => setWithoutClass(true)} />
      </main>
    );
  }

  return (
    <main className={`page lesson${locked ? ' is-locked' : ''}`} data-room={ROOM_ID}>
      <section className="panel panel-class lesson-top">
        <div className="lesson-top-row">
          <h1 className="lesson-h1">Урок</h1>
          <p data-testid="lesson-class" className="lesson-now">
            Зараз урок: <strong>{r.classId ? r.className : 'не обрано'}</strong>
          </p>
          <div className="row lesson-top-tools">
            <ThemeSwitch theme={r.theme === 'senior' ? 'senior' : 'junior'} />
            <label className={`lock-toggle${locked ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={locked}
                onChange={(e) => void setLocked(e.target.checked).catch(() => {})}
              />
              <Icon name="lock" /> Заблокувати екрани
            </label>
          </div>
        </div>
        <ClassSwitch room={r} onEnded={() => setWithoutClass(false)} />
      </section>
      <ErrorText error={room.error ?? pcs.error} />
      <div className="lesson-grid">
        <div className="col">
          <SendPanel room={r} selected={selected} onClearSelected={() => setSelected([])} />
          <NowPanel room={r} pcs={pcs.pcs} />
          <TimerPanel room={r} />
        </div>
        <div className="col">
          <PcGrid
            room={r}
            pcs={pcs.pcs}
            skew={pcs.skew}
            selected={selected}
            onSelect={setSelected}
          />
          <LessonResults room={r} pcs={pcs.pcs} />
        </div>
      </div>
    </main>
  );
}

function ThemeSwitch({ theme }: { theme: Theme }) {
  const options: [Theme, string][] = [
    ['junior', 'Молодші'],
    ['senior', 'Старші'],
  ];
  return (
    <div className="seg seg-sm" role="radiogroup" aria-label="Вигляд сторінки учнів">
      <span className="seg-label">Учні:</span>
      {options.map(([t, label]) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          className="seg-btn"
          onClick={() => void setTheme(t).catch(() => {})}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Starting and ending a lesson (Клас-пульт's «Новий клас»). */
function useLessonControl(room: RoomDoc) {
  const confirm = useConfirm();
  const classes = useQuery<ClassDoc>(collection(db, 'classes'), 'classes');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const list = [...classes.docs].sort((a, b) => a.data.name.localeCompare(b.data.name, 'uk'));

  const start = async (choice: string) => {
    const cls = list.find((c) => c.id === choice);
    if (!cls) return false;
    const ok = await confirm({
      title: `Почати урок: ${cls.data.name}?`,
      text: room.classId
        ? 'Комп’ютери попереднього класу вийдуть, картки зникнуть з пульта, завдання й таймер буде прибрано. ' +
          'Номери комп’ютерів збережуться.'
        : 'На комп’ютерах учнів з’явиться список класу: кожен обирає своє ім’я і вводить пароль.',
      ok: 'Почати урок',
    });
    if (!ok) return false;
    setBusy(true);
    setResult(null);
    try {
      await startLesson({ id: cls.id, name: cls.data.name, grade: cls.data.grade }, room);
      setResult({ text: `Урок ${cls.data.name}: учні входять зі списку класу.`, ok: true });
      return true;
    } catch (err) {
      setResult({ text: errorText(err), ok: false });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    const ok = await confirm({
      title: 'Завершити урок?',
      text: 'Комп’ютери класу вийдуть, картки зникнуть з пульта, завдання й таймер буде прибрано.',
      ok: 'Завершити урок',
    });
    if (!ok) return false;
    setBusy(true);
    setResult(null);
    try {
      await endLesson(room);
      setResult({ text: 'Урок завершено.', ok: true });
      return true;
    } catch (err) {
      setResult({ text: errorText(err), ok: false });
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { list, loading: classes.loading, busy, result, start, end };
}

const studentAddress = () => window.location.host;

/** Before the lesson: what happens, the class, one big button. */
function StartCard({ room, onWithoutClass }: { room: RoomDoc; onWithoutClass: () => void }) {
  const { list, loading, busy, result, start } = useLessonControl(room);
  const [choice, setChoice] = useState('');
  return (
    <section className="card panel-class start-card">
      <p data-testid="lesson-class" className="muted">
        Зараз урок: <strong>не обрано</strong>
      </p>
      <h2 className="start-title">Почніть урок у комп’ютерному класі</h2>
      <ol className="start-steps">
        <li>Оберіть клас і натисніть «Почати урок».</li>
        <li>
          На комп’ютерах учнів відкрийте <b>{studentAddress()}</b> — там з’явиться список класу.
        </li>
        <li>Надсилайте посилання, тест чи повідомлення: вони з’являться на екранах одразу.</li>
      </ol>
      <div className="start-row">
        <select
          className="input input-lg"
          aria-label="Новий клас"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="">
            {loading ? 'Завантажую…' : list.length ? 'Оберіть клас…' : 'Спочатку створіть клас'}
          </option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.data.name}
            </option>
          ))}
        </select>
        <button
          className="btn btn-lg"
          disabled={!choice || busy}
          onClick={() => void start(choice).then((ok) => ok && setChoice(''))}
        >
          <Icon name="play" /> Почати урок
        </button>
      </div>
      {result && !result.ok && <p className="alert alert-error">{result.text}</p>}
      <button type="button" className="btn btn-ghost btn-sm start-guests" onClick={onWithoutClass}>
        Відкрити пульт без класу (лише гості за номером ПК)
      </button>
    </section>
  );
}

/** During the lesson: another class («Новий клас») or the end. */
function ClassSwitch({ room, onEnded }: { room: RoomDoc; onEnded: () => void }) {
  const { list, busy, result, start, end } = useLessonControl(room);
  const [choice, setChoice] = useState('');
  return (
    <div className="lesson-switch">
      <span className="small muted">
        Учні відкривають <b>{studentAddress()}</b>
      </span>
      <div className="row lesson-switch-row">
        <select
          className="input input-sm"
          aria-label="Новий клас"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="">Інший клас…</option>
          {list
            .filter((c) => c.id !== room.classId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.data.name}
              </option>
            ))}
        </select>
        <button
          className="btn btn-secondary btn-sm"
          disabled={!choice || busy}
          onClick={() => void start(choice).then((ok) => ok && setChoice(''))}
        >
          Почати урок
        </button>
        <button
          className="btn btn-danger-ghost btn-sm"
          disabled={busy}
          onClick={() => void end().then((ok) => ok && onEnded())}
        >
          Завершити урок
        </button>
      </div>
      {result && (
        <p className={result.ok ? 'send-result ok' : 'alert alert-error'} role="status">
          {result.text}
        </p>
      )}
    </div>
  );
}
