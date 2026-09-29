import { useEffect, useState } from 'react';
import { getDoc } from 'firebase/firestore';
import { gradeAnswers, type AnswerMap, type Question } from '@infoklas/shared/grading';
import type { LessonTask } from '@infoklas/shared/lesson';
import { errorText, isPermissionDenied } from '../firebase/errors';
import { useDoc } from '../firebase/watch';
import {
  assignmentRef,
  keyRef,
  submissionRef,
  type AssignmentDoc,
  type KeyDoc,
} from '../data/assignments';
import { submitGuestLesson, submitStudentLesson } from '../data/room';
import { useConfirm } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { ErrorText, Spinner } from '../components/Modal';
import { countWrite } from '../lib/metrics';
import { store } from '../lib/storage';
import { QuestionInput, hasAnswer } from './Homework';
import type { Who } from './LessonScreen';

// Тест на уроке (Клас-пульт: все вопросы на одной странице, «Без відповіді: N»,
// черновик в браузере, «Відповіді надіслано», разбор по «Показати учням
// результати»). Ученик из списка сдаёт в submissions (журнал), гость — в guestResults.

interface Saved {
  sentAt: number;
  answers: AnswerMap;
}

export default function LessonTest({
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
  onOpened: () => void;
}) {
  const a = useDoc<AssignmentDoc>(task.assignmentId ? assignmentRef(task.assignmentId) : null);
  const [done, setDone] = useState(() => store.get('testDone', null) === task.sentAt);

  useEffect(() => {
    if (!done && a.data) onOpened();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!a.data]);

  if (a.loading) return <Spinner />;
  if (!a.data) {
    return (
      <section className="lesson-card" data-type="test">
        <h2 className="task-title">{task.title || 'Тест'}</h2>
        <p className="alert alert-error">Тест не знайдено. Скажи вчителю.</p>
      </section>
    );
  }
  if (done) return <DoneCard task={task} a={a.data} />;
  return (
    <Sheet task={task} a={a.data} who={who} pcId={pcId} card={card} onDone={() => setDone(true)} />
  );
}

