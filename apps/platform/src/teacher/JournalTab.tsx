import { useCallback, useEffect, useState } from 'react';
import { getDoc, getDocs, query, where } from 'firebase/firestore';
import { Link } from 'react-router';
import { buildJournal, journalToCsv, percent, type Journal } from '@infoklas/shared';
import { errorText } from '../firebase/errors';
import type { ClassDoc } from '../data/classes';
import { classGamesQuery, gameResultsCol, type GameDoc } from '../data/games';
import {
  classAssignmentsQuery,
  keyRef,
  saveSummary,
  submissionsCol,
  type AssignmentDoc,
  type KeyDoc,
  type SubmissionDoc,
} from '../data/assignments';
import { Icon } from '../components/Icon';
import { ErrorText, Spinner } from '../components/Modal';
import { downloadText } from '../lib/download';
import { formatShortDate } from '../lib/text';
import { ScoreBadge } from './AssignmentPage';
import type { Student } from './ClassPage';

/**
 * «Журнал»: students × works, best attempt. Scores are recomputed here from raw
 * answers and the keys (never taken from what a pupil sent). Loaded on demand:
 * one read per submission, so it is not a live subscription.
 */
export function JournalTab({
  classId,
  c,
  students,
}: {
  classId: string;
  c: ClassDoc;
  students: Student[];
}) {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roster = students.map((s) => ({ id: s.id, displayName: s.data.displayName }));
  const rosterKey = roster.map((s) => `${s.id}:${s.displayName}`).join('|');

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [assignments, subs, games, gameRows] = await Promise.all([
        getDocs(classAssignmentsQuery(classId)),
        getDocs(query(submissionsCol(), where('classId', '==', classId))),
        getDocs(classGamesQuery(classId)),
        getDocs(query(gameResultsCol(), where('classId', '==', classId))),
      ]);
      const keys = await Promise.all(assignments.docs.map((d) => getDoc(keyRef(d.id))));
      const j = buildJournal({
        students: roster,
        assignments: assignments.docs.map((d, i) => {
          const a = d.data() as AssignmentDoc;
          return {
            id: d.id,
            kind: a.kind,
            title: a.title,
            date: a.createdAt?.toMillis() ?? Date.now(),
            questions: (keys[i]!.data() as KeyDoc | undefined)?.questions ?? [],
          };
        }),
        // Live games that got past the lobby; scores were computed by the host.
        games: games.docs
          .map((d) => ({ id: d.id, data: d.data() as GameDoc }))
          .filter((x) => x.data.status === 'finished' && x.data.index >= 0)
          .map((x) => ({
            id: x.id,
            title: x.data.title,
            date: x.data.createdAt?.toMillis() ?? Date.now(),
            results: gameRows.docs
              .map(
                (r) =>
                  r.data() as {
                    gameId: string;
                    studentId: string;
                    correctCount: number;
                    total: number;
                  },
              )
              .filter((r) => r.gameId === x.id),
          })),
        submissions: subs.docs.map((d) => {
          const s = d.data() as SubmissionDoc;
          return { ...s, submittedAt: s.submittedAt?.toMillis() ?? null };
        }),
      });
      setJournal(j);
      // Refresh the short summaries shown in the «Завдання» tab.
      for (const d of assignments.docs) {
        const cells = roster.map((s) => j.cells[`${s.id}:${d.id}`]).filter((x) => !!x);
        const avg = cells.length
          ? Math.round(
              cells.reduce((acc, x) => acc + percent(x.correctCount, x.total), 0) / cells.length,
            )
          : 0;
        const stored = (d.data() as AssignmentDoc).summary;
        if (!stored || stored.submitted !== cells.length || stored.avgPercent !== avg) {
          saveSummary(d.id, cells.length, avg).catch(() => {});
        }
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
    // roster is described by rosterKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, rosterKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="stack">
      <div className="row">
        <button
          className="btn btn-secondary"
          disabled={!journal}
          onClick={() => journal && downloadText(`Журнал ${c.name}.csv`, journalToCsv(journal))}
        >
          <Icon name="download" /> Завантажити для Excel / Google Таблиць
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load()}>
          <Icon name="retry" /> Оновити
        </button>
        <span className="muted small">Відсоток правильних відповідей, найкраща спроба.</span>
      </div>
      <ErrorText error={error} />
      {!journal ? (
        <Spinner />
      ) : !journal.columns.length || !journal.students.length ? (
        <p className="empty">Тут з'являться результати домашніх завдань.</p>
      ) : (
        <div className="table-wrap">
          <table className="table" data-testid="journal">
            <thead>
              <tr>
                <th className="sticky-col">Учень</th>
                {journal.columns.map((col) => (
                  <th key={col.id} className="journal-col">
                    {col.kind === 'live' ? (
                      <span>
                        {col.title} <span className="muted small">(гра)</span>
                      </span>
                    ) : (
                      <Link to={`/t/assignments/${col.id}`}>{col.title}</Link>
                    )}
                    <div className="small muted">{formatShortDate(new Date(col.date))}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {journal.students.map((s) => (
                <tr key={s.id} data-testid={`journal-${s.displayName}`}>
                  <td className="sticky-col strong">{s.displayName}</td>
                  {journal.columns.map((col) => {
                    const cell = journal.cells[`${s.id}:${col.id}`];
                    return (
                      <td key={col.id}>
                        {cell ? (
                          <ScoreBadge correct={cell.correctCount} total={cell.total} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
