import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router';
import type { StudentAssignmentSummaryDto, StudentMeDto } from '@infoklas/shared';
import { Empty, QueryState, ScoreBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { countLabel, formatDateTime } from '../../lib/format';

export function LiveBanner() {
  const live = useQuery({
    queryKey: ['student-live'],
    queryFn: () => api.get<{ id: string; title: string } | null>('/api/student/live'),
    refetchInterval: 4000,
  });
  if (!live.data) return null;
  return (
    <div className="live-banner">
      <span className="emoji" aria-hidden>
        🎮
      </span>
      <div>
        <div style={{ fontWeight: 900, fontSize: '1.15rem' }}>Почалась гра!</div>
        <div>{live.data.title}</div>
      </div>
      <Link to={`/s/live/${live.data.id}`} className="btn btn-lg">
        Приєднатися
      </Link>
    </div>
  );
}

export function StudentHome() {
  const me = useOutletContext<StudentMeDto>();
  const assignments = useQuery({
    queryKey: ['student-assignments'],
    queryFn: () => api.get<StudentAssignmentSummaryDto[]>('/api/student/assignments'),
    refetchInterval: 30_000,
  });

  return (
    <main className="page" style={{ maxWidth: 760 }}>
      <h1>Привіт, {me.displayName}! 👋</h1>
      <LiveBanner />
      <QueryState query={assignments}>
        {(list) => {
          const todo = list.filter((a) => !a.closed && a.attemptsUsed === 0);
          const rest = list.filter((a) => !(!a.closed && a.attemptsUsed === 0));
          return (
            <div className="stack" style={{ gap: 24 }}>
              <section>
                <h2>Треба зробити</h2>
                {todo.length === 0 ? (
                  <Empty emoji="🎉">Усе зроблено! Нових завдань немає.</Empty>
                ) : (
                  <div className="stack">
                    {todo.map((a) => (
                      <Link key={a.id} to={`/s/a/${a.id}`} className="card card-link">
                        <div className="row">
                          <div style={{ flex: 1 }}>
                            <h3>📝 {a.title}</h3>
                            <div className="muted small">
                              {countLabel(a.questionCount, ['питання', 'питання', 'питань'])}
                              {a.dueAt && ` · до ${formatDateTime(a.dueAt)}`}
                            </div>
                          </div>
                          <span className="btn">Почати</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
              {rest.length > 0 && (
                <section>
                  <h2>Виконані</h2>
                  <div className="stack">
                    {rest.map((a) => (
                      <Link key={a.id} to={`/s/a/${a.id}`} className="card card-link">
                        <div className="row">
                          <div style={{ flex: 1 }}>
                            <h3>{a.title}</h3>
                            <div className="muted small">
                              {a.attemptsUsed > 0
                                ? countLabel(a.attemptsUsed, ['спроба', 'спроби', 'спроб'])
                                : 'Не здано вчасно'}
                              {!a.closed && ' · можна спробувати ще'}
                            </div>
                          </div>
                          {a.best && (
                            <ScoreBadge correct={a.best.correctCount} total={a.best.total} />
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
          );
        }}
      </QueryState>
    </main>
  );
}
