import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '../firebase/watch';
import type { ClassDoc } from '../data/classes';
import { classAssignmentsQuery, type AssignmentDoc } from '../data/assignments';
import { Icon } from '../components/Icon';
import { ErrorText, Spinner } from '../components/Modal';
import { questionsLabel } from '../lib/text';
import { AssignModal } from './AssignModal';
import { GameModal } from './GameModal';
import { attemptsText, dueText } from './AssignmentPage';
import { ShareBox } from './ShareBox';

/** «Завдання» tab of a class: homework given to it, newest first. */
export function ClassWork({
  classId,
  c,
  studentCount,
}: {
  classId: string;
  c: ClassDoc;
  studentCount: number;
}) {
  const list = useQuery<AssignmentDoc>(classAssignmentsQuery(classId), `work:${classId}`);
  const [assign, setAssign] = useState(false);
  const [play, setPlay] = useState(false);
  const sorted = [...list.docs].sort(
    (a, b) =>
      (b.data.createdAt?.toMillis() ?? Infinity) - (a.data.createdAt?.toMillis() ?? Infinity),
  );

  return (
    <section className="stack">
      <div className="row">
        <button className="btn" onClick={() => setAssign(true)}>
          <Icon name="plus" /> Дати завдання
        </button>
        <button className="btn btn-secondary" onClick={() => setPlay(true)}>
          Жива гра
        </button>
        <Link to="/t/quizzes" className="btn btn-secondary">
          Банк тестів
        </Link>
      </div>
      <ErrorText error={list.error} />
      {list.loading ? (
        <Spinner />
      ) : !sorted.length ? (
        <p className="empty">Ще немає завдань. Натисніть «Дати завдання» і оберіть тест з банку.</p>
      ) : (
        sorted.map(({ id, data: a }) => (
          <div key={id} className="card stack" data-testid={`work-${a.title}`}>
            <div className="row row-top">
              <div className="grow">
                <Link to={`/t/assignments/${id}`} className="strong">
                  {a.title}
                </Link>
                <p className="row small muted">
                  <span>{questionsLabel(a.questions.length)}</span>
                  <span>· {dueText(a)}</span>
                  <span>· {attemptsText(a)}</span>
                  {a.summary && (
                    <span>
                      · здали {a.summary.submitted} з {studentCount}, середній{' '}
                      {a.summary.avgPercent}%
                    </span>
                  )}
                </p>
              </div>
              <Link to={`/t/assignments/${id}`} className="btn btn-secondary btn-sm">
                Результати
              </Link>
            </div>
            <ShareBox joinCode={c.joinCode} assignmentId={id} title={a.title} />
          </div>
        ))
      )}
      {assign && <AssignModal classId={classId} onClose={() => setAssign(false)} />}
      {play && <GameModal classId={classId} onClose={() => setPlay(false)} />}
    </section>
  );
}
