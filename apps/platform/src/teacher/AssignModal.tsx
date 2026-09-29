import { useState, type FormEvent } from 'react';
import { collection } from 'firebase/firestore';
import { db } from '../firebase/app';
import { errorText } from '../firebase/errors';
import { useQuery } from '../firebase/watch';
import type { ClassDoc } from '../data/classes';
import {
  REVEAL_LABELS,
  assignmentsCol,
  createAssignment,
  type AssignmentDoc,
  type Reveal,
} from '../data/assignments';
import { NO_FOLDER, quizzesCol, type QuizDoc } from '../data/quizzes';
import { ErrorText, Modal } from '../components/Modal';
import { fromLocalInput, questionsLabel } from '../lib/text';
import { ShareBox } from './ShareBox';

type Doc<T> = { id: string; data: T };

export const ATTEMPT_CHOICES: [string, string][] = [
  ['1', '1 спроба'],
  ['2', '2 спроби'],
  ['3', '3 спроби'],
  ['', 'Без обмежень (зараховується найкраща)'],
];

export function byFolder<T extends { data: { folder: string; title: string } }>(list: T[]) {
  const groups = new Map<string, T[]>();
  for (const q of [...list].sort((a, b) => a.data.title.localeCompare(b.data.title, 'uk'))) {
    const name = q.data.folder || NO_FOLDER;
    groups.set(name, [...(groups.get(name) ?? []), q]);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === NO_FOLDER ? 1 : b === NO_FOLDER ? -1 : a.localeCompare(b, 'uk'),
  );
}

/**
 * «Дати завдання»: from the bank (the test is fixed, pick a class) or from a class
 * page (the class is fixed, pick a test). Shows the link for Classroom afterwards.
 */
export function AssignModal({
  classId: fixedClassId,
  quizId: fixedQuizId,
  onClose,
}: {
  classId?: string;
  quizId?: string;
  onClose: () => void;
}) {
  const classes = useQuery<ClassDoc>(collection(db, 'classes'), 'classes');
  const quizzes = useQuery<QuizDoc>(quizzesCol(), 'quizzes');
  const given = useQuery<AssignmentDoc>(assignmentsCol(), 'assignments');
  const [classId, setClassId] = useState(fixedClassId ?? '');
  const [quizId, setQuizId] = useState(fixedQuizId ?? '');
  const [due, setDue] = useState('');
  const [attempts, setAttempts] = useState('1');
  const [reveal, setReveal] = useState<Reveal>('immediate');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);

  const cls = classes.docs.find((c) => c.id === classId);
  const quiz = quizzes.docs.find((q) => q.id === quizId);
  const givenTo = (qid: string, cid: string) =>
    given.docs.some((a) => a.data.quizId === qid && a.data.classId === cid);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cls || !quiz) return setError('Оберіть клас і тест');
    const dueAt = fromLocalInput(due);
    if (dueAt && dueAt.getTime() < Date.now()) return setError('Термін уже минув');
    if (reveal === 'after_due' && !dueAt) {
      return setError('Щоб показати розбір після терміну, вкажіть термін');
    }
    setBusy(true);
    setError(null);
    try {
      const id = await createAssignment({
        classId: cls.id,
        quizId: quiz.id,
        title: quiz.data.title,
        questions: quiz.data.questions,
        dueAt,
        maxAttempts: attempts ? Number(attempts) : null,
        reveal,
      });
      setCreated({ id, title: quiz.data.title });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (created && cls) {
    return (
      <Modal title="Завдання видано" onClose={onClose}>
        <p>
          Учні класу {cls.data.name} уже бачать «{created.title}» на своїй сторінці. Для
          онлайн-уроку або Google Classroom надішліть посилання:
        </p>
        <ShareBox joinCode={cls.data.joinCode} assignmentId={created.id} title={created.title} />
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Готово
          </button>
        </div>
      </Modal>
    );
  }

  const classList = [...classes.docs].sort((a, b) => a.data.name.localeCompare(b.data.name, 'uk'));

  return (
    <Modal title="Дати завдання" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!fixedClassId && (
          <label className="field">
            <span>Клас</span>
            <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Оберіть клас…</option>
              {classList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.data.name}
                  {quizId && givenTo(quizId, c.id) ? ' — вже давали' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {!fixedQuizId && (
          <label className="field">
            <span>Тест</span>
            <select className="input" value={quizId} onChange={(e) => setQuizId(e.target.value)}>
              <option value="">
                {quizzes.docs.length ? 'Оберіть тест…' : 'У банку ще немає тестів'}
              </option>
              {byFolder(quizzes.docs as Doc<QuizDoc>[]).map(([folder, list]) => (
                <optgroup key={folder} label={folder}>
                  {list.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.data.title} ({questionsLabel(q.data.questions.length)})
                      {classId && givenTo(q.id, classId) ? ' — вже давали цьому класу' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {fixedQuizId && quiz && (
          <p className="muted">
            Тест «{quiz.data.title}», {questionsLabel(quiz.data.questions.length)}
          </p>
        )}
        <label className="field">
          <span>Виконати до</span>
          <input
            className="input"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <small className="hint">Необов'язково. Після цього часу відповіді не приймаються.</small>
        </label>
        <label className="field">
          <span>Кількість спроб</span>
          <select className="input" value={attempts} onChange={(e) => setAttempts(e.target.value)}>
            {ATTEMPT_CHOICES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Правильні відповіді учням</span>
          <select
            className="input"
            value={reveal}
            onChange={(e) => setReveal(e.target.value as Reveal)}
          >
            {(Object.keys(REVEAL_LABELS) as Reveal[]).map((r) => (
              <option key={r} value={r}>
                {REVEAL_LABELS[r]}
              </option>
            ))}
          </select>
          <small className="hint">
            Якщо спроб кілька, «одразу» підкаже відповіді до наступної спроби.
          </small>
        </label>
        <ErrorText error={error ?? classes.error ?? quizzes.error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn" disabled={busy || !classId || !quizId}>
            Видати завдання
          </button>
        </div>
      </form>
    </Modal>
  );
}
