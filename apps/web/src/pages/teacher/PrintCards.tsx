import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { decodePictureSecret, getPicture } from '@infoklas/shared';
import type { ClassDto, StudentDto } from '@infoklas/shared';
import { Empty, QueryState } from '../../components/ui';
import { api } from '../../lib/api';

export function PrintCards() {
  const { id = '' } = useParams();
  const cls = useQuery({
    queryKey: ['class', id],
    queryFn: () => api.get<ClassDto>(`/api/classes/${id}`),
  });
  const students = useQuery({
    queryKey: ['students', id],
    queryFn: () => api.get<StudentDto[]>(`/api/classes/${id}/students`),
  });
  const site = window.location.host;

  return (
    <main className="page">
      <div className="no-print">
        <Link to={`/t/classes/${id}`} className="back-link">
          ← До класу
        </Link>
        <div className="page-header">
          <h1>Картки входу</h1>
          <div className="actions">
            <button className="btn" onClick={() => window.print()}>
              🖨 Друкувати
            </button>
          </div>
        </div>
        <p className="muted">
          Розріжте картки та роздайте учням. Для онлайн-уроку можна надіслати кожному його картку
          особисто.
        </p>
      </div>
      <QueryState query={cls}>
        {(c) => (
          <QueryState query={students}>
            {(list) =>
              list.length === 0 ? (
                <Empty emoji="🧒">У класі ще немає учнів.</Empty>
              ) : (
                <div className="cards-print">
                  {list.map((s) => (
                    <div key={s.id} className="login-card">
                      <div className="name">{s.displayName}</div>
                      <div className="small muted">
                        Сайт: <b>{site}</b> · Клас {c.name} · Код класу: <b>{c.joinCode}</b>
                      </div>
                      <div style={{ marginTop: 8 }}>
                        {s.secretKind === 'pictures' ? (
                          <>
                            <div className="small">Мої картинки:</div>
                            <div className="pics">
                              {decodePictureSecret(s.secret)
                                .map((p) => getPicture(p)?.emoji ?? '?')
                                .join(' ')}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="small">Мій пароль:</div>
                            <div className="pw">{s.secret}</div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </QueryState>
        )}
      </QueryState>
    </main>
  );
}
