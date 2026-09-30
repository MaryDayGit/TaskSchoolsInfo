import { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useSearchParams } from 'react-router';
import {
  avgText,
  distributionBins,
  historyCsv,
  historyFileName,
  pcText,
  type HistoryStats,
} from '@infoklas/shared';
import { db } from '../firebase/app';
import { errorText } from '../firebase/errors';
import { useQuery } from '../firebase/watch';
import type { ClassDoc } from '../data/classes';
import { assignmentsCol, deleteAssignment, type AssignmentDoc } from '../data/assignments';
import { useConfirm } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { ErrorText, Spinner } from '../components/Modal';
import { downloadText } from '../lib/download';
import { plural } from '../lib/text';
import { ScoreBadge } from './AssignmentPage';
import { useLessonStats, useSaveSummary } from './useLessonRows';

// «Історія» (вкладка Клас-пульта): все тесты уроков по классам — кто сдал,
// средний балл, распределение, что выбирали, таблица и CSV. Перенесённые из
// Клас-пульта сессии — такие же задания `kind: "lesson"` с пометкой `legacy`.

type Lesson = { id: string; data: AssignmentDoc };

const lessonsQuery = () => query(assignmentsCol(), where('kind', '==', 'lesson'));
const when = (a: AssignmentDoc) => a.createdAt?.toMillis() ?? Date.now();