function Sheet({
  task,
  a,
  who,
  pcId,
  card,
  onDone,
}: {
  task: LessonTask;
  a: AssignmentDoc;
  who: Who;
  pcId: string;
  card: Record<string, unknown>;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const [answers, setAnswers] = useState<AnswerMap>(() => {
    const d = store.get<Saved | null>('testDraft', null);
    return d && d.sentAt === task.sentAt ? d.answers : {};
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    store.set('testDraft', { sentAt: task.sentAt, answers });
  }, [task.sentAt, answers]);

  const missing = a.questions.filter((q) => !hasAnswer(answers[q.id])).length;

  const finish = () => {
    store.set('testDone', task.sentAt);
    store.set('testAnswers', { sentAt: task.sentAt, answers });
    store.remove('testDraft');
    window.scrollTo(0, 0);
    onDone();
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    setStatus('Надсилаю…');
    const slow = setTimeout(
      () =>
        setStatus(
          'Немає зв’язку. Відповіді надішлються, щойно з’явиться інтернет. Не закривай сторінку.',
        ),
      5000,
    );
    const doneCard = { ...card, submittedAt: task.sentAt };
    try {
      countWrite(2);
      if (who.studentId && who.classId) {
        await submitStudentLesson({
          assignmentId: task.assignmentId!,
          classId: who.classId,
          studentId: who.studentId,
          pcId,
          answers,
          card: doneCard,
        });
      } else {
        await submitGuestLesson({
          assignmentId: task.assignmentId!,
          pcId,
          name: who.name,
          answers,
          card: doneCard,
        });
      }
      finish();
    } catch (err) {
      // A pupil who already submitted this test (e.g. on another PC) just sees «надіслано».
      if (isPermissionDenied(err) && who.studentId) {
        const mine = await getDoc(submissionRef(task.assignmentId!, who.studentId, 1)).catch(
          () => null,
        );
        if (mine?.exists()) {
          finish();
          return;
        }
      }
      setError(errorText(err));
      setStatus(null);
    } finally {
      clearTimeout(slow);
      setBusy(false);
    }
  };

  const submit = async () => {
    if (
      missing &&
      !(await confirm({
        title: 'Ти відповів(ла) не на всі питання',
        text: `Без відповіді: ${missing}. Надіслати відповіді?`,
        ok: 'Надіслати',
        cancel: 'Повернутися до тесту',
      }))
    ) {
      return;
    }
    await send();
  };

  return (
    <section className="lesson-card test-sheet" data-type="test" data-testid="test-sheet">
      <p className="task-kind">
        <Icon name="test" /> Тест
      </p>
      <h2 className="task-title">{a.title}</h2>
      {a.questions.map((q, i) => (
        <fieldset key={q.id} className="sheet-question">
          <legend className="question-prompt">
            <span className="question-num">{i + 1}.</span> {q.prompt}
          </legend>
          <QuestionInput
            question={q}
            value={answers[q.id]}
            onChange={(v) => setAnswers((cur) => ({ ...cur, [q.id]: v }))}
            onEnter={() => {}}
          />
        </fieldset>
      ))}
      <div className="test-footer">
        <p className="strong" data-testid="test-left">
          Без відповіді: {missing}
        </p>
        <button
          type="button"
          className="btn btn-sun btn-lg"
          disabled={busy}
          onClick={() => void submit()}
        >
          Надіслати відповіді
        </button>
      </div>
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
      <ErrorText error={error} />
    </section>
  );
}

/** «Відповіді надіслано» + the review while the teacher shows results. */
function DoneCard({ task, a }: { task: LessonTask; a: AssignmentDoc }) {
  const [key, setKey] = useState<Question[] | null>(null);
  const reveal = a.revealNow === true;

  useEffect(() => {
    if (!reveal || !task.assignmentId) return setKey(null);
    let cancelled = false;
    getDoc(keyRef(task.assignmentId)).then(
      (snap) => !cancelled && setKey((snap.data() as KeyDoc | undefined)?.questions ?? null),
      () => !cancelled && setKey(null),
    );
    return () => {
      cancelled = true;
    };
  }, [reveal, task.assignmentId]);

  const saved = store.get<Saved | null>('testAnswers', null);
  const own = saved && saved.sentAt === task.sentAt ? saved.answers : null;
  const graded = key && own ? gradeAnswers(key, own) : null;

  return (
    <section className="lesson-card" data-type="test" data-testid="test-done">
      <span className="done-check" aria-hidden="true">
        <Icon name="check" size={40} />
      </span>
      <h2 className="task-title">Відповіді надіслано</h2>
      <p className="task-domain">{a.title} · Чекай на наступне завдання.</p>
      {key && (
        <div className="review-box" data-testid="lesson-review">
          <p className="review-score">
            {graded
              ? `Твій результат: ${graded.correctCount} з ${graded.total}`
              : 'Правильні відповіді'}
          </p>
          <ol className="review">
            {key.map((q, i) => {
              const ok = graded?.perQuestion[i]?.correct;
              const right =
                q.type === 'text'
                  ? q.acceptedAnswers[0]
                  : q.options
                      .filter((o) =>
                        q.type === 'single'
                          ? o.id === q.correctOptionId
                          : q.correctOptionIds.includes(o.id),
                      )
                      .map((o) => o.text)
                      .join(', ');
              return (
                <li key={q.id} className={ok === undefined ? '' : ok ? 'review-ok' : 'review-bad'}>
                  <span className="review-icon" aria-label={ok ? 'правильно' : 'неправильно'}>
                    <Icon name={ok === false ? 'cross' : 'check'} />
                  </span>
                  <div>
                    <p className="strong pre">
                      {i + 1}. {q.prompt}
                    </p>
                    <p className="small answer-ok">Правильна відповідь: {right}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
