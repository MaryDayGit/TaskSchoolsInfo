import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext, useParams } from 'react-router';
import type {
  AnswerMap,
  AnswerValue,
  PublicQuestion,
  StudentAssignmentDto,
  StudentMeDto,
  SubmissionResultDto,
} from '@infoklas/shared';
import { QuestionInput, hasAnswer } from '../../components/QuestionInput';
import { SpeakButton } from '../../components/SpeakButton';
import { ErrorBox, QueryState } from '../../components/ui';
import { api } from '../../lib/api';
import { countLabel, formatDateTime, percent, plural } from '../../lib/format';

const draftKey = (studentId: string, assignmentId: string) => `draft:${studentId}:${assignmentId}`;

function loadDraft(key: string): AnswerMap {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as AnswerMap;
  } catch {
    return {};
  }
}

function praise(p: number, junior: boolean) {
  if (p >= 90)
    return { emoji: '🌟', text: junior ? 'Чудово! Ти молодець!' : 'Відмінний результат!' };
  if (p >= 60)
    return { emoji: '👍', text: junior ? 'Молодець! Гарна робота!' : 'Добрий результат!' };
  return {
    emoji: '💪',
    text: junior ? 'Гарна спроба! Далі буде ще краще!' : 'Є над чим попрацювати',
  };
}

function formatGiven(q: PublicQuestion, v: AnswerValue | null): string {
  if (v === null || (Array.isArray(v) && v.length === 0) || v === '') return '— (без відповіді)';
  if (q.type === 'text') return String(v);
  const ids = Array.isArray(v) ? v : [v];
  return ids.map((id) => q.options.find((o) => o.id === id)?.text ?? '?').join(', ');
}

