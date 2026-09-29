import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { describeCorrectAnswer } from '@infoklas/shared';
import type { AssignmentDto, AssignmentResultsDto, ClassDto } from '@infoklas/shared';
import { ErrorBox, Field, Modal, QueryState, ScoreBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime, fromLocalInput, percent, toLocalInput } from '../../lib/format';
import { ShareBox } from './ShareBox';

function DueModal({ a, onClose }: { a: AssignmentDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [due, setDue] = useState(toLocalInput(a.dueAt));
  const save = useMutation({
    mutationFn: (dueAt: string | null) => api.patch(`/api/assignments/${a.id}`, { dueAt }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['results', a.id] });
      void qc.invalidateQueries({ queryKey: ['assignments', a.classId] });
      onClose();
    },
  });
  return (
    <Modal title="Термін виконання" onClose={onClose}>
      <div className="stack">
        <Field label="Виконати до" hint="Залиште порожнім, щоб прибрати обмеження">
          <input
            className="input"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
        <ErrorBox error={save.error} />
        <div className="modal-actions">
          <button
            className="btn btn-secondary"
            onClick={() => save.mutate(new Date().toISOString())}
          >
            Закрити зараз
          </button>
          <button
            className="btn"
            onClick={() => save.mutate(fromLocalInput(due))}
            disabled={save.isPending}
          >
            Зберегти
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function AssignmentResults() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const results = useQuery({
    queryKey: ['results', id],
    queryFn: () => api.get<AssignmentResultsDto>(`/api/assignments/${id}/results`),
    refetchInterval: 15_000,
  });
  const classId = results.data?.assignment.classId;
  const cls = useQuery({
    queryKey: ['class', classId],
    queryFn: () => api.get<ClassDto>(`/api/classes/${classId}`),
    enabled: !!classId,
  });
  const [editingDue, setEditingDue] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/assignments/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assignments', classId] });
      void qc.invalidateQueries({ queryKey: ['journal', classId] });
      navigate(`/t/classes/${classId}`);
    },
  });

  return (
    <main className="page">
      <QueryState query={results}>
        {({ assignment: a, questions, rows }) => {
          const done = rows.filter((r) => r.best);
          const perQuestion = questions.map((_, i) => {
            const answered = done.filter((r) => r.perQuestion);
            const ok = answered.filter((r) => r.perQuestion![i]).length;
            return { ok, total: answered.length };
          });
          return (
            <>
              <Link to={`/t/classes/${a.classId}`} className="back-link">
                ← {cls.data ? `Клас ${cls.data.name}` : 'До класу'}
              </Link>
              <div className="page-header">
                <div>
                  <h1>{a.title}</h1>
                  <div className="row small muted">
                    <span>
                      Здали: <b>{done.length}</b> з {rows.length}
                    </span>
                    <span>·</span>
                    <span>{a.dueAt ? `до ${formatDateTime(a.dueAt)}` : 'без терміну'}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingDue(true)}>
                      Змінити термін
                    </button>
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() =>
                      window.confirm('Видалити завдання разом з відповідями учнів?') &&
                      remove.mutate()
                    }
                  >
                    Видалити
                  </button>
                </div>
              </div>
              {cls.data && (
                <div style={{ marginBottom: 20 }}>
                  <ShareBox joinCode={cls.data.joinCode} assignmentId={a.id} title={a.title} />
                </div>
              )}
              <ErrorBox error={remove.error} />

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="sticky-col">Учень</th>
                      <th>Результат</th>
                      <th>Спроби</th>
                      {questions.map((q, i) => (
                        <th key={q.id} title={q.prompt} className="center">
                          {i + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.studentId}>
                        <td className="sticky-col" style={{ fontWeight: 700 }}>
                          {r.displayName}
                        </td>
                        <td>
                          {r.best ? (
                            <span className="row">
                              <ScoreBadge correct={r.best.correctCount} total={r.best.total} />
                              <span className="muted small">
                                {r.best.correctCount}/{r.best.total}
                              </span>
                            </span>
                          ) : (
                            <span className="muted">не здано</span>
                          )}
                        </td>
                        <td>{r.attempts || ''}</td>
                        {questions.map((q, i) => (
                          <td key={q.id} className="center">
                            <span
                              className={`dot ${r.perQuestion ? (r.perQuestion[i] ? 'dot-ok' : 'dot-bad') : 'dot-none'}`}
                              aria-label={
                                r.perQuestion
                                  ? r.perQuestion[i]
                                    ? 'правильно'
                                    : 'неправильно'
                                  : 'немає'
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h2 style={{ marginTop: 32 }}>Питання</h2>
              <p className="muted small">Які питання виявилися найскладнішими для класу.</p>
              <div className="stack">
                {questions.map((q, i) => {
                  const s = perQuestion[i]!;
                  return (
                    <div key={q.id} className="card" style={{ padding: 14 }}>
                      <div className="row" style={{ alignItems: 'flex-start' }}>
                        <b>{i + 1}.</b>
                        <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{q.prompt}</div>
                        {s.total > 0 && <ScoreBadge correct={s.ok} total={s.total} />}
                      </div>
                      <div className="small muted" style={{ marginTop: 4 }}>
                        Правильна відповідь: <b>{describeCorrectAnswer(q)}</b>
                        {s.total > 0 &&
                          ` · правильно відповіли ${s.ok} з ${s.total} (${percent(s.ok, s.total)}%)`}
                      </div>
                    </div>
                  );
                })}
              </div>
              {editingDue && <DueModal a={a} onClose={() => setEditingDue(false)} />}
            </>
          );
        }}
      </QueryState>
    </main>
  );
}
