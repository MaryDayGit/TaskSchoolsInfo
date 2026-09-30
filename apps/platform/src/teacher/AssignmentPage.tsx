import { useEffect, useMemo, useState } from 'react';
import { query, where } from 'firebase/firestore';
import { Link, useNavigate, useParams } from 'react-router';
import {
  assignmentResults,
  describeCorrectAnswer,
  percent,
  questionStats,
  summarize,
  toCsv,
} from '@infoklas/shared';
import { errorText } from '../firebase/errors';
import { useDoc, useQuery } from '../firebase/watch';
import { classRef, rosterCol, type ClassDoc, type RosterDoc } from '../data/classes';
import {
  REVEAL_LABELS,
  assignmentRef,
  deleteAssignment,
  isClosed,
  keyRef,
  saveSummary,
  submissionsCol,
  updateAssignment,
  type AssignmentDoc,
  type KeyDoc,
  type Reveal,
  type SubmissionDoc,
} from '../data/assignments';
import { useConfirm } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { ErrorText, Modal, Spinner } from '../components/Modal';
import { downloadText } from '../lib/download';
import { countLabel, formatDateTime, fromLocalInput, toLocalInput } from '../lib/text';
import { ATTEMPT_CHOICES } from './AssignModal';
import { ShareBox } from './ShareBox';

export function ScoreBadge({ correct, total }: { correct: number; total: number }) {
  const p = percent(correct, total);
  const level = p >= 75 ? 'high' : p >= 50 ? 'mid' : 'low';
  return <span className={`score score-${level}`}>{p}%</span>;
}

export function attemptsText(a: Pick<AssignmentDoc, 'maxAttempts'>) {
  return a.maxAttempts === null
    ? 'спроб без обмежень'
    : countLabel(a.maxAttempts, ['спроба', 'спроби', 'спроб']);
}

export function dueText(a: Pick<AssignmentDoc, 'dueAt'>) {
  if (!a.dueAt) return 'без терміну';
  return `${isClosed(a) ? 'закрито' : 'до'} ${formatDateTime(a.dueAt.toDate())}`;
}

