import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { DEFAULT_TIME_LIMIT_SEC, quizInputSchema } from '@infoklas/shared';
import type { Question, QuestionType, QuizDto } from '@infoklas/shared';
import { OPTION_SHAPES, optionStyle } from '../../components/options';
import { ErrorBox, Field, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { shortId } from '../../lib/id';

const TYPE_LABELS: Record<QuestionType, string> = {
  single: 'Одна правильна відповідь',
  multiple: 'Кілька правильних відповідей',
  text: 'Відповідь словом або числом',
};
const TIME_LIMITS = [10, 20, 30, 40, 45, 60, 90, 120, 180];

function blankOptions() {
  return [1, 2, 3, 4].map(() => ({ id: shortId(), text: '' }));
}

function newQuestion(type: QuestionType = 'single'): Question {
  const base = { id: shortId(), prompt: '', timeLimitSec: DEFAULT_TIME_LIMIT_SEC };
  if (type === 'text') return { ...base, type, acceptedAnswers: [''] };
  const options = blankOptions();
  return type === 'single'
    ? { ...base, type, options, correctOptionId: options[0]!.id }
    : { ...base, type, options, correctOptionIds: [options[0]!.id] };
}

/** Switches the question type while keeping the prompt and options. */
function changeType(q: Question, type: QuestionType): Question {
  if (q.type === type) return q;
  const base = { id: q.id, prompt: q.prompt, timeLimitSec: q.timeLimitSec };
  if (type === 'text') return { ...base, type, acceptedAnswers: [''] };
  const options = q.type === 'text' ? blankOptions() : q.options;
  const correct =
    q.type === 'single' ? [q.correctOptionId] : q.type === 'multiple' ? q.correctOptionIds : [];
  const first = correct[0] ?? options[0]!.id;
  return type === 'single'
    ? { ...base, type, options, correctOptionId: first }
    : { ...base, type, options, correctOptionIds: correct.length ? correct : [first] };
}

/** Drops options/answers the teacher left empty (unless marked correct) before saving. */
function cleanQuestion(q: Question): Question {
  if (q.type === 'text')
    return { ...q, acceptedAnswers: q.acceptedAnswers.filter((a) => a.trim()) };
  const correct = q.type === 'single' ? [q.correctOptionId] : q.correctOptionIds;
  const options = q.options.filter((o) => o.text.trim() || correct.includes(o.id));
  return { ...q, options: options.length >= 2 ? options : q.options };
}

function describeIssue(path: PropertyKey[], message: string): string {
  if (path[0] === 'questions' && typeof path[1] === 'number') {
    return `Питання ${path[1] + 1}: ${message}`;
  }
  return message;
}

function QuestionEditor({
  q,
  index,
  count,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  q: Question;
  index: number;
  count: number;
  onChange: (q: Question) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const isCorrect = (id: string) =>
    q.type === 'single'
      ? q.correctOptionId === id
      : q.type === 'multiple'
        ? q.correctOptionIds.includes(id)
        : false;

  const toggleCorrect = (id: string) => {
    if (q.type === 'single') onChange({ ...q, correctOptionId: id });
    else if (q.type === 'multiple') {
      const next = q.correctOptionIds.includes(id)
        ? q.correctOptionIds.filter((x) => x !== id)
        : [...q.correctOptionIds, id];
      onChange({ ...q, correctOptionIds: next });
    }
  };

  return (
    <div className="card q-card">
      <div className="q-head">
        <span className="q-num">Питання {index + 1}</span>
        <select
          className="select"
          style={{ width: 'auto', minHeight: 36 }}
          value={q.type}
          onChange={(e) => onChange(changeType(q, e.target.value as QuestionType))}
          aria-label="Тип питання"
        >
          {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 'auto', minHeight: 36 }}
          value={q.timeLimitSec}
          onChange={(e) => onChange({ ...q, timeLimitSec: Number(e.target.value) })}
          aria-label="Час у живій грі"
          title="Час на відповідь у живій грі"
        >
          {(TIME_LIMITS.includes(q.timeLimitSec)
            ? TIME_LIMITS
            : [...TIME_LIMITS, q.timeLimitSec].sort((a, b) => a - b)
          ).map((t) => (
            <option key={t} value={t}>
              ⏱ {t} с
            </option>
          ))}
        </select>
        <div className="row" style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Вгору"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label="Вниз"
          >
            ↓
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDuplicate}>
            Копія
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
            Видалити
          </button>
        </div>
      </div>

      <div className="stack">
        <textarea
          className="textarea"
          rows={2}
          value={q.prompt}
          onChange={(e) => onChange({ ...q, prompt: e.target.value })}
          placeholder="Текст питання"
          aria-label="Текст питання"
          maxLength={2000}
        />

        {q.type === 'text' ? (
          <Field
            label="Правильні відповіді"
            hint="Великі/малі літери та зайві пробіли не враховуються. Можна додати кілька варіантів написання."
          >
            <div className="stack" style={{ gap: 8 }}>
              {q.acceptedAnswers.map((a, i) => (
                <div key={i} className="opt-row">
                  <input
                    className="input"
                    value={a}
                    onChange={(e) =>
                      onChange({
                        ...q,
                        acceptedAnswers: q.acceptedAnswers.map((x, j) =>
                          j === i ? e.target.value : x,
                        ),
                      })
                    }
                    placeholder={i === 0 ? 'Правильна відповідь' : 'Інший варіант написання'}
                    maxLength={200}
                  />
                  {q.acceptedAnswers.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        onChange({
                          ...q,
                          acceptedAnswers: q.acceptedAnswers.filter((_, j) => j !== i),
                        })
                      }
                      aria-label="Прибрати"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {q.acceptedAnswers.length < 20 && (
                <div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onChange({ ...q, acceptedAnswers: [...q.acceptedAnswers, ''] })}
                  >
                    + Ще варіант написання
                  </button>
                </div>
              )}
            </div>
          </Field>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <span className="small muted" style={{ fontWeight: 700 }}>
              Варіанти відповіді (натисніть ✓, щоб позначити правильні)
            </span>
            {q.options.map((o, i) => (
              <div key={o.id} className="opt-row">
                <span className="option-shape" style={optionStyle(i)} aria-hidden>
                  {OPTION_SHAPES[i % OPTION_SHAPES.length]}
                </span>
                <input
                  className="input"
                  value={o.text}
                  onChange={(e) =>
                    onChange({
                      ...q,
                      options: q.options.map((x) =>
                        x.id === o.id ? { ...x, text: e.target.value } : x,
                      ),
                    })
                  }
                  placeholder={`Варіант ${i + 1}`}
                  maxLength={300}
                />
                <button
                  type="button"
                  className={`correct-toggle${isCorrect(o.id) ? ' on' : ''}`}
                  onClick={() => toggleCorrect(o.id)}
                  aria-label={isCorrect(o.id) ? 'Правильна відповідь' : 'Позначити правильною'}
                  aria-pressed={isCorrect(o.id)}
                  title={isCorrect(o.id) ? 'Правильна відповідь' : 'Позначити правильною'}
                >
                  {isCorrect(o.id) ? '✓' : ''}
                </button>
                {q.options.length > 2 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label="Прибрати варіант"
                    onClick={() => {
                      const options = q.options.filter((x) => x.id !== o.id);
                      if (q.type === 'single') {
                        onChange({
                          ...q,
                          options,
                          correctOptionId:
                            q.correctOptionId === o.id ? options[0]!.id : q.correctOptionId,
                        });
                      } else {
                        onChange({
                          ...q,
                          options,
                          correctOptionIds: q.correctOptionIds.filter((x) => x !== o.id),
                        });
                      }
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {q.options.length < 8 && (
              <div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    onChange({ ...q, options: [...q.options, { id: shortId(), text: '' }] })
                  }
                >
                  + Додати варіант
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Editor({ initial }: { initial: QuizDto | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [questions, setQuestions] = useState<Question[]>(initial?.questions ?? [newQuestion()]);
  const [dirty, setDirtyState] = useState(false);
  // The blocker reads a ref so that navigating right after a save isn't blocked.
  const dirtyRef = useRef(false);
  const setDirty = (v: boolean) => {
    dirtyRef.current = v;
    setDirtyState(v);
  };
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Є незбережені зміни. Вийти без збереження?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const update = (fn: (qs: Question[]) => Question[]) => {
    setQuestions(fn);
    setDirty(true);
    setSaved(false);
  };

  const save = useMutation({
    mutationFn: (body: unknown) =>
      initial
        ? api.put<QuizDto>(`/api/quizzes/${initial.id}`, body)
        : api.post<QuizDto>('/api/quizzes', body),
    onSuccess: (q) => {
      setQuestions(q.questions);
      setDirty(false);
      setSaved(true);
      qc.setQueryData(['quiz', q.id], q);
      void qc.invalidateQueries({ queryKey: ['quizzes'] });
      if (!initial) navigate(`/t/quizzes/${q.id}`, { replace: true });
    },
  });

  const onSave = () => {
    const body = { title, questions: questions.map(cleanQuestion) };
    const parsed = quizInputSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      setValidationError(describeIssue(issue.path, issue.message));
      return;
    }
    if (parsed.data.questions.length === 0) {
      setValidationError('Додайте хоча б одне питання');
      return;
    }
    setValidationError(null);
    save.mutate(parsed.data);
  };

  return (
    <main className="page" style={{ maxWidth: 860 }}>
      <Link to="/t/quizzes" className="back-link">
        ← Усі тести
      </Link>
      <div className="stack">
        <input
          className="input"
          style={{ fontSize: '1.5rem', fontWeight: 800, minHeight: 56 }}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
            setSaved(false);
          }}
          placeholder="Назва тесту, наприклад «Пристрої комп'ютера»"
          aria-label="Назва тесту"
          maxLength={200}
        />
        {questions.map((q, i) => (
          <QuestionEditor
            key={q.id}
            q={q}
            index={i}
            count={questions.length}
            onChange={(nq) => update((qs) => qs.map((x) => (x.id === q.id ? nq : x)))}
            onMove={(dir) =>
              update((qs) => {
                const next = [...qs];
                const j = i + dir;
                [next[i], next[j]] = [next[j]!, next[i]!];
                return next;
              })
            }
            onDuplicate={() =>
              update((qs) => {
                const copy = structuredClone(q);
                copy.id = shortId();
                if (copy.type !== 'text') {
                  const idMap = new Map(copy.options.map((o) => [o.id, shortId()]));
                  copy.options = copy.options.map((o) => ({ ...o, id: idMap.get(o.id)! }));
                  if (copy.type === 'single')
                    copy.correctOptionId = idMap.get(copy.correctOptionId)!;
                  else copy.correctOptionIds = copy.correctOptionIds.map((x) => idMap.get(x)!);
                }
                return [...qs.slice(0, i + 1), copy, ...qs.slice(i + 1)];
              })
            }
            onDelete={() => update((qs) => qs.filter((x) => x.id !== q.id))}
          />
        ))}
        <div className="row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => update((qs) => [...qs, newQuestion()])}
          >
            + Питання з варіантами
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => update((qs) => [...qs, newQuestion('text')])}
          >
            + Питання з відповіддю словом
          </button>
        </div>
      </div>

      <div className="sticky-save">
        <button className="btn btn-lg" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? 'Зберігаю…' : 'Зберегти'}
        </button>
        {saved && !dirty && <span className="badge badge-success">✔ Збережено</span>}
        {dirty && <span className="muted small">Є незбережені зміни</span>}
        <div style={{ flex: 1, minWidth: 200 }}>
          {validationError && <div className="alert alert-error">{validationError}</div>}
          <ErrorBox error={save.error} />
        </div>
      </div>
    </main>
  );
}

export function QuizEditor() {
  const { id } = useParams();
  const quiz = useQuery({
    queryKey: ['quiz', id],
    queryFn: () => api.get<QuizDto>(`/api/quizzes/${id}`),
    enabled: !!id,
  });
  if (!id) return <Editor initial={null} />;
  if (quiz.isPending) return <Spinner />;
  if (quiz.error) return <ErrorBox error={quiz.error} />;
  return <Editor key={quiz.data.id} initial={quiz.data} />;
}
