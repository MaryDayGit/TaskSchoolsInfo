import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { isJuniorGrade } from '@infoklas/shared';
import type { ClassDto, LiveSessionDto } from '@infoklas/shared';
import { ErrorBox, Modal, QueryState } from '../../components/ui';
import { api } from '../../lib/api';
import { AssignModal, AssignmentsTab } from './AssignmentsTab';
import { ClassForm } from './Dashboard';
import { JournalTab } from './JournalTab';
import { QuizPicker } from './QuizPicker';
import { StudentsTab } from './StudentsTab';

type Tab = 'assignments' | 'students' | 'journal';
const TABS: { id: Tab; label: string }[] = [
  { id: 'assignments', label: 'Завдання' },
  { id: 'students', label: 'Учні' },
  { id: 'journal', label: 'Журнал' },
];

function LiveModal({ cls, onClose }: { cls: ClassDto; onClose: () => void }) {
  const [quizId, setQuizId] = useState('');
  const navigate = useNavigate();
  const start = useMutation({
    mutationFn: () => api.post<LiveSessionDto>('/api/live', { quizId, classId: cls.id }),
    onSuccess: (s) => navigate(`/t/live/${s.id}`),
  });
  return (
    <Modal title={`Жива гра для ${cls.name}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          start.mutate();
        }}
      >
        <p className="muted">
          Виведіть екран гри на проєктор. Учні заходять у свій кабінет (на уроці чи вдома) і бачать
          кнопку «Приєднатися».
        </p>
        <QuizPicker value={quizId} onChange={setQuizId} />
        <ErrorBox error={start.error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn" disabled={!quizId || start.isPending}>
            ▶ Почати
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SettingsModal({ cls, onClose }: { cls: ClassDto; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const update = useMutation({
    mutationFn: (v: { name: string; grade: number }) =>
      api.patch<ClassDto>(`/api/classes/${cls.id}`, v),
    onSuccess: (c) => {
      qc.setQueryData(['class', cls.id], c);
      void qc.invalidateQueries({ queryKey: ['classes'] });
      onClose();
    },
  });
  const regenerate = useMutation({
    mutationFn: () => api.post<ClassDto>(`/api/classes/${cls.id}/regenerate-code`),
    onSuccess: (c) => qc.setQueryData(['class', cls.id], c),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/classes/${cls.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['classes'] });
      navigate('/t');
    },
  });

  return (
    <Modal title="Налаштування класу" onClose={onClose}>
      <ClassForm
        initial={cls}
        onSubmit={(v) => update.mutate(v)}
        onCancel={onClose}
        pending={update.isPending}
        error={update.error}
        submitLabel="Зберегти"
      />
      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '20px 0' }} />
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          Якщо змінюєте рік навчання між початковою і середньою школою, видайте учням нові паролі.
        </p>
        <div className="row">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() =>
              window.confirm('Згенерувати новий код? Старий перестане працювати.') &&
              regenerate.mutate()
            }
          >
            Новий код класу
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() =>
              window.confirm(
                `Видалити клас ${cls.name} з усіма учнями та результатами? Це не можна скасувати.`,
              ) && remove.mutate()
            }
          >
            Видалити клас
          </button>
        </div>
        <ErrorBox error={regenerate.error || remove.error} />
      </div>
    </Modal>
  );
}

export function ClassPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'assignments') as Tab;
  const cls = useQuery({
    queryKey: ['class', id],
    queryFn: () => api.get<ClassDto>(`/api/classes/${id}`),
  });
  const [modal, setModal] = useState<'assign' | 'live' | 'settings' | null>(null);

  return (
    <main className="page">
      <Link to="/t" className="back-link">
        ← Усі класи
      </Link>
      <QueryState query={cls}>
        {(c) => (
          <>
            <div className="page-header">
              <div>
                <h1>Клас {c.name}</h1>
                <div className="row">
                  <span className="badge">{c.grade} клас</span>
                  {isJuniorGrade(c.grade) && (
                    <span className="badge badge-warning">початкова школа</span>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setModal('settings')}>
                    ⚙ Налаштування
                  </button>
                </div>
              </div>
              <div className="actions">
                <div className="card" style={{ padding: '8px 16px', textAlign: 'center' }}>
                  <div className="small muted">Код класу</div>
                  <div className="code-display" style={{ fontSize: '1.6rem' }}>
                    {c.joinCode}
                  </div>
                </div>
              </div>
            </div>

            <div className="row" style={{ marginBottom: 20 }}>
              <button className="btn btn-lg" onClick={() => setModal('live')}>
                🎮 Жива гра
              </button>
              <button className="btn btn-lg btn-secondary" onClick={() => setModal('assign')}>
                📝 Дати завдання
              </button>
            </div>

            <div className="tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`tab${tab === t.id ? ' active' : ''}`}
                  onClick={() => setParams({ tab: t.id }, { replace: true })}
                >
                  {t.label}
                  {t.id === 'students' ? ` (${c.studentCount})` : ''}
                </button>
              ))}
            </div>

            {tab === 'assignments' && <AssignmentsTab cls={c} />}
            {tab === 'students' && <StudentsTab cls={c} />}
            {tab === 'journal' && <JournalTab cls={c} />}

            {modal === 'assign' && <AssignModal cls={c} onClose={() => setModal(null)} />}
            {modal === 'live' && <LiveModal cls={c} onClose={() => setModal(null)} />}
            {modal === 'settings' && <SettingsModal cls={c} onClose={() => setModal(null)} />}
          </>
        )}
      </QueryState>
    </main>
  );
}
