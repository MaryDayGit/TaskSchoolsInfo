import { useState } from 'react';
import {
  TYPE_LABELS,
  progress,
  safeUrl,
  domainOf,
  targetText,
  type PcCard,
} from '@infoklas/shared/lesson';
import { errorText } from '../../firebase/errors';
import { useDoc } from '../../firebase/watch';
import { assignmentRef, keyRef, type AssignmentDoc, type KeyDoc } from '../../data/assignments';
import { clearScreens, setReveal, type RoomDoc } from '../../data/room';
import { Icon } from '../../components/Icon';
import { ErrorText } from '../../components/Modal';
import { AnswerKey } from '../QuizzesPage';

const timeText = (ms: number) =>
  `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`;

/** «Зараз на екранах»: what pupils see, progress, review and answers for a test. */
export function NowPanel({ room, pcs }: { room: RoomDoc; pcs: PcCard[] }) {
  const [error, setError] = useState<string | null>(null);
  const task = room.task;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  };

  let main = null;
  if (task?.type === 'link') {
    const url = safeUrl(task.url);
    main = (
      <>
        <p className="now-title">{task.title || (url ? domainOf(url) : 'Посилання')}</p>
        {url && (
          <a className="now-url" href={url} target="_blank" rel="noopener noreferrer">
            {url}
          </a>
        )}
      </>
    );
  } else if (task?.type === 'message') {
    main = <p className="now-text pre">{task.text}</p>;
  } else if (task?.type === 'test') {
    main = <p className="now-title">{task.title || 'Тест'}</p>;
  }

  const prog = task ? progress(pcs, task) : null;

  return (
    <section className="panel panel-now" data-testid="now-panel">
      <h2 className="panel-title">Зараз на екранах</h2>
      {room.locked && (
        <p className="now-locked">Екрани заблоковано: учні бачать «Дивимось на дошку».</p>
      )}
      {!task ? (
        <p className="muted">Зараз на екранах нічого немає.</p>
      ) : (
        <>
          <p className="now-kind">
            <Icon name={task.type} /> {TYPE_LABELS[task.type]}
          </p>
          {main}
          <p className="small muted">
            Надіслано о {timeText(task.sentAt)} · Кому: {targetText(task.target)}
          </p>
          {prog && (
            <div className="stack stack-sm" data-testid="progress">
              <ProgressRow label="Відкрили" count={prog.opened} total={prog.total} />
              <ProgressRow label={prog.second.label} count={prog.second.count} total={prog.total} />
            </div>
          )}
          {task.type === 'test' && task.assignmentId && (
            <TestExtras assignmentId={task.assignmentId} run={run} />
          )}
        </>
      )}
      <ErrorText error={error} />
      <div className="row">
        <button
          className="btn btn-secondary btn-sm"
          disabled={!task}
          onClick={() => void run(() => clearScreens(room))}
        >
          Прибрати з екранів
        </button>
      </div>
    </section>
  );
}

function ProgressRow({ label, count, total }: { label: string; count: number; total: number }) {
  const percent = total > 0 ? Math.round((count * 100) / total) : 0;
  return (
    <div className="progress-row">
      <p className="small">
        {label}: {count} з {total}
      </p>
      <div className="progress" aria-hidden="true">
        <div style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function TestExtras({
  assignmentId,
  run,
}: {
  assignmentId: string;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const a = useDoc<AssignmentDoc>(assignmentRef(assignmentId));
  const key = useDoc<KeyDoc>(keyRef(assignmentId));
  const revealed = a.data?.revealNow === true;
  return (
    <div className="stack stack-sm">
      <div className="row">
        <button
          type="button"
          className={`btn btn-sm${revealed ? ' btn-on' : ' btn-secondary'}`}
          disabled={!a.data}
          onClick={() => void run(() => setReveal(assignmentId, !revealed))}
        >
          <Icon name={revealed ? 'cross' : 'check'} />
          {revealed ? 'Сховати результати від учнів' : 'Показати учням результати'}
        </button>
      </div>
      <p className="hint">
        {revealed
          ? 'Учні, які здали тест, бачать свій бал і правильні відповіді.'
          : 'Краще після того, як усі здадуть: учні побачать свій бал і правильні відповіді.'}
      </p>
      <details className="answers-peek">
        <summary>
          <Icon name="key" /> Правильні відповіді
        </summary>
        {key.data ? (
          <AnswerKey questions={key.data.questions} />
        ) : (
          <p className="muted">Завантажую…</p>
        )}
      </details>
    </div>
  );
}
