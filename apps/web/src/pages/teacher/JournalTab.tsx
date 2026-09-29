import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { ClassDto, JournalDto } from '@infoklas/shared';
import { Empty, QueryState, ScoreBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';

export function JournalTab({ cls }: { cls: ClassDto }) {
  const journal = useQuery({
    queryKey: ['journal', cls.id],
    queryFn: () => api.get<JournalDto>(`/api/classes/${cls.id}/journal`),
  });

  return (
    <QueryState query={journal}>
      {(j) =>
        j.columns.length === 0 || j.students.length === 0 ? (
          <Empty emoji="📒">Тут з'являться результати домашніх завдань і живих ігор.</Empty>
        ) : (
          <div className="stack">
            <div className="row">
              <a className="btn btn-secondary" href={`/api/classes/${cls.id}/journal.csv`} download>
                ⬇ Завантажити для Excel / Google Таблиць
              </a>
              <span className="muted small">Відсоток правильних відповідей (найкраща спроба)</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="sticky-col">Учень</th>
                    {j.columns.map((c) => (
                      <th key={c.id} style={{ minWidth: 120 }}>
                        <div>
                          {c.kind === 'live' ? '🎮 ' : '📝 '}
                          {c.kind === 'assignment' ? (
                            <Link to={`/t/assignments/${c.id}`}>{c.title}</Link>
                          ) : (
                            c.title
                          )}
                        </div>
                        <div style={{ fontWeight: 600 }}>{formatDate(c.date)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {j.students.map((s) => (
                    <tr key={s.id}>
                      <td className="sticky-col" style={{ fontWeight: 700 }}>
                        {s.displayName}
                      </td>
                      {j.columns.map((c) => {
                        const cell = j.cells[`${s.id}:${c.id}`];
                        return (
                          <td key={c.id}>
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
          </div>
        )
      }
    </QueryState>
  );
}
