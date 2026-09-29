import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  LINK_TITLE_MAX,
  MESSAGE_MAX,
  TYPE_LABELS,
  domainOf,
  normalizeUrl,
  safeUrl,
  type LessonTask,
  type TaskType,
} from '@infoklas/shared/lesson';
import { errorText } from '../../firebase/errors';
import { useQuery } from '../../firebase/watch';
import { assignmentsCol, type AssignmentDoc } from '../../data/assignments';
import { quizzesCol, type QuizDoc } from '../../data/quizzes';
import { ensureLessonAssignment, sendTask, type RoomDoc } from '../../data/room';
import { Icon } from '../../components/Icon';
import { store } from '../../lib/storage';
import { clean, questionsLabel } from '../../lib/text';
import { byFolder } from '../AssignModal';

const RECENT_MAX = 8;
/** Without internet the write waits in the queue; say so after this long. */
const SEND_TIMEOUT_MS = 10_000;

interface Recent {
  url: string;
  title: string;
}

const recentLinks = (): Recent[] =>
  store
    .get<Recent[]>('recentLinks', [])
    .filter((x) => x && typeof x.url === 'string' && safeUrl(x.url));

const timeText = (ms: number) =>
  `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`;

/** «Надіслати учням»: link, test or message; to everyone or to the selected PCs. */
export function SendPanel({
  room,
  selected,
  onClearSelected,
}: {
  room: RoomDoc;
  selected: string[];
  onClearSelected: () => void;
}) {
  const quizzes = useQuery<QuizDoc>(quizzesCol(), 'quizzes');
  const given = useQuery<AssignmentDoc>(assignmentsCol(), 'assignments');
  const [type, setType] = useState<TaskType>(() => store.get<TaskType>('sendType', 'link'));
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [quizId, setQuizId] = useState('');
  const [reveal, setReveal] = useState(false);
  const [toSelected, setToSelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const [recent, setRecent] = useState<Recent[]>(recentLinks);

  // Clicking cards switches «Кому» to the selected PCs; an empty choice goes back to all.
  const count = useRef(0);
  useEffect(() => {
    if (selected.length > count.current) setToSelected(true);
    if (!selected.length) setToSelected(false);
    count.current = selected.length;
  }, [selected.length]);

  const target = toSelected && selected.length ? [...selected].sort() : null;
  const givenHere = (qid: string) =>
    given.docs.some((a) => a.data.quizId === qid && a.data.classId === room.classId);

  const choose = (t: TaskType) => {
    setType(t);
    store.set('sendType', t);
    setResult(null);
  };

  const build = (): LessonTask | string => {
    const task: LessonTask = { type, sentAt: Date.now(), target };
    if (type === 'link') {
      const u = normalizeUrl(url);
      if (!u) return 'Перевірте адресу: потрібне посилання на сайт, наприклад learningapps.org/…';
      task.url = u;
      task.title = clean(title, LINK_TITLE_MAX);
    } else if (type === 'message') {
      const t = text
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MESSAGE_MAX);
      if (!t) return 'Напишіть текст повідомлення.';
      task.text = t;
    } else {
      if (!room.classId) return 'Спочатку оберіть клас уроку: результати тесту йдуть у журнал.';
      if (!quizId)
        return quizzes.docs.length ? 'Оберіть тест.' : 'Спочатку створіть тест у «Банку тестів».';
    }
    return task;
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const task = build();
    if (typeof task === 'string') return setResult({ text: task, ok: false });
    setBusy(true);
    setResult({ text: 'Надсилаю…', ok: true });
    const slow = setTimeout(() => {
      setBusy(false);
      setResult({
        text: 'Немає зв’язку з сервером. Завдання надішлеться, щойно з’явиться інтернет.',
        ok: false,
      });
    }, SEND_TIMEOUT_MS);
    try {
      if (task.type === 'test') {
        const quiz = quizzes.docs.find((q) => q.id === quizId)!;
        task.assignmentId = await ensureLessonAssignment(room, {
          id: quiz.id,
          title: quiz.data.title,
          questions: quiz.data.questions,
        });
        task.title = quiz.data.title;
        task.count = quiz.data.questions.length;
      }
      await sendTask(task, room, { reveal });
      setResult({ text: `Надіслано о ${timeText(task.sentAt)}`, ok: true });
      if (task.type === 'link' && task.url) {
        const list = [
          { url: task.url, title: task.title ?? '' },
          ...recent.filter((x) => x.url !== task.url),
        ].slice(0, RECENT_MAX);
        store.set('recentLinks', list);
        setRecent(list);
      }
    } catch (err) {
      setResult({
        text: err instanceof Error && !('code' in err) ? err.message : errorText(err),
        ok: false,
      });
    } finally {
      clearTimeout(slow);
      setBusy(false);
    }
  };

  return (
    <form className="panel panel-send" noValidate onSubmit={send}>
      <h2 className="panel-title">Надіслати учням</h2>
      <div className="seg" role="radiogroup" aria-label="Що надіслати">
        {(['link', 'test', 'message'] as TaskType[]).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            className="seg-btn"
            onClick={() => choose(t)}
          >
            <Icon name={t} /> {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {type === 'link' && (
        <div className="stack stack-sm">
          <label className="field">
            <span>Адреса</span>
            <input
              className="input"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="наприклад, learningapps.org/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Назва (необов’язково)</span>
            <input
              className="input"
              maxLength={LINK_TITLE_MAX}
              placeholder="Як учні побачать посилання"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {recent.length > 0 && (
            <div className="chips" aria-label="Останні посилання">
              {recent.map((r) => (
                <button
                  key={r.url}
                  type="button"
                  className="chip"
                  title={r.url}
                  onClick={() => {
                    setUrl(r.url);
                    setTitle(r.title);
                    setResult(null);
                  }}
                >
                  {r.title || domainOf(r.url)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {type === 'test' && (
        <div className="stack stack-sm">
          <label className="field">
            <span>Тест</span>
            <select className="input" value={quizId} onChange={(e) => setQuizId(e.target.value)}>
              <option value="">{quizzes.docs.length ? 'Оберіть тест…' : '—'}</option>
              {byFolder(quizzes.docs).map(([folder, list]) => (
                <optgroup key={folder} label={folder}>
                  {list.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.data.title} ({questionsLabel(q.data.questions.length)})
                      {givenHere(q.id) ? ' — вже давали цьому класу' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {!quizzes.loading && !quizzes.docs.length && (
            <p className="hint">Тестів ще немає — створіть тест у «Банку тестів».</p>
          )}
          <label className="checkbox">
            <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
            Одразу після здачі показати учню бал і правильні відповіді
          </label>
        </div>
      )}

      {type === 'message' && (
        <label className="field">
          <span>Текст повідомлення</span>
          <textarea
            className="input textarea"
            rows={4}
            maxLength={MESSAGE_MAX}
            placeholder="Наприклад: Відкрийте зошити на сторінці 12"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <small className="hint">
            {text.length} / {MESSAGE_MAX}
          </small>
        </label>
      )}

      <div className="recipients" role="radiogroup" aria-label="Кому">
        <span className="strong">Кому:</span>
        <label>
          <input
            type="radio"
            name="to"
            checked={!toSelected || !selected.length}
            onChange={() => setToSelected(false)}
          />{' '}
          усім
        </label>
        <label>
          <input
            type="radio"
            name="to"
            disabled={!selected.length}
            checked={toSelected && selected.length > 0}
            onChange={() => setToSelected(true)}
          />{' '}
          вибраним ({selected.length})
        </label>
        {selected.length > 0 && (
          <button type="button" className="link-btn small" onClick={onClearSelected}>
            зняти вибір
          </button>
        )}
      </div>
      <button className="btn btn-lg btn-block" disabled={busy}>
        <Icon name="send" /> Надіслати
      </button>
      {result && (
        <p className={`send-result${result.ok ? ' ok' : ' error'}`} role="status">
          {result.text}
        </p>
      )}
    </form>
  );
}
