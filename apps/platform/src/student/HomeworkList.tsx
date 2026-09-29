import { useQuery } from '../firebase/watch';
import {
  classAssignmentsQuery,
  isClosed,
  myClassSubmissionsQuery,
  type AssignmentDoc,
  type SubmissionDoc,
} from '../data/assignments';
import { ErrorText, Spinner } from '../components/Modal';
import { formatDateTime } from '../lib/text';

/** «Мої завдання» on the student page: open ones first, then done and closed. */
export function HomeworkList({
  classId,
  studentId,
  onOpen,
}: {
  classId: string;
  studentId: string;
  onOpen: (id: string) => void;
}) {
  const list = useQuery<AssignmentDoc>(classAssignmentsQuery(classId), `hw:${classId}`);
  const subs = useQuery<SubmissionDoc>(
    myClassSubmissionsQuery(classId, studentId),
    `mysubs:${classId}:${studentId}`,
  );

  if (list.loading) return <Spinner />;
  const attempts = new Map<string, number>();
  for (const s of subs.docs) {
    attempts.set(
      s.data.assignmentId,
      Math.max(attempts.get(s.data.assignmentId) ?? 0, s.data.attempt),
    );
  }
  const items = list.docs
    .filter((a) => a.data.kind === 'homework')
    .map((a) => {
      const used = attempts.get(a.id) ?? 0;
      const closed = isClosed(a.data);
      const status: 'todo' | 'done' | 'closed' = used ? 'done' : closed ? 'closed' : 'todo';
      return { ...a, used, closed, status };
    })
    .sort((x, y) => {
      const order = { todo: 0, done: 1, closed: 2 } as const;
      return (
        order[x.status] - order[y.status] ||
        (y.data.createdAt?.toMillis() ?? Infinity) - (x.data.createdAt?.toMillis() ?? Infinity)
      );
    });

  return (
    <section className="stack" aria-label="Мої завдання">
      <h2 className="center">Мої завдання</h2>
      <ErrorText error={list.error ?? subs.error} />
      {!items.length ? (
        <p className="waiting">
          <span className="pulse-dot" aria-hidden="true" /> Чекаємо на завдання
        </p>
      ) : (
        items.map((a) => (
          <button
            key={a.id}
            className={`hw-item hw-${a.status}`}
            onClick={() => onOpen(a.id)}
            data-testid={`hw-${a.data.title}`}
          >
            <span className="hw-title">{a.data.title}</span>
            <span className="hw-meta">
              {a.status === 'done'
                ? 'Здано'
                : a.status === 'closed'
                  ? 'Час вийшов'
                  : a.data.dueAt
                    ? `до ${formatDateTime(a.data.dueAt.toDate())}`
                    : 'Нове'}
            </span>
          </button>
        ))
      )}
    </section>
  );
}
