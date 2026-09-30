import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  DEFAULT_TIME_LIMIT_SEC,
  MAX_QUESTIONS,
  questionListSchema,
  type Question,
  type QuestionType,
} from '@infoklas/shared';
import { errorText } from '../firebase/errors';
import { useDoc, useQuery } from '../firebase/watch';
import {
  FOLDER_MAX,
  TITLE_MAX,
  createQuiz,
  quizRef,
  quizzesCol,
  saveQuiz,
  type QuizDoc,
} from '../data/quizzes';
import { useConfirm } from '../components/Dialog';
import { Icon, OptionShape } from '../components/Icon';
import { ErrorText, Spinner } from '../components/Modal';
import { clean } from '../lib/text';

// Редактор тестов ІнфоКласа (3 типа вопросов) + папка из Клас-пульта.

const TYPE_LABELS: Record<QuestionType, string> = {
  single: 'Одна правильна відповідь',
  multiple: 'Кілька правильних відповідей',
  text: 'Відповідь словом або числом',
};
const TIME_LIMITS = [10, 20, 30, 40, 45, 60, 90, 120, 180];

const shortId = () => Math.random().toString(36).slice(2, 10);

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

function duplicate(q: Question): Question {
  const copy = structuredClone(q);
  copy.id = shortId();
  if (copy.type !== 'text') {
    const ids = new Map(copy.options.map((o) => [o.id, shortId()]));
    copy.options = copy.options.map((o) => ({ ...o, id: ids.get(o.id)! }));
    if (copy.type === 'single') copy.correctOptionId = ids.get(copy.correctOptionId)!;
    else copy.correctOptionIds = copy.correctOptionIds.map((x) => ids.get(x)!);
  }
  return copy;
}

export function QuizEditorPage() {
  const { id } = useParams();
  const quiz = useDoc<QuizDoc>(id ? quizRef(id) : null);
  if (!id) return <Editor id={null} initial={null} />;
  if (quiz.loading) return <Spinner />;
  if (!quiz.exists || !quiz.data) {
    return (
      <main className="page">
        <ErrorText error={quiz.error ?? 'Тест не знайдено'} />
        <Link to="/t/quizzes" className="back-link">
          ← Банк тестів
        </Link>
      </main>
    );
  }
  // The editor keeps its own copy: live updates of the document don't overwrite typing.
  return <Editor key={id} id={id} initial={quiz.data} />;
}

