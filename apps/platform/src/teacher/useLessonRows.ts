import { useEffect, useMemo } from 'react';
import { historyStats, historySummary, lessonRows, type Question } from '@infoklas/shared';
import { useDoc, useQuery } from '../firebase/watch';
import { rosterCol, type RosterDoc } from '../data/classes';
import {
  keyRef,
  saveSummary,
  type AssignmentSummary,
  type KeyDoc,
  type SubmissionDoc,
} from '../data/assignments';
import { guestResultsQuery, lessonSubmissionsQuery, type GuestResultDoc } from '../data/room';

/**
 * A lesson test with everyone's answers: pupils of the class (best attempt) and
 * guest PCs (last answers). Shared by «Результати» on the lesson and «Історія».
 */
export function useLessonStats(id: string, classId: string | null) {
  const key = useDoc<KeyDoc>(keyRef(id));
  const subs = useQuery<SubmissionDoc & { pcId?: string }>(
    lessonSubmissionsQuery(id),
    `lsubs:${id}`,
  );
  const guests = useQuery<GuestResultDoc>(guestResultsQuery(id), `guests:${id}`);
  const roster = useQuery<RosterDoc>(classId ? rosterCol(classId) : null, `roster:${classId}`);

  const questions: Question[] = useMemo(() => key.data?.questions ?? [], [key.data]);
  const stats = useMemo(
    () =>
      historyStats(
        questions,
        lessonRows({
          questions,
          submissions: subs.docs.map((d) => ({
            ...d.data,
            submittedAt: d.data.submittedAt?.toMillis() ?? null,
          })),
          guests: guests.docs.map((d) => ({
            ...d.data,
            submittedAt: d.data.submittedAt?.toMillis() ?? null,
          })),
          names: new Map(roster.docs.map((r) => [r.id, r.data.displayName])),
        }),
      ),
    [questions, subs.docs, guests.docs, roster.docs],
  );
  const loading = key.loading || subs.loading || guests.loading || roster.loading;
  return {
    questions,
    stats,
    loading,
    error: key.error ?? subs.error ?? guests.error ?? roster.error,
  };
}

/** Keeps «здали N · X%» of the History list fresh (as Клас-пульт's sessions summary). */
export function useSaveSummary(
  id: string,
  stored: AssignmentSummary | undefined,
  ready: boolean,
  stats: ReturnType<typeof historyStats>,
) {
  const next = historySummary(stats);
  const same =
    stored && stored.submitted === next.submitted && stored.avgPercent === next.avgPercent;
  useEffect(() => {
    if (ready && !same) saveSummary(id, next.submitted, next.avgPercent).catch(() => {});
  }, [id, ready, same, next.submitted, next.avgPercent]);
}