function Results({
  a,
  result,
  junior,
  onRetry,
}: {
  a: StudentAssignmentDto;
  result: SubmissionResultDto;
  junior: boolean;
  onRetry: (() => void) | null;
}) {
  const p = percent(result.correctCount, result.total);
  const msg = praise(p, junior);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="feedback feedback-neutral">
        <span className="emoji" aria-hidden>
          {msg.emoji}
        </span>
        <h2 style={{ margin: '8px 0 4px' }}>{msg.text}</h2>
        <div style={{ fontSize: '1.2rem' }}>
          Правильно: <b>{result.correctCount}</b> з {result.total}
        </div>
      </div>
      <div className="card">
        {a.questions.map((q, i) => {
          const r = result.perQuestion.find((x) => x.questionId === q.id);
          if (!r) return null;
          return (
            <div key={q.id} className="result-item">
              <span className="result-icon" aria-label={r.correct ? 'правильно' : 'неправильно'}>
                {r.correct ? '✅' : '❌'}
              </span>
              <div>
                <div style={{ fontWeight: 700, whiteSpace: 'pre-wrap' }}>
                  {i + 1}. {q.prompt}
                </div>
                <div className="small">Твоя відповідь: {formatGiven(q, r.given)}</div>
                {!r.correct && r.correctAnswer && (
                  <div className="small" style={{ color: 'var(--success)', fontWeight: 700 }}>
                    Правильна відповідь: {r.correctAnswer}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="row">
        {onRetry && (
          <button className="btn" onClick={onRetry}>
            🔁 Спробувати ще раз
          </button>
        )}
        <Link to="/s" className="btn btn-secondary">
          До завдань
        </Link>
      </div>
    </div>
  );
}

export function TakeAssignment() {
  const { id = '' } = useParams();
  const me = useOutletContext<StudentMeDto>();
  const assignment = useQuery({
    queryKey: ['student-assignment', id],
    queryFn: () => api.get<StudentAssignmentDto>(`/api/student/assignments/${id}`),
  });
  const lastResult = useQuery({
    queryKey: ['student-result', id],
    queryFn: () => api.get<SubmissionResultDto | null>(`/api/student/assignments/${id}/result`),
  });

  return (
    <main className="page" style={{ maxWidth: 760 }}>
      <Link to="/s" className="back-link">
        ← Мої завдання
      </Link>
      <QueryState query={assignment}>
        {(a) => (
          <QueryState query={lastResult}>
            {(last) => <Runner key={a.attemptsUsed} a={a} last={last} me={me} />}
          </QueryState>
        )}
      </QueryState>
    </main>
  );
}

function Runner({
  a,
  last,
  me,
}: {
  a: StudentAssignmentDto;
  last: SubmissionResultDto | null;
  me: StudentMeDto;
}) {
  const qc = useQueryClient();
  const key = draftKey(me.id, a.id);
  const [phase, setPhase] = useState<'intro' | 'questions' | 'review' | 'result'>(
    last ? 'result' : 'intro',
  );
  const [answers, setAnswers] = useState<AnswerMap>(() => loadDraft(key));
  const [index, setIndex] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(answers));
    } catch {
      /* storage unavailable (private mode) — drafts are a convenience only */
    }
  }, [key, answers]);

  const submit = useMutation({
    mutationFn: () =>
      api.post<SubmissionResultDto>(`/api/student/assignments/${a.id}/submit`, { answers }),
    onSuccess: (r) => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      qc.setQueryData(['student-result', a.id], r);
      void qc.invalidateQueries({ queryKey: ['student-assignment', a.id] });
      void qc.invalidateQueries({ queryKey: ['student-assignments'] });
    },
  });

  const result = submit.data ?? last;

  if (phase === 'result' && result) {
    return (
      <>
        <h1>{a.title}</h1>
        <Results
          a={a}
          result={result}
          junior={me.junior}
          onRetry={
            !a.closed
              ? () => {
                  setAnswers({});
                  setIndex(0);
                  setPhase('questions');
                  submit.reset();
                }
              : null
          }
        />
      </>
    );
  }

  if (a.closed && !result) {
    return (
      <div className="card center">
        <h1>{a.title}</h1>
        <p className="muted">Час на виконання цього завдання минув.</p>
      </div>
    );
  }

  if (phase === 'intro') {
    return (
      <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <span style={{ fontSize: '3rem' }} aria-hidden>
          📝
        </span>
        <h1>{a.title}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {countLabel(a.questions.length, ['питання', 'питання', 'питань'])}
          {a.dueAt && ` · до ${formatDateTime(a.dueAt)}`}
          {a.maxAttempts !== null &&
            ` · ${countLabel(a.maxAttempts - a.attemptsUsed, ['спроба', 'спроби', 'спроб'])}`}
        </p>
        <button className="btn btn-lg" onClick={() => setPhase('questions')}>
          Почати ▶
        </button>
      </div>
    );
  }

  const answeredCount = a.questions.filter((q) => hasAnswer(answers[q.id])).length;

  if (phase === 'review') {
    return (
      <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <h1>Готово?</h1>
        <p style={{ fontSize: '1.15rem' }}>
          Ти відповів(-ла) на <b>{answeredCount}</b> з {a.questions.length}{' '}
          {plural(a.questions.length, ['питання', 'питань', 'питань'])}.
        </p>
        {answeredCount < a.questions.length && (
          <p className="muted">Питання без відповіді зарахуються як неправильні.</p>
        )}
        <ErrorBox error={submit.error} />
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-secondary" onClick={() => setPhase('questions')}>
            ← Перевірити ще раз
          </button>
          <button
            className="btn btn-lg btn-success"
            disabled={submit.isPending}
            onClick={() => submit.mutate(undefined, { onSuccess: () => setPhase('result') })}
          >
            {submit.isPending ? 'Надсилаю…' : 'Надіслати ✔'}
          </button>
        </div>
      </div>
    );
  }

  const q = a.questions[index]!;
  const isLast = index === a.questions.length - 1;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <b>
          {index + 1} / {a.questions.length}
        </b>
        <div className="progress" style={{ flex: 1 }}>
          <div style={{ width: `${((index + 1) / a.questions.length) * 100}%` }} />
        </div>
      </div>
      <div className="card">
        <div className="question-prompt">{q.prompt}</div>
        {me.junior && (
          <div style={{ marginTop: -8, marginBottom: 12 }}>
            <SpeakButton
              text={[q.prompt, ...(q.type === 'text' ? [] : q.options.map((o) => o.text))].join(
                '. ',
              )}
            />
          </div>
        )}
        <QuestionInput
          key={q.id}
          question={q}
          value={answers[q.id]}
          onChange={(v) => setAnswers((cur) => ({ ...cur, [q.id]: v }))}
          onSubmitText={() => (isLast ? setPhase('review') : setIndex(index + 1))}
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
        <div style={{ flex: 1 }} />
        {isLast ? (
          <button className="btn btn-lg" onClick={() => setPhase('review')}>
            Завершити
          </button>
        ) : (
          <button className="btn btn-lg" onClick={() => setIndex(index + 1)}>
            Далі →
          </button>
        )}
      </div>
    </div>
  );
}
