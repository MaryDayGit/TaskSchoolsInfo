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

  return (
    <main className={`page lesson${locked ? ' is-locked' : ''}`} data-room={ROOM_ID}>
      <div className="page-header lesson-head">
        <h1>Урок</h1>
        <div className="row">
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
      <ErrorText error={room.error ?? pcs.error} />
      <div className="lesson-grid">
        <div className="col">
          <ClassPanel room={r} />
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

/** «Зараз урок»: choosing another class is Клас-пульт's «Новий клас». */
function ClassPanel({ room }: { room: RoomDoc }) {
  const confirm = useConfirm();
  const classes = useQuery<ClassDoc>(collection(db, 'classes'), 'classes');
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const list = [...classes.docs].sort((a, b) => a.data.name.localeCompare(b.data.name, 'uk'));
  const current = list.find((c) => c.id === room.classId);
  const studentUrl = `${window.location.origin}/`;

  const start = async () => {
    const cls = list.find((c) => c.id === choice);
    if (!cls) return;
    const ok = await confirm({
      title: `Почати урок: ${cls.data.name}?`,
      text:
        'Комп’ютери попереднього класу вийдуть, картки зникнуть з пульта, завдання й таймер буде прибрано. ' +
        'Номери комп’ютерів збережуться.',
      ok: 'Почати урок',
    });
    if (!ok) return;
    setBusy(true);
    setResult(null);
    try {
      await startLesson({ id: cls.id, name: cls.data.name, grade: cls.data.grade }, room);
      setChoice('');
      setResult({ text: `Урок ${cls.data.name}: учні входять зі списку класу.`, ok: true });
    } catch (err) {
      setResult({ text: errorText(err), ok: false });
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
    if (!ok) return;
    setBusy(true);
    setResult(null);
    try {
      await endLesson(room);
      setResult({ text: 'Урок завершено.', ok: true });
    } catch (err) {
      setResult({ text: errorText(err), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel panel-class">
      <h2 className="panel-title">Клас</h2>
      <p data-testid="lesson-class">
        Зараз урок:{' '}
        <strong>{current ? current.data.name : room.classId ? room.className : 'не обрано'}</strong>
      </p>
      <div className="row">
        <select
          className="input grow"
          aria-label="Новий клас"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="">{list.length ? 'Оберіть клас…' : 'Спочатку створіть клас'}</option>
          {list
            .filter((c) => c.id !== room.classId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.data.name}
              </option>
            ))}
        </select>
        <button className="btn btn-sm" disabled={!choice || busy} onClick={() => void start()}>
          Почати урок
        </button>
      </div>
      {room.classId && (
        <div>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void end()}>
            Завершити урок
          </button>
        </div>
      )}
      <label className="field">
        <span className="small muted">Адреса сторінки учня</span>
        <input className="input" readOnly value={studentUrl} onFocus={(e) => e.target.select()} />
      </label>
      {result && (
        <p className={result.ok ? 'send-result ok' : 'alert alert-error'} role="status">
          {result.text}
        </p>
      )}
    </section>
  );
}
