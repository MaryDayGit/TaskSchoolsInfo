import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import type { QuizDto, QuizSummaryDto } from '@infoklas/shared';
import { Empty, ErrorBox, QueryState } from '../../components/ui';
import { api } from '../../lib/api';
import { countLabel, formatDate } from '../../lib/format';
import { QUIZ_TEMPLATES } from './templates';

export function QuizList() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const quizzes = useQuery({
    queryKey: ['quizzes'],
    queryFn: () => api.get<QuizSummaryDto[]>('/api/quizzes'),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['quizzes'] });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<QuizDto>(`/api/quizzes/${id}/duplicate`),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/quizzes/${id}`),
    onSuccess: invalidate,
  });
  const fromTemplate = useMutation({
    mutationFn: (i: number) => api.post<QuizDto>('/api/quizzes', QUIZ_TEMPLATES[i]!.quiz),
    onSuccess: (q) => {
      void invalidate();
      navigate(`/t/quizzes/${q.id}`);
    },
  });

  return (
    <main className="page">
      <div className="page-header">
        <h1>Тести</h1>
        <div className="actions">
          <Link to="/t/quizzes/new" className="btn">
            + Новий тест
          </Link>
        </div>
      </div>
      <p className="muted">
        Один тест можна використати багато разів: як домашнє завдання для будь-якого класу або як
        живу гру на уроці.
      </p>
      <ErrorBox error={duplicate.error || remove.error || fromTemplate.error} />

      <QueryState query={quizzes}>
        {(list) =>
          list.length === 0 ? (
            <Empty emoji="🧩">Ще немає тестів. Створіть новий або почніть із шаблону нижче.</Empty>
          ) : (
            <div className="grid">
              {list.map((q) => (
                <div key={q.id} className="card">
                  <h3>
                    <Link to={`/t/quizzes/${q.id}`}>{q.title}</Link>
                  </h3>
                  <p className="muted small">
                    {countLabel(q.questionCount, ['питання', 'питання', 'питань'])} · змінено{' '}
                    {formatDate(q.updatedAt)}
                  </p>
                  <div className="row">
                    <Link to={`/t/quizzes/${q.id}`} className="btn btn-secondary btn-sm">
                      Редагувати
                    </Link>
                    <button className="btn btn-ghost btn-sm" onClick={() => duplicate.mutate(q.id)}>
                      Копія
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() =>
                        window.confirm(
                          `Видалити тест «${q.title}»? Уже видані завдання залишаться.`,
                        ) && remove.mutate(q.id)
                      }
                    >
                      Видалити
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </QueryState>

      <h2 style={{ marginTop: 36 }}>Шаблони для швидкого старту</h2>
      <p className="muted">Створіть копію шаблону і змініть під свій урок.</p>
      <div className="grid">
        {QUIZ_TEMPLATES.map((t, i) => (
          <div key={t.quiz.title} className="card">
            <h3>{t.quiz.title}</h3>
            <p className="small">
              <span className="badge">{t.grades}</span>{' '}
              <span className="muted">
                {countLabel(t.quiz.questions.length, ['питання', 'питання', 'питань'])}
              </span>
            </p>
            <button
              className="btn btn-secondary btn-sm"
              disabled={fromTemplate.isPending}
              onClick={() => fromTemplate.mutate(i)}
            >
              Використати
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