const timeFmt = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('uk-UA', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function dayLabel(ms: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const diff = Math.round((day(now) - day(ms)) / 86_400_000);
  if (diff === 0) return 'Сьогодні';
  if (diff === 1) return 'Вчора';
  return dateFmt.format(ms);
}

export function HistoryPage() {
  const lessons = useQuery<AssignmentDoc>(lessonsQuery(), 'history');
  const classes = useQuery<ClassDoc>(collection(db, 'classes'), 'classes');
  const [params, setParams] = useSearchParams();
  const [classId, setClassId] = useState('');
  const [quizId, setQuizId] = useState('');
  const selected = params.get('id');

  const className = useMemo(() => {
    const names = new Map(classes.docs.map((c) => [c.id, c.data.name]));
    return (id: string) => names.get(id) ?? 'клас видалено';
  }, [classes.docs]);

  const all = useMemo(
    () => [...lessons.docs].sort((a, b) => when(b.data) - when(a.data)),
    [lessons.docs],
  );
  const classOptions = useMemo(
    () =>
      [...new Set(all.map((l) => l.data.classId))]
        .map((id) => [id, className(id)] as const)
        .sort((a, b) => a[1].localeCompare(b[1], 'uk')),
    [all, className],
  );
  const quizOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of all) if (!m.has(l.data.quizId)) m.set(l.data.quizId, l.data.title);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'uk'));
  }, [all]);
  const list = all.filter(
    (l) => (!classId || l.data.classId === classId) && (!quizId || l.data.quizId === quizId),
  );
  const current = all.find((l) => l.id === selected) ?? null;

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('id', id);
    else next.delete('id');
    setParams(next, { replace: true });
  };

  let lastDay = '';
  return (
    <main className="page page-wide">
      <h1>Історія тестів</h1>
      <p className="muted small">
        Тести, які ви надсилали на уроці: учні класу і гості за номером ПК. Домашні завдання — на
        сторінці класу.
      </p>
      <ErrorText error={lessons.error ?? classes.error} />
      <div className="history">
        <section className="panel history-side" aria-label="Список тестів">
          <div className="history-filters">
            <label className="field">
              <span>Клас</span>
              <select
                className="input"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
              >
                <option value="">Усі класи</option>
                {classOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Тест</span>
              <select className="input" value={quizId} onChange={(e) => setQuizId(e.target.value)}>
                <option value="">Усі тести</option>
                {quizOptions.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {lessons.loading ? (
            <Spinner />
          ) : !list.length ? (
            <p className="muted">
              {all.length
                ? 'Нічого не знайдено для цього фільтра.'
                : 'Історія порожня. Тут з’являться тести, які ви надсилали класам на уроці.'}
            </p>
          ) : (
            <div className="history-list" data-testid="history-list">
              {list.map((l) => {
                const day = dayLabel(when(l.data));
                const head = day !== lastDay;
                lastDay = day;
                const sum = l.data.summary;
                return (
                  <div key={l.id} className="stack-tight">
                    {head && <p className="history-day">{day}</p>}
                    <button
                      type="button"
                      className={`history-item${l.id === selected ? ' selected' : ''}`}
                      aria-pressed={l.id === selected}
                      onClick={() => select(l.id)}
                      data-testid={`h-${l.data.title}`}
                    >
                      <span className="history-item-top">
                        <span>{timeFmt.format(when(l.data))}</span>
                        <span className="badge">{className(l.data.classId)}</span>
                      </span>
                      <span className="strong">{l.data.title}</span>
                      <span className="small muted" data-testid="h-sum">
                        {sum?.submitted
                          ? `здали ${sum.submitted} · ${sum.avgPercent}%`
                          : sum
                            ? 'ще ніхто не здав'
                            : 'відкрийте, щоб порахувати'}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section className="panel history-detail" aria-label="Статистика">
          {current ? (
            <Detail
              key={current.id}
              lesson={current}
              className={className(current.data.classId)}
              onDeleted={() => select(null)}
            />
          ) : (
            <>
              <h2 className="panel-title">Статистика</h2>
              <p className="muted">Оберіть тест у списку, щоб побачити результати класу.</p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Detail({
  lesson,
  className,
  onDeleted,
}: {
  lesson: Lesson;
  className: string;
  onDeleted: () => void;
}) {
  const { id, data: a } = lesson;
  const { stats, loading, error } = useLessonStats(id, a.classId);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useSaveSummary(id, a.summary, !loading && stats.total > 0, stats);
  const ms = when(a);

  const remove = async () => {
    const ok = await confirm({
      title: 'Видалити з історії?',
      text: `«${a.title}» (${className}) — відповіді учнів цього тесту буде видалено назавжди, зокрема з журналу класу.`,
      ok: 'Видалити',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteAssignment(id);
      onDeleted();
    } catch (err) {
      setDeleteError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="stack" data-testid="history-detail">
      <div className="panel-head">
        <div>
          <p className="small muted">
            <Icon name="test" /> {dayLabel(ms)}, {timeFmt.format(ms)} · {className}
            {a.legacy && ' · з Клас-пульта'}
          </p>
          <h2 className="panel-title" data-testid="h-title">
            {a.title}
          </h2>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          disabled={!stats.rows.length}
          onClick={() => downloadText(historyFileName(a.title, className, ms), historyCsv(stats))}
        >
          <Icon name="download" /> Завантажити CSV
        </button>
      </div>
      <ErrorText error={error ?? deleteError} />
      {loading ? (
        <Spinner />
      ) : !stats.rows.length ? (
        <p className="muted">Цей тест ще ніхто не здав.</p>
      ) : (
        <>
          <Tiles stats={stats} />
          <h3 className="section-title">Розподіл балів</h3>
          <Distribution stats={stats} />
          <h3 className="section-title">Питання: скільки відповіли правильно і що обирали</h3>
          <Questions stats={stats} />
          <h3 className="section-title">Учні</h3>
          <div className="table-wrap">
            <table className="table" data-testid="h-table">
              <thead>
                <tr>
                  <th>ПК</th>
                  <th>Учень</th>
                  <th>Бал</th>
                  <th>Відповіді</th>
                </tr>
              </thead>
              <tbody>
                {stats.rows.map((r) => (
                  <tr key={r.key} data-testid={`hr-${r.name}`}>
                    <td>{pcText(r.pcId) || '—'}</td>
                    <td className="strong">
                      {r.name}
                      {!r.studentId && <span className="muted small"> · гість</span>}
                    </td>
                    <td>
                      <span className="row">
                        {r.correctCount} / {stats.total}{' '}
                        <ScoreBadge correct={r.correctCount} total={stats.total} />
                      </span>
                    </td>
                    <td>
                      <span className="marks">
                        {stats.perQuestion.map((q, i) => {
                          const v = r.answers[q.questionId];
                          const none =
                            v === undefined || v === '' || (Array.isArray(v) && !v.length);
                          const mark = none ? 'none' : r.perQuestion[i] ? 'ok' : 'bad';
                          const label = `Питання ${i + 1}: ${
                            mark === 'ok'
                              ? 'правильно'
                              : mark === 'bad'
                                ? 'неправильно'
                                : 'без відповіді'
                          }`;
                          return (
                            <span
                              key={q.questionId}
                              className={`sq sq-${mark}`}
                              role="img"
                              aria-label={label}
                              title={label}
                            />
                          );
                        })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div>
        <button
          className="btn btn-danger-ghost btn-sm"
          disabled={busy}
          onClick={() => void remove()}
        >
          Видалити з історії
        </button>
      </div>
    </div>
  );
}

function Tiles({ stats }: { stats: HistoryStats }) {
  const items: [string, string, string][] = [
    ['Здали', String(stats.submitted), plural(stats.submitted, ['учень', 'учні', 'учнів'])],
    ['Середній бал', `${avgText(stats.avg)} з ${stats.total}`, `${stats.avgPercent}%`],
  ];
  if (stats.hardest) {
    items.push([
      'Найважче питання',
      `№ ${stats.hardest.index + 1}`,
      `${stats.hardest.percent}% правильно`,
    ]);
  }
  return (
    <div className="stat-tiles" data-testid="h-tiles">
      {items.map(([label, value, note]) => (
        <div key={label} className="stat-tile">
          <p className="stat-label">{label}</p>
          <p className="stat-value">{value}</p>
          <p className="stat-note">{note}</p>
        </div>
      ))}
    </div>
  );
}

function Distribution({ stats }: { stats: HistoryStats }) {
  const bins = distributionBins(stats);
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <div className="dist" role="img" aria-label="Розподіл балів">
      {bins.map((b) => (
        <div
          key={b.label}
          className="dist-col"
          title={`${b.label}: ${b.count} ${plural(b.count, ['учень', 'учні', 'учнів'])}`}
        >
          <span className="dist-count">{b.count || ''}</span>
          <span className="dist-track">
            <span
              className="dist-bar"
              style={{ height: `${Math.round((b.count * 100) / max)}%` }}
            />
          </span>
          <span className="dist-label">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function Questions({ stats }: { stats: HistoryStats }) {
  return (
    <div className="qstats" data-testid="h-questions">
      {stats.perQuestion.map((q) => {
        const most = Math.max(1, q.none, ...(q.options ?? []).map((o) => o.count));
        const bar = (count: number) => (
          <span className="qopt-bar" aria-hidden="true">
            <span className="qopt-fill" style={{ width: `${Math.round((count * 100) / most)}%` }} />
          </span>
        );
        return (
          <div key={q.questionId} className="qstat">
            <div className="qstat-head">
              <span className="qstat-num">{q.index + 1}</span>
              <span className="qstat-text" title={q.prompt}>
                {q.prompt}
              </span>
              <span className="qstat-bar" aria-hidden="true">
                <span className="qstat-fill" style={{ width: `${q.percent}%` }} />
              </span>
              <span className="qstat-percent">{q.percent}%</span>
            </div>
            <div className="qopts">
              {q.options?.map((o) => (
                <div key={o.id} className={`qopt${o.correct ? ' qopt-correct' : ''}`}>
                  <span className="qopt-text">
                    {o.correct && <Icon name="check" />}
                    {o.text}
                    {o.correct && <span className="qopt-tag">правильна</span>}
                  </span>
                  {bar(o.count)}
                  <span className="qopt-count">{o.count}</span>
                </div>
              ))}
              {!q.options && (
                <div className="qopt qopt-correct">
                  <span className="qopt-text">відповіли правильно</span>
                  {bar(q.correct)}
                  <span className="qopt-count">{q.correct}</span>
                </div>
              )}
              {q.none > 0 && (
                <div className="qopt qopt-none">
                  <span className="qopt-text">без відповіді</span>
                  {bar(q.none)}
                  <span className="qopt-count">{q.none}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
