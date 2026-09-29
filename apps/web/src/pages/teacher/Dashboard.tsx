import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { GRADES, isJuniorGrade } from '@infoklas/shared';
import type { ClassDto, QuizSummaryDto } from '@infoklas/shared';
import { Empty, ErrorBox, Field, Modal, QueryState } from '../../components/ui';
import { api } from '../../lib/api';
import { countLabel } from '../../lib/format';

export function ClassForm({
  initial,
  onSubmit,
  onCancel,
  pending,
  error,
  submitLabel,
}: {
  initial?: { name: string; grade: number };
  onSubmit: (v: { name: string; grade: number }) => void;
  onCancel: () => void;
  pending: boolean;
  error: unknown;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [grade, setGrade] = useState(initial?.grade ?? 5);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name: name.trim(), grade });
      }}
    >
      <Field label="Назва класу" hint="Наприклад: 5-А">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
          maxLength={40}
        />
      </Field>
      <Field
        label="Рік навчання"
        hint={
          isJuniorGrade(grade)
            ? 'Початкова школа: вхід за картинками, без рейтингів і поспіху'
            : 'Вхід за простим паролем, у живих іграх є рейтинг'
        }
      >
        <select className="select" value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g} клас
            </option>
          ))}
        </select>
      </Field>
      <ErrorBox error={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Скасувати
        </button>
        <button className="btn" disabled={pending || !name.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function Dashboard() {
  const classes = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get<ClassDto[]>('/api/classes'),
  });
  const quizzes = useQuery({
    queryKey: ['quizzes'],
    queryFn: () => api.get<QuizSummaryDto[]>('/api/quizzes'),
  });
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const create = useMutation({
    mutationFn: (v: { name: string; grade: number }) => api.post<ClassDto>('/api/classes', v),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['classes'] });
      navigate(`/t/classes/${c.id}`);
    },
  });

  const isNew = classes.data?.length === 0 && quizzes.data?.length === 0;

  return (
    <main className="page">
      <div className="page-header">
        <h1>Мої класи</h1>
        <div className="actions">
          <button className="btn" onClick={() => setCreating(true)}>
            + Новий клас
          </button>
        </div>
      </div>

      {isNew && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2>Як почати 👋</h2>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>Створіть клас і додайте список учнів.</li>
            <li>Роздрукуйте картки входу: на них код класу та пароль кожного учня.</li>
            <li>
              Створіть тест у розділі <Link to="/t/quizzes">«Тести»</Link>.
            </li>
            <li>Дайте його як домашнє завдання або запустіть живу гру просто на уроці.</li>
          </ol>
        </div>
      )}

      <QueryState query={classes}>
        {(list) =>
          list.length === 0 ? (
            <Empty emoji="🏫">Ще немає жодного класу.</Empty>
          ) : (
            <div className="grid">
              {list.map((c) => (
                <Link key={c.id} to={`/t/classes/${c.id}`} className="card card-link">
                  <h3>{c.name}</h3>
                  <div className="row">
                    <span className="badge">{c.grade} клас</span>
                    {isJuniorGrade(c.grade) && (
                      <span className="badge badge-warning">початкова</span>
                    )}
                  </div>
                  <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
                    {countLabel(c.studentCount, ['учень', 'учні', 'учнів'])} · код {c.joinCode}
                  </p>
                </Link>
              ))}
            </div>
          )
        }
      </QueryState>

      {creating && (
        <Modal title="Новий клас" onClose={() => setCreating(false)}>
          <ClassForm
            onSubmit={(v) => create.mutate(v)}
            onCancel={() => setCreating(false)}
            pending={create.isPending}
            error={create.error}
            submitLabel="Створити"
          />
        </Modal>
      )}
    </main>
  );
}