export function AssignmentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const a = useDoc<AssignmentDoc>(assignmentRef(id));
  const key = useDoc<KeyDoc>(keyRef(id));
  const classId = a.data?.classId ?? '';
  const cls = useDoc<ClassDoc>(classId ? classRef(classId) : null);
  const roster = useQuery<RosterDoc>(classId ? rosterCol(classId) : null, `roster:${classId}`);
  // Live: the table fills in while pupils submit.
  const subs = useQuery<SubmissionDoc>(
    query(submissionsCol(), where('assignmentId', '==', id)),
    `subs:${id}`,
  );
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyQuestions = key.data?.questions;
  const questions = useMemo(() => keyQuestions ?? [], [keyQuestions]);
  const results = useMemo(
    () =>
      assignmentResults(
        questions,
        subs.docs.map((d) => ({ ...d.data, submittedAt: d.data.submittedAt?.toMillis() ?? null })),
      ),
    [questions, subs.docs],
  );
  const students = [...roster.docs].sort((x, y) =>
    x.data.displayName.localeCompare(y.data.displayName, 'uk'),
  );
  const inClass = students.filter((s) => results.has(s.id)).map((s) => results.get(s.id)!);

  // Keep the short summary on the assignment fresh for the class page. A lesson
  // test keeps the History summary instead (guests included, as Клас-пульт).
  const ready = !a.loading && !key.loading && !subs.loading && !roster.loading && !!key.data;
  const summary = summarize(inClass);
  const stored = a.data?.summary;
  useEffect(() => {
    if (!ready || a.pending || a.data?.kind === 'lesson') return;
    if (
      stored &&
      stored.submitted === summary.submitted &&
      stored.avgPercent === summary.avgPercent
    )
      return;
    saveSummary(id, summary.submitted, summary.avgPercent).catch(() => {});
  }, [ready, a.pending, a.data?.kind, id, stored, summary.submitted, summary.avgPercent]);

  if (a.loading) return <Spinner />;
  if (!a.exists || !a.data) {
    return (
      <main className="page">
        <ErrorText error={a.error ?? 'Завдання не знайдено'} />
        <Link to="/t" className="back-link">
          ← Усі класи
        </Link>
      </main>
    );
  }
  const as = a.data;
  const stats = questionStats(questions, inClass);

  const exportCsv = () => {
    const rows = [
      [
        'Учень',
        'Результат',
        'Правильно',
        'Питань',
        'Спроби',
        'Здано',
        ...questions.map((_, i) => `${i + 1}`),
      ],
      ...students.map((s) => {
        const r = results.get(s.id);
        if (!r) return [s.data.displayName, 'не здано'];
        return [
          s.data.displayName,
          `${percent(r.correctCount, r.total)}%`,
          String(r.correctCount),
          String(r.total),
          String(r.attempts),
          r.lastSubmittedAt ? formatDateTime(new Date(r.lastSubmittedAt)) : '',
          ...r.perQuestion.map((ok) => (ok ? '1' : '0')),
        ];
      }),
    ];
    downloadText(`${as.title} ${cls.data?.name ?? ''}.csv`, toCsv(rows));
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Видалити завдання «${as.title}»?`,
      text: 'Разом з відповідями учнів і оцінками в журналі. Скасувати не можна.',
      ok: 'Видалити',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteAssignment(id);
      navigate(`/t/classes/${as.classId}?tab=work`);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <main className="page">
      <Link to={`/t/classes/${as.classId}?tab=work`} className="back-link">
        ← {cls.data ? `Клас ${cls.data.name}` : 'До класу'}
      </Link>
      <div className="page-header">
        <div>
          <h1>{as.title}</h1>
          <p className="row small muted">
            <span data-testid="submitted-count">
              Здали: <b>{inClass.length}</b> з {students.length}
            </span>
            <span>· {dueText(as)}</span>
            <span>· {attemptsText(as)}</span>
            <span>· відповіді учням: {REVEAL_LABELS[as.reveal].toLowerCase()}</span>
          </p>
        </div>
        <div className="row">
          <button className="btn btn-secondary btn-sm" onClick={() => setSettings(true)}>
            Налаштування
          </button>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!ready}>
            <Icon name="download" /> CSV
          </button>
          <button className="btn btn-danger-ghost btn-sm" onClick={() => void remove()}>
            Видалити
          </button>
        </div>
      </div>
      {cls.data && <ShareBox joinCode={cls.data.joinCode} assignmentId={id} title={as.title} />}
      <ErrorText error={error ?? a.error ?? key.error ?? subs.error ?? roster.error} />

      {!ready ? (
        <Spinner />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table" data-testid="results-table">
              <thead>
                <tr>
                  <th className="sticky-col">Учень</th>
                  <th>Результат</th>
                  <th>Спроби</th>
                  <th>Здано</th>
                  {questions.map((q, i) => (
                    <th key={q.id} title={q.prompt} className="center">
                      {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const r = results.get(s.id);
                  return (
                    <tr key={s.id} data-testid={`result-${s.data.displayName}`}>
                      <td className="sticky-col strong">{s.data.displayName}</td>
                      <td>
                        {r ? (
                          <span className="row">
                            <ScoreBadge correct={r.correctCount} total={r.total} />
                            <span className="muted small">
                              {r.correctCount}/{r.total}
                            </span>
                          </span>
                        ) : (
                          <span className="muted">не здано</span>
                        )}
                      </td>
                      <td>{r?.attempts ?? ''}</td>
                      <td className="small muted">
                        {r?.lastSubmittedAt ? formatDateTime(new Date(r.lastSubmittedAt)) : ''}
                      </td>
                      {questions.map((q, i) => (
                        <td key={q.id} className="center">
                          <span
                            className={`dot ${r ? (r.perQuestion[i] ? 'dot-ok' : 'dot-bad') : 'dot-none'}`}
                            aria-label={
                              r ? (r.perQuestion[i] ? 'правильно' : 'неправильно') : 'немає'
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2 className="section-title">Питання</h2>
          <p className="muted small">Які питання виявилися найскладнішими для класу.</p>
          <div className="stack">
            {questions.map((q, i) => {
              const st = stats[i]!;
              return (
                <div key={q.id} className="card card-tight">
                  <div className="row row-top">
                    <b>{i + 1}.</b>
                    <div className="grow pre">{q.prompt}</div>
                    {inClass.length > 0 && (
                      <ScoreBadge correct={st.correct} total={inClass.length} />
                    )}
                  </div>
                  <p className="small muted">
                    Правильна відповідь: <b>{describeCorrectAnswer(q)}</b>
                    {inClass.length > 0 &&
                      ` · правильно відповіли ${st.correct} з ${inClass.length}`}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
      {settings && <SettingsModal id={id} a={as} onClose={() => setSettings(false)} />}
    </main>
  );
}

function SettingsModal({ id, a, onClose }: { id: string; a: AssignmentDoc; onClose: () => void }) {
  const [due, setDue] = useState(toLocalInput(a.dueAt ? a.dueAt.toDate() : null));
  const [attempts, setAttempts] = useState(a.maxAttempts === null ? '' : String(a.maxAttempts));
  const [reveal, setReveal] = useState<Reveal>(a.reveal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (dueAt: Date | null) => {
    if (reveal === 'after_due' && !dueAt) {
      return setError('Щоб показати розбір після терміну, вкажіть термін');
    }
    setBusy(true);
    setError(null);
    try {
      await updateAssignment(id, {
        dueAt,
        maxAttempts: attempts ? Number(attempts) : null,
        reveal,
      });
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const choices = ATTEMPT_CHOICES.some(([v]) => v === attempts)
    ? ATTEMPT_CHOICES
    : [
        ...ATTEMPT_CHOICES,
        [attempts, countLabel(Number(attempts), ['спроба', 'спроби', 'спроб'])] as [string, string],
      ];

  return (
    <Modal title="Налаштування завдання" onClose={onClose}>
      <div className="stack">
        <label className="field">
          <span>Виконати до</span>
          <input
            className="input"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <small className="hint">Залиште порожнім, щоб прибрати обмеження.</small>
        </label>
        <label className="field">
          <span>Кількість спроб</span>
          <select className="input" value={attempts} onChange={(e) => setAttempts(e.target.value)}>
            {choices.map(([v, label]) => (
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
        </label>
        <ErrorText error={error} />
        <div className="modal-actions">
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void save(new Date())}
          >
            Закрити зараз
          </button>
          <button className="btn" disabled={busy} onClick={() => void save(fromLocalInput(due))}>
            Зберегти
          </button>
        </div>
      </div>
    </Modal>
  );
}