function Editor({ id, initial }: { id: string | null; initial: QuizDoc | null }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const all = useQuery<QuizDoc>(quizzesCol(), 'quizzes');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [folder, setFolder] = useState(initial?.folder ?? '');
  const [questions, setQuestions] = useState<Question[]>(initial?.questions ?? [newQuestion()]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const touch = () => {
    setDirty(true);
    setSaved(false);
  };
  const update = (fn: (qs: Question[]) => Question[]) => {
    setQuestions(fn);
    touch();
  };

  const leave = async () => {
    if (
      !dirtyRef.current ||
      (await confirm({
        title: 'Вийти без збереження?',
        text: 'Зміни в тесті буде втрачено.',
        ok: 'Вийти',
        danger: true,
      }))
    ) {
      navigate('/t/quizzes');
    }
  };

  const save = async () => {
    const t = clean(title, TITLE_MAX);
    if (!t) return setError('Напишіть назву тесту');
    const list = questions.map(cleanQuestion);
    if (!list.length) return setError('Додайте хоча б одне питання');
    const parsed = questionListSchema.safeParse(list);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const n = typeof issue.path[0] === 'number' ? `Питання ${issue.path[0] + 1}: ` : '';
      return setError(n + issue.message);
    }
    setBusy(true);
    setError(null);
    try {
      const input = { title: t, folder: clean(folder, FOLDER_MAX), questions: parsed.data };
      if (id) await saveQuiz(id, input);
      else {
        const newId = await createQuiz(input);
        setDirty(false);
        navigate(`/t/quizzes/${newId}`, { replace: true });
        return;
      }
      setQuestions(parsed.data);
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const folders = [...new Set(all.docs.map((q) => q.data.folder).filter(Boolean))].sort();

  const add = (type: QuestionType) => update((qs) => [...qs, newQuestion(type)]);

  return (
    <main className="page page-narrow editor">
      {/* Always on screen: where you are and «Зберегти тест». */}
      <div className="editor-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void leave()}>
          ← Тести
        </button>
        <strong className="grow editor-bar-title">{id ? 'Редагування тесту' : 'Новий тест'}</strong>
        {saved && !dirty && (
          <span className="badge badge-ok" role="status">
            <Icon name="check" /> Збережено
          </span>
        )}
        {dirty && <span className="muted small">Є незбережені зміни</span>}
        <button className="btn" onClick={() => void save()} disabled={busy}>
          {busy ? 'Зберігаю…' : 'Зберегти тест'}
        </button>
      </div>
      <ErrorText error={error} />
      <div className="stack">
        <div className="card stack">
          <label className="field">
            <span>Назва тесту</span>
            <input
              className="input input-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                touch();
              }}
              placeholder="Наприклад: Пристрої комп'ютера"
              maxLength={TITLE_MAX}
            />
          </label>
          <label className="field">
            <span>Папка (необов’язково)</span>
            <input
              className="input"
              list="quiz-folders"
              value={folder}
              maxLength={FOLDER_MAX}
              placeholder="наприклад, 5 клас"
              onChange={(e) => {
                setFolder(e.target.value);
                touch();
              }}
            />
            <datalist id="quiz-folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
        </div>
        <p className="hint">
          Позначте правильні відповіді кнопкою «Правильна». Порожні варіанти не збережуться.
        </p>
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
              update((qs) => [...qs.slice(0, i + 1), duplicate(q), ...qs.slice(i + 1)])
            }
            onDelete={() => update((qs) => qs.filter((x) => x.id !== q.id))}
          />
        ))}
        {questions.length < MAX_QUESTIONS ? (
          <div className="add-question">
            <p className="strong">Додати питання</p>
            <div className="add-question-row">
              <button type="button" className="choice" onClick={() => add('single')}>
                <span className="choice-icon">
                  <OptionShape index={2} />
                </span>
                <span className="choice-text">
                  <span className="choice-title">Один правильний варіант</span>
                  <span className="choice-note">Учень обирає одну відповідь</span>
                </span>
              </button>
              <button type="button" className="choice" onClick={() => add('multiple')}>
                <span className="choice-icon">
                  <Icon name="test" size={22} />
                </span>
                <span className="choice-text">
                  <span className="choice-title">Кілька правильних</span>
                  <span className="choice-note">Треба позначити всі правильні</span>
                </span>
              </button>
              <button type="button" className="choice" onClick={() => add('text')}>
                <span className="choice-icon">
                  <Icon name="edit" size={22} />
                </span>
                <span className="choice-text">
                  <span className="choice-title">Відповідь словом</span>
                  <span className="choice-note">Слово або число, без варіантів</span>
                </span>
              </button>
            </div>
          </div>
        ) : (
          <p className="muted">У тесті вже {MAX_QUESTIONS} питань — це найбільше.</p>
        )}
      </div>
    </main>
  );
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

  const times = TIME_LIMITS.includes(q.timeLimitSec)
    ? TIME_LIMITS
    : [...TIME_LIMITS, q.timeLimitSec].sort((a, b) => a - b);

  return (
    <div className="card q-card" data-testid={`question-${index + 1}`}>
      <div className="q-head">
        <span className="q-num">Питання {index + 1}</span>
        <select
          className="input input-sm q-type"
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
        <span className="small muted">Час у грі:</span>
        <select
          className="input input-sm q-time"
          value={q.timeLimitSec}
          onChange={(e) => onChange({ ...q, timeLimitSec: Number(e.target.value) })}
          aria-label="Час у живій грі"
          title="Час на відповідь у живій грі"
        >
          {times.map((t) => (
            <option key={t} value={t}>
              {t} с
            </option>
          ))}
        </select>
        <div className="row q-tools">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Вгору"
          >
            <Icon name="up" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label="Вниз"
          >
            <Icon name="down" />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDuplicate}>
            Копія
          </button>
          <button
            type="button"
            className="btn btn-danger-ghost btn-sm"
            onClick={onDelete}
            disabled={count === 1}
          >
            Видалити
          </button>
        </div>
      </div>

      <textarea
        className="input textarea"
        rows={2}
        value={q.prompt}
        onChange={(e) => onChange({ ...q, prompt: e.target.value })}
        placeholder="Текст питання"
        aria-label="Текст питання"
        maxLength={2000}
      />

      {q.type === 'text' ? (
        <div className="stack stack-sm">
          <span className="small strong">Правильні відповіді</span>
          {q.acceptedAnswers.map((a, i) => (
            <div key={i} className="opt-row">
              <input
                className="input"
                value={a}
                aria-label={i === 0 ? 'Правильна відповідь' : `Інший варіант написання ${i}`}
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
                    onChange({ ...q, acceptedAnswers: q.acceptedAnswers.filter((_, j) => j !== i) })
                  }
                  aria-label="Прибрати"
                >
                  <Icon name="cross" />
                </button>
              )}
            </div>
          ))}
          <small className="hint">
            Великі й малі літери та зайві пробіли не враховуються. Можна додати кілька варіантів
            написання.
          </small>
          {q.acceptedAnswers.length < 20 && (
            <div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onChange({ ...q, acceptedAnswers: [...q.acceptedAnswers, ''] })}
              >
                <Icon name="plus" /> Ще варіант написання
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="stack stack-sm">
          <span className="small strong">
            Варіанти відповіді (натисніть «Правильна?», щоб позначити правильні)
          </span>
          {q.options.map((o, i) => (
            <div
              key={o.id}
              className="opt-row"
              style={{ ['--opt' as string]: `var(--opt-${i % 8})` }}
            >
              <OptionShape index={i} />
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
                aria-label={`Варіант ${i + 1}`}
                maxLength={300}
              />
              <button
                type="button"
                className={`correct-toggle${isCorrect(o.id) ? ' on' : ''}`}
                onClick={() => toggleCorrect(o.id)}
                aria-label={`Правильна відповідь: варіант ${i + 1}`}
                aria-pressed={isCorrect(o.id)}
                title={isCorrect(o.id) ? 'Правильна відповідь' : 'Позначити правильною'}
              >
                {isCorrect(o.id) ? <Icon name="check" /> : null}
                <span>{isCorrect(o.id) ? 'Правильна' : 'Правильна?'}</span>
              </button>
              {q.options.length > 2 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`Прибрати варіант ${i + 1}`}
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
                  <Icon name="cross" />
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
                <Icon name="plus" /> Додати варіант
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
