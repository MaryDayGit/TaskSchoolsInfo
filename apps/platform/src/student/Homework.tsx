import { useEffect, useState } from 'react';
import { getDoc } from 'firebase/firestore';
import {
  gradeAnswers,
  type AnswerMap,
  type AnswerValue,
  type PublicQuestion,
  type Question,
} from '@infoklas/shared/grading';
import { errorText, isPermissionDenied } from '../firebase/errors';
import { useDoc, useQuery } from '../firebase/watch';
import {
  assignmentRef,
  isClosed,
  keyRef,
  mySubmissionsQuery,
  submitAnswers,
  type AssignmentDoc,
  type KeyDoc,
  type SubmissionDoc,
} from '../data/assignments';
import { Icon, OptionShape } from '../components/Icon';
import { ErrorText, Spinner } from '../components/Modal';
import { canSpeak, speak } from '../lib/speech';
import { store } from '../lib/storage';
import { countLabel, formatDateTime, plural, questionsLabel } from '../lib/text';

// Выполнение домашнего задания (ІнфоКлас TakeAssignment): по одному вопросу,
// черновик в браузере, озвучка для 2–4 класса, разбор по ключу, если его можно
// прочитать (правило assignmentKeys).

type Phase = 'intro' | 'questions' | 'review' | 'result';

export function hasAnswer(v: AnswerValue | undefined): boolean {
  if (v === undefined) return false;
  return Array.isArray(v) ? v.length > 0 : v.trim().length > 0;
}

