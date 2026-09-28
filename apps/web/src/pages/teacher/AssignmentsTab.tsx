import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { AssignmentDto, ClassDto } from '@infoklas/shared';
import { Empty, ErrorBox, Field, Modal, QueryState } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime, fromLocalInput } from '../../lib/format';
import { QuizPicker } from './QuizPicker';
import { ShareBox } from './ShareBox';

export function AssignModal({ cls, onClose }: { cls: ClassDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [quizId, setQuizId] = useState('');
  const [due, setDue] = useState('');
  const [attempts, setAttempts] = useState<string>('unlimited');
  const [showCorrect, setShowCorrect] = useState(true);

  const create = useMutation({
    mutationFn: () =>
      api.post<AssignmentDto>('/api/assignments', {
        quizId,
        classId: cls.id,
        dueAt: fromLocalInput(due),
        maxAttempts: attempts === 'unlimited' ? null : Number(attempts),
        showCorrect,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assignments', cls.id] });
      void qc.invalidateQueries({ queryKey: ['journal', cls.id] });
    },
  });

  if (create.data) {
    return (
      <Modal title="Завдання видано ✅" onClose={onClose}>
        <p>
          Учні класу {cls.name} уже бачать завдання «{create.data.title}» у своєму кабінеті. Для
          онлайн-уроку надішліть посилання:
        </p>
        <ShareBox joinCode={cls.joinCode} assignmentId={create.data.id} title={create.data.title} />
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Готово
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Домашнє завдання для ${cls.name}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <QuizPicker value={quizId} onChange={setQuizId} />
        <Field label="Виконати до" hint="Необов'язково. Після цього часу відповіді не приймаються.">
          <input
            className="input"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
        <Field label="Кількість спроб">
          <select className="select" value={attempts} onChange={(e) => setAttempts(e.target.value)}>
            <option value="1">1 спроба</option>
            <option value="2">2 спроби</option>
            <option value="3">3 спроби</option>
            <option value="unlimited">Без обмежень (зараховується найкраща)</option>
          </select>
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showCorrect}
            onChange={(e) => setShowCorrect(e.target.checked)}
          />
          Показувати правильні відповіді після здачі
        </label>
        <ErrorBox error={create.error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn" disabled={!quizId || create.isPending}>
            Видати завдання
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AssignmentsTab({ cls }: { cls: ClassDto }) {
  const assignments = useQuery({
    queryKey: ['assignments', cls.id],
    queryFn: () => api.get<AssignmentDto[]>(`/api/classes/${cls.id}/assignments`),
  });

  return (
    <QueryState query={assignments}>
      {(list) =>
        list.length === 0 ? (
          <Empty emoji="📝">Ще немає домашніх завдань. Натисніть «Дати завдання».</Empty>
        ) : (
          <div className="stack">
            {list.map((a) => {
              const overdue = a.dueAt && new Date(a.dueAt) < new Date();
              return (
                <div key={a.id} className="card">
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <h3>
                        <Link to={`/t/assignments/${a.id}`}>{a.title}</Link>
                      </h3>
                      <div className="row small muted">
                        <span>
                          Здали: <b>{a.submittedCount}</b> з {cls.studentCount}
                        </span>
                        {a.dueAt && (
                          <span className={`badge ${overdue ? 'badge-muted' : 'badge-warning'}`}>
                            {overdue ? 'Закрито' : 'до'} {formatDateTime(a.dueAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Link to={`/t/assignments/${a.id}`} className="btn btn-secondary btn-sm">
                      Результати
                    </Link>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <ShareBox joinCode={cls.joinCode} assignmentId={a.id} title={a.title} />
                  </div>
                </div>
              );
            })}
          </div>
        )
      }
    </QueryState>
  );
}
