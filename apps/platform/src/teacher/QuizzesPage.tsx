import { useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router';
import { IMPORT_EXAMPLE, parseImport, type Question } from '@infoklas/shared';
import { db } from '../firebase/app';
import { errorText } from '../firebase/errors';
import { useQuery } from '../firebase/watch';
import type { ClassDoc } from '../data/classes';
import { assignmentsCol, type AssignmentDoc } from '../data/assignments';
import {
  FOLDER_MAX,
  NO_FOLDER,
  createQuiz,
  deleteQuiz,
  importQuizzes,
  quizzesCol,
  type QuizDoc,
} from '../data/quizzes';
import { useConfirm } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { ErrorText, Modal, Spinner } from '../components/Modal';
import { clean, countLabel, formatShortDate, questionsLabel } from '../lib/text';
import { AssignModal, byFolder } from './AssignModal';
import { QUIZ_TEMPLATES } from './templates';

type Quiz = { id: string; data: QuizDoc };

/** «давали: 5-А 25.09 · 6-Б 20.09 · ще 2» (from Клас-пульт). */
function usageText(uses: { cls: string; at: number }[]): string {
  if (!uses.length) return 'ще не давали';
  const parts = uses.slice(0, 3).map((u) => `${u.cls} ${formatShortDate(new Date(u.at))}`);
  return `давали: ${parts.join(' · ')}${uses.length > 3 ? ` · ще ${uses.length - 3}` : ''}`;
}

export function QuizzesPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const quizzes = useQuery<QuizDoc>(quizzesCol(), 'quizzes');
  const assignments = useQuery<AssignmentDoc>(assignmentsCol(), 'assignments');
  const classes = useQuery<ClassDoc>(collection(db, 'classes'), 'classes');
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('');
  const [answers, setAnswers] = useState<Quiz | null>(null);
  const [assign, setAssign] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usage = useMemo(() => {
    const names = new Map(classes.docs.map((c) => [c.id, c.data.name]));
    const map = new Map<string, { cls: string; at: number }[]>();
    for (const a of assignments.docs) {
      const list = map.get(a.data.quizId) ?? [];
      list.push({
        cls: names.get(a.data.classId) ?? '?',
        at: a.data.createdAt?.toMillis() ?? Date.now(),
      });
      map.set(a.data.quizId, list);
    }
    for (const list of map.values()) list.sort((x, y) => y.at - x.at);
    return map;
  }, [assignments.docs, classes.docs]);

  const folders = [...new Set(quizzes.docs.map((q) => q.data.folder).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'uk'),
  );
  const query = clean(search, 100).toLowerCase();
  const list = quizzes.docs.filter(
    (q) =>
      (!query || q.data.title.toLowerCase().includes(query)) &&
      (!folder || (q.data.folder || NO_FOLDER) === folder),
  );

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <main className="page">
      <div className="page-header">
        <h1>Банк тестів</h1>
        <div className="row">
          <button className="btn btn-secondary" onClick={() => setImporting(true)}>
            <Icon name="upload" /> Імпорт
          </button>
          <Link to="/t/quizzes/new" className="btn">
            <Icon name="plus" /> Новий тест
          </Link>
        </div>
      </div>
      <p className="muted">
        Один тест можна давати багато разів: як домашнє завдання будь-якому класу. Видані завдання
        зберігають свою копію питань, тож тест можна змінювати.
      </p>
      <div className="row filters">
        <input
          className="input"
          type="search"
          placeholder="Пошук за назвою"
          aria-label="Пошук за назвою"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input"
          aria-label="Папка"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        >
          <option value="">Усі папки</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          {quizzes.docs.some((q) => !q.data.folder) && (
            <option value={NO_FOLDER}>{NO_FOLDER}</option>
          )}
        </select>
      </div>
      <ErrorText error={error ?? quizzes.error} />

      {quizzes.loading ? (
        <Spinner />
      ) : !quizzes.docs.length ? (
        <p className="empty">
          Тестів ще немає. Натисніть «Новий тест», «Імпорт» або візьміть шаблон нижче.
        </p>
      ) : !list.length ? (
        <p className="empty">Нічого не знайдено.</p>
      ) : (
        byFolder(list).map(([name, group]) => (
          <section key={name} className="test-group">
            <h2 className="test-group-title">
              {name} · {group.length}
            </h2>
            {group.map((q) => (
              <div key={q.id} className="card test-row" data-testid={`quiz-${q.data.title}`}>
                <div className="test-row-main">
                  <Link to={`/t/quizzes/${q.id}`} className="strong">
                    {q.data.title}
                  </Link>
                  <p className="hint">
                    {questionsLabel(q.data.questions.length)} · {usageText(usage.get(q.id) ?? [])}
                  </p>
                </div>
                <div className="row">
                  <button className="btn btn-sm" onClick={() => setAssign(q.id)}>
                    Дати завдання
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setAnswers(q)}>
                    <Icon name="key" /> Відповіді
                  </button>
                  <Link to={`/t/quizzes/${q.id}`} className="btn btn-secondary btn-sm">
                    Редагувати
                  </Link>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      run(async () => {
                        const id = await createQuiz({
                          title: clean(`${q.data.title} (копія)`, 200),
                          folder: q.data.folder,
                          questions: q.data.questions,
                        });
                        navigate(`/t/quizzes/${id}`);
                      })
                    }
                  >
                    Копія
                  </button>
                  <button
                    className="btn btn-danger-ghost btn-sm"
                    onClick={() =>
                      run(async () => {
                        const ok = await confirm({
                          title: `Видалити тест «${q.data.title}»?`,
                          text: 'Уже видані завдання та результати залишаться.',
                          ok: 'Видалити',
                          danger: true,
                        });
                        if (ok) await deleteQuiz(q.id);
                      })
                    }
                  >
                    Видалити
                  </button>
                </div>
              </div>
            ))}
          </section>
        ))
      )}

      <h2 className="section-title">Шаблони НУШ</h2>
      <p className="muted">Створіть копію шаблону і змініть під свій урок.</p>
      <div className="grid">
        {QUIZ_TEMPLATES.map((t) => (
          <div key={t.quiz.title} className="card stack">
            <strong>{t.quiz.title}</strong>
            <p className="row small">
              <span className="badge">{t.grades}</span>
              <span className="muted">{questionsLabel(t.quiz.questions.length)}</span>
            </p>
            <div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  run(async () => {
                    const id = await createQuiz({ ...t.quiz, folder: 'Шаблони' });
                    navigate(`/t/quizzes/${id}`);
                  })
                }
              >
                Використати
              </button>
            </div>
          </div>
        ))}
      </div>

      {answers && <AnswersModal quiz={answers} onClose={() => setAnswers(null)} />}
      {assign && <AssignModal quizId={assign} onClose={() => setAssign(null)} />}
      {importing && (
        <ImportModal
          folders={folders}
          existing={quizzes.docs.map((q) => q.data.title)}
          onClose={() => setImporting(false)}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------

/** «Відповіді» from Клас-пульт: the test with its correct answers, read-only. */
export function AnswerKey({ questions }: { questions: Question[] }) {
  return (
    <ol className="answer-key">
      {questions.map((q) => (
        <li key={q.id}>
          <p className="pre">{q.prompt}</p>
          {q.type === 'text' ? (
            <p className="answer-ok">
              <Icon name="check" /> {q.acceptedAnswers.join(' / ')}
            </p>
          ) : (
            <ul className="ak-options">
              {q.options.map((o) => {
                const ok =
                  q.type === 'single'
                    ? q.correctOptionId === o.id
                    : q.correctOptionIds.includes(o.id);
                return (
                  <li key={o.id} className={ok ? 'answer-ok' : undefined}>
                    {ok ? <Icon name="check" /> : <span className="icon-space" />} {o.text}
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function AnswersModal({ quiz, onClose }: { quiz: Quiz; onClose: () => void }) {
  return (
    <Modal title={`Відповіді: ${quiz.data.title}`} onClose={onClose}>
      <p className="hint">
        {questionsLabel(quiz.data.questions.length)}
        {quiz.data.folder ? ` · ${quiz.data.folder}` : ''}. Правильну відповідь позначено галочкою.
      </p>
      <div className="modal-scroll">
        <AnswerKey questions={quiz.data.questions} />
      </div>
      <div className="modal-actions">
        <Link to={`/t/quizzes/${quiz.id}`} className="btn btn-secondary">
          Редагувати
        </Link>
        <button className="btn" onClick={onClose}>
          Закрити
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/** Import from text in the Клас-пульт format (see packages/shared/src/importer.ts). */
function ImportModal({
  folders,
  existing,
  onClose,
}: {
  folders: string[];
  existing: string[];
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseImport(text), [text]);

  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.onerror = () => setError('Не вдалося прочитати файл');
    reader.readAsText(file, 'utf-8');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await importQuizzes(parsed.tests, clean(folder, FOLDER_MAX));
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Імпорт тестів з тексту" onClose={onClose}>
      <p className="hint">
        «#» починає тест, рядок без позначки — питання, «*» або «+» — правильний варіант, «-» —
        неправильний. «Папка: …» під назвою — необов'язково. Можна кілька тестів підряд.
      </p>
      <textarea
        className="input textarea mono"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Текст тестів"
        placeholder={IMPORT_EXAMPLE}
      />
      <div className="row">
        <label className="btn btn-secondary btn-sm file-btn">
          <Icon name="upload" /> Файл .txt
          <input
            type="file"
            accept=".txt,text/plain"
            className="sr-only"
            onChange={(e) => readFile(e.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setText(IMPORT_EXAMPLE)}
        >
          Вставити приклад
        </button>
      </div>
      <label className="field">
        <span>Папка для тестів без «Папка:»</span>
        <input
          className="input"
          list="import-folders"
          value={folder}
          maxLength={FOLDER_MAX}
          onChange={(e) => setFolder(e.target.value)}
        />
        <datalist id="import-folders">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      {parsed.errors.length > 0 && (
        <div className="alert alert-error" role="alert">
          <strong>Виправте:</strong>
          <ul>
            {parsed.errors.map((e, i) => (
              <li key={i}>
                Рядок {e.line}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {parsed.tests.length > 0 && (
        <ul className="import-list" data-testid="import-preview">
          {parsed.tests.map((t, i) => (
            <li key={i}>
              <strong>{t.title}</strong> · {questionsLabel(t.questions.length)}
              {t.folder && ` · ${t.folder}`}
              {existing.includes(t.title) && (
                <span className="badge badge-warn">така назва вже є</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Скасувати
        </button>
        <button
          className="btn"
          disabled={busy || !parsed.tests.length || parsed.errors.length > 0}
          onClick={() => void save()}
        >
          Імпортувати
          {parsed.tests.length
            ? ` (${countLabel(parsed.tests.length, ['тест', 'тести', 'тестів'])})`
            : ''}
        </button>
      </div>
    </Modal>
  );
}