export default function Homework({
  assignmentId,
  classId,
  studentId,
  junior,
  onBack,
}: {
  assignmentId: string;
  classId: string;
  studentId: string;
  junior: boolean;
  onBack: () => void;
}) {
  const a = useDoc<AssignmentDoc>(assignmentRef(assignmentId));
  const subs = useQuery<SubmissionDoc>(
    mySubmissionsQuery(classId, assignmentId, studentId),
    `my:${assignmentId}:${studentId}`,
  );

  let body;
  if (a.loading || subs.loading) body = <Spinner />;
  else if (!a.exists || !a.data || a.data.classId !== classId) {
    body = <ErrorText error={a.error ?? 'Завдання не знайдено. Можливо, вчитель його видалив.'} />;
  } else {
    const submitted = subs.docs.map((d) => d.data).sort((x, y) => x.attempt - y.attempt);
    body = (
      <Runner
        key={assignmentId}
        id={assignmentId}
        a={a.data}
        submitted={submitted}
        classId={classId}
        studentId={studentId}
        junior={junior}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="stack homework" data-testid="homework">
      <button type="button" className="back-link link-btn" onClick={onBack}>
        ← Мої завдання
      </button>
      {body}
    </div>
  );
}

function Runner({
  id,
  a,
  submitted,
  classId,
  studentId,
  junior,
  onBack,
}: {
  id: string;
  a: AssignmentDoc;
  submitted: SubmissionDoc[];
  classId: string;
  studentId: string;
  junior: boolean;
  onBack: () => void;
}) {
  const draftKey = `draft:${studentId}:${id}`;
  const used = submitted.length ? submitted[submitted.length - 1]!.attempt : 0;
  const closed = isClosed(a);
  const canRetry = !closed && (a.maxAttempts === null || used < a.maxAttempts);
  const [phase, setPhase] = useState<Phase>(used ? 'result' : 'intro');
  const [answers, setAnswers] = useState<AnswerMap>(() => store.get<AnswerMap>(draftKey, {}));
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phase === 'questions' || phase === 'review') store.set(draftKey, answers);
  }, [draftKey, answers, phase]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitAnswers({ assignmentId: id, classId, studentId, attempt: used + 1, answers });
      store.remove(draftKey);
      setPhase('result');
    } catch (err) {
      setError(
        isPermissionDenied(err)
          ? closed || isClosed(a)
            ? 'Час на виконання минув, відповіді не прийнято.'
            : 'Не вдалося надіслати. Можливо, спроби закінчились або вчитель змінив завдання.'
          : errorText(err),
      );
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'result' && used) {
    return (
      <Result
        id={id}
        a={a}
        last={submitted[submitted.length - 1]!}
        junior={junior}
        onRetry={
          canRetry
            ? () => {
                setAnswers({});
                setIndex(0);
                setPhase('questions');
              }
            : null
        }
        onBack={onBack}
      />
    );
  }
  if (phase === 'result') return <Spinner />; // waiting for our submission to arrive

  if (closed) {
    return (
      <div className="stack center">
        <h1>{a.title}</h1>
        <p className="muted">Час на виконання цього завдання минув.</p>
      </div>
    );
  }

  if (phase === 'intro') {
    return (
      <div className="stack center">
        <h1>{a.title}</h1>
        <p className="muted">
          {questionsLabel(a.questions.length)}
          {a.dueAt && ` · до ${formatDateTime(a.dueAt.toDate())}`}
          {a.maxAttempts !== null &&
            ` · ${countLabel(a.maxAttempts - used, ['спроба', 'спроби', 'спроб'])}`}
        </p>
        <div>
          <button className="btn btn-lg btn-sun" onClick={() => setPhase('questions')}>
            Почати
          </button>
        </div>
      </div>
    );
  }

  const answered = a.questions.filter((q) => hasAnswer(answers[q.id])).length;

  if (phase === 'review') {
    return (
      <div className="stack center">
        <h1>Готово?</h1>
        <p className="lead">
          Ти відповів(-ла) на <b>{answered}</b> з {a.questions.length}{' '}
          {plural(a.questions.length, ['питання', 'питань', 'питань'])}.
        </p>
        {answered < a.questions.length && (
          <p className="muted">Питання без відповіді зарахуються як неправильні.</p>
        )}
        <ErrorText error={error} />
        <div className="row row-center">
          <button className="btn btn-secondary" onClick={() => setPhase('questions')}>
            ← Перевірити ще раз
          </button>
          <button className="btn btn-lg btn-sun" disabled={busy} onClick={() => void submit()}>
            <Icon name="send" /> {busy ? 'Надсилаю…' : 'Надіслати'}
          </button>
        </div>
      </div>
    );
  }

  const q = a.questions[index]!;
  const isLast = index === a.questions.length - 1;
  const next = () => (isLast ? setPhase('review') : setIndex(index + 1));
  return (
    <div className="stack">
      <div className="row">
        <b>
          {index + 1} / {a.questions.length}
        </b>
        <div className="progress grow" aria-hidden="true">
          <div style={{ width: `${((index + 1) / a.questions.length) * 100}%` }} />
        </div>
      </div>
      <div className="question">
        <p className="question-prompt">{q.prompt}</p>
        {junior && canSpeak() && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              speak(
                [q.prompt, ...(q.type === 'text' ? [] : q.options.map((o) => o.text))].join('. '),
              )
            }
          >
            <Icon name="speaker" /> Прочитати
          </button>
        )}
        <QuestionInput
          key={q.id}
          question={q}
          value={answers[q.id]}
          onChange={(v) => setAnswers((cur) => ({ ...cur, [q.id]: v }))}
          onEnter={next}
        />
      </div>
      <div className="row">
        <button
          className="btn btn-secondary"
          onClick={() => setIndex(index - 1)}
          disabled={index === 0}
        >
          ← Назад
        </button>
        <div className="grow" />
        <button className="btn btn-lg" onClick={next}>
          {isLast ? 'Завершити' : 'Далі →'}
        </button>
      </div>
    </div>
  );
}

export function QuestionInput({
  question,
  value,
  onChange,
  onEnter,
}: {
  question: PublicQuestion;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  onEnter: () => void;
}) {
  if (question.type === 'text') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onEnter();
        }}
      >
        <input
          className="input input-lg"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Напиши відповідь…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={500}
          aria-label="Відповідь"
        />
      </form>
    );
  }
  const selected = question.type === 'single' ? [value] : Array.isArray(value) ? value : [];
  const toggle = (id: string) => {
    if (question.type === 'single') return onChange(id);
    const cur = Array.isArray(value) ? value : [];
    onChange(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  return (
    <div className="stack stack-sm">
      {question.type === 'multiple' && (
        <p className="muted strong">Обери всі правильні відповіді</p>
      )}
      <div className="options" role={question.type === 'single' ? 'radiogroup' : 'group'}>
        {question.options.map((o, i) => {
          const on = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className={`option-btn${on ? ' selected' : ''}`}
              style={{ ['--opt' as string]: `var(--opt-${i % 8})` }}
              onClick={() => toggle(o.id)}
              role={question.type === 'single' ? 'radio' : 'checkbox'}
              aria-checked={on}
            >
              <OptionShape index={i} />
              <span className="grow">{o.text}</span>
              {on && <Icon name="check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatGiven(q: PublicQuestion, v: AnswerValue | undefined): string {
  if (!hasAnswer(v)) return '— (без відповіді)';
  if (q.type === 'text') return String(v);
  const ids = Array.isArray(v) ? v : [v!];
  return ids.map((x) => q.options.find((o) => o.id === x)?.text ?? '?').join(', ');
}

function correctText(q: Question): string {
  if (q.type === 'text') return q.acceptedAnswers[0] ?? '';
  const ids = q.type === 'single' ? [q.correctOptionId] : q.correctOptionIds;
  return q.options
    .filter((o) => ids.includes(o.id))
    .map((o) => o.text)
    .join(', ');
}

function praise(p: number, junior: boolean) {
  if (p >= 90) return junior ? 'Чудово! Ти молодець!' : 'Відмінний результат!';
  if (p >= 60) return junior ? 'Молодець! Гарна робота!' : 'Добрий результат!';
  return junior ? 'Гарна спроба! Далі буде ще краще!' : 'Є над чим попрацювати';
}

/**
 * After submitting: the score and the review if the rules let this pupil read the
 * key (reveal «одразу», or after the due date). Otherwise just «надіслано».
 */
function Result({
  id,
  a,
  last,
  junior,
  onRetry,
  onBack,
}: {
  id: string;
  a: AssignmentDoc;
  last: SubmissionDoc;
  junior: boolean;
  onRetry: (() => void) | null;
  onBack: () => void;
}) {
  const [key, setKey] = useState<KeyDoc | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getDoc(keyRef(id)).then(
      (snap) => !cancelled && setKey((snap.data() as KeyDoc | undefined) ?? null),
      () => !cancelled && setKey(null), // not allowed yet: no review
    );
    return () => {
      cancelled = true;
    };
  }, [id, last.attempt]);

  const retry = onRetry && (
    <button className="btn" onClick={onRetry}>
      <Icon name="retry" /> Спробувати ще раз
    </button>
  );

  if (key === undefined) return <Spinner />;
  if (!key) {
    return (
      <div className="stack center" data-testid="hw-sent">
        <h1>{a.title}</h1>
        <p className="feedback">
          <Icon name="check" size={28} /> Відповіді надіслано!
        </p>
        <p className="muted">
          {a.reveal === 'after_due' && a.dueAt
            ? `Правильні відповіді з'являться після ${formatDateTime(a.dueAt.toDate())}.`
            : 'Результат покаже вчитель.'}
        </p>
        <div className="row row-center">
          {retry}
          <button className="btn btn-secondary" onClick={onBack}>
            До завдань
          </button>
        </div>
      </div>
    );
  }

  const g = gradeAnswers(key.questions, last.answers);
  const p = g.total ? Math.round((100 * g.correctCount) / g.total) : 0;
  return (
    <div className="stack" data-testid="hw-result">
      <h1 className="center">{a.title}</h1>
      <div className="feedback center">
        <h2>{praise(p, junior)}</h2>
        <p className="lead">
          Правильно: <b data-testid="hw-score">{g.correctCount}</b> з {g.total}
        </p>
      </div>
      <ol className="review">
        {key.questions.map((q, i) => {
          const ok = g.perQuestion[i]?.correct ?? false;
          const pub = a.questions.find((x) => x.id === q.id);
          return (
            <li key={q.id} className={ok ? 'review-ok' : 'review-bad'}>
              <span className="review-icon" aria-label={ok ? 'правильно' : 'неправильно'}>
                <Icon name={ok ? 'check' : 'cross'} />
              </span>
              <div>
                <p className="strong pre">{q.prompt}</p>
                <p className="small">
                  Твоя відповідь: {pub ? formatGiven(pub, last.answers[q.id]) : ''}
                </p>
                {!ok && <p className="small answer-ok">Правильна відповідь: {correctText(q)}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="row row-center">
        {retry}
        <button className="btn btn-secondary" onClick={onBack}>
          До завдань
        </button>
      </div>
    </div>
  );
}
