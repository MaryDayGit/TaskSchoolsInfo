import { useState, type FormEvent } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { db } from '../firebase/app';
import { errorText } from '../firebase/errors';
import { useDoc, useQuery } from '../firebase/watch';
import {
  MAX_STUDENTS,
  NAME_MAX,
  addStudents,
  classRef,
  deleteClass,
  deleteStudent,
  logoutAllDevices,
  regenerateJoinCode,
  renameStudent,
  resetSecret,
  rosterCol,
  updateClass,
  type BindingDoc,
  type ClassDoc,
  type RosterDoc,
  type SecretDoc,
} from '../data/classes';
import { isJuniorGrade } from '../lib/secrets';
import { clean, countLabel, formatDateTime } from '../lib/text';
import { useConfirm } from '../components/Dialog';
import { ErrorText, Modal, Spinner } from '../components/Modal';
import { SecretView } from '../components/SecretView';
import { deleteClassWork } from '../data/assignments';
import { ClassForm } from './ClassesPage';
import { ClassWork } from './ClassWork';
import { JournalTab } from './JournalTab';

const TABS = [
  ['students', 'Учні'],
  ['work', 'Завдання'],
  ['journal', 'Журнал'],
] as const;
type Tab = (typeof TABS)[number][0];

export type Student = { id: string; data: RosterDoc };

export function ClassPage() {
  const { id = '' } = useParams();
  const cls = useDoc<ClassDoc>(classRef(id));
  const roster = useQuery<RosterDoc>(rosterCol(id), `roster:${id}`);
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some(([t]) => t === params.get('tab'))
    ? (params.get('tab') as Tab)
    : 'students';

  if (cls.loading) return <Spinner />;
  if (!cls.exists || !cls.data) {
    return (
      <main className="page">
        <ErrorText error={cls.error ?? 'Клас не знайдено'} />
        <Link to="/t" className="back-link">
          ← Усі класи
        </Link>
      </main>
    );
  }
  const c = cls.data;
  const students = [...roster.docs].sort((a, b) =>
    a.data.displayName.localeCompare(b.data.displayName, 'uk'),
  );

  return (
    <main className="page">
      <Link to="/t" className="back-link">
        ← Усі класи
      </Link>
      <ClassHeader id={id} c={c} />
      <div className="tabs" role="tablist">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`tab${tab === t ? ' active' : ''}`}
            onClick={() => setParams(t === 'students' ? {} : { tab: t }, { replace: true })}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'students' && (
        <>
          <AddStudents id={id} grade={c.grade} students={students} />
          <ErrorText error={roster.error} />
          {roster.loading ? (
            <Spinner />
          ) : (
            <StudentTable classId={id} grade={c.grade} students={students} />
          )}
        </>
      )}
      {tab === 'work' && <ClassWork classId={id} c={c} studentCount={students.length} />}
      {tab === 'journal' && <JournalTab classId={id} c={c} students={students} />}
    </main>
  );
}

function ClassHeader({ id, c }: { id: string; c: ClassDoc }) {
  const [settings, setSettings] = useState(false);
  return (
    <div className="page-header">
      <div>
        <h1>Клас {c.name}</h1>
        <p className="row">
          <span className="badge">{c.grade} клас</span>
          {isJuniorGrade(c.grade) && <span className="badge badge-warn">початкова школа</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => setSettings(true)}>
            Налаштування
          </button>
        </p>
      </div>
      <div className="row">
        <Link to={`/t/classes/${id}/cards`} className="btn btn-secondary">
          Картки входу
        </Link>
        <div className="card join-code" data-testid="join-code">
          <span className="muted small">Код класу</span>
          <strong>{c.joinCode}</strong>
        </div>
      </div>
      {settings && <SettingsModal id={id} c={c} onClose={() => setSettings(false)} />}
    </div>
  );
}

function SettingsModal({ id, c, onClose }: { id: string; c: ClassDoc; onClose: () => void }) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Modal title="Налаштування класу" onClose={onClose}>
      <ClassForm
        initial={c}
        submitLabel="Зберегти"
        onCancel={onClose}
        onSubmit={async (name, grade) => {
          await updateClass(id, name, grade);
          onClose();
        }}
      />
      <hr className="sep" />
      <p className="hint">
        Якщо клас перейшов з початкової школи (2–4) до 5 класу, видайте учням нові паролі: замість
        картинок будуть слова.
      </p>
      <div className="row">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() =>
            run(async () => {
              if (
                await confirm({
                  title: 'Новий код класу?',
                  text: 'Старий код перестане працювати. Учні, які вже увійшли, залишаться в системі.',
                  ok: 'Змінити код',
                })
              )
                await regenerateJoinCode(id, c.joinCode);
            })
          }
        >
          Новий код класу
        </button>
        <button
          className="btn btn-danger btn-sm"
          onClick={() =>
            run(async () => {
              if (
                await confirm({
                  title: `Видалити клас ${c.name}?`,
                  text: 'Разом з усіма учнями, їхніми паролями, завданнями та результатами. Скасувати не можна.',
                  ok: 'Видалити',
                  danger: true,
                })
              ) {
                await deleteClassWork(id);
                await deleteClass(id, c.joinCode);
                navigate('/t');
              }
            })
          }
        >
          Видалити клас
        </button>
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}

function AddStudents({ id, grade, students }: { id: string; grade: number; students: Student[] }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const names = [
    ...new Set(
      text
        .split('\n')
        .map((n) => clean(n, NAME_MAX))
        .filter(Boolean),
    ),
  ];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const existing = new Set(students.map((s) => s.data.displayName.toLowerCase()));
    const dup = names.filter((n) => existing.has(n.toLowerCase()));
    if (dup.length) {
      return setError(
        `У класі вже є: ${dup.join(', ')}. Додайте першу літеру прізвища, щоб учні не плутали себе.`,
      );
    }
    if (students.length + names.length > MAX_STUDENTS) {
      return setError(`У класі може бути не більше ${MAX_STUDENTS} учнів`);
    }
    setError(null);
    // The rows appear at once (Firestore writes locally first), so the field is
    // cleared now rather than after the server answers: that could take a while on
    // a weak connection and would wipe whatever the teacher typed meanwhile.
    setText('');
    addStudents(id, grade, names).catch((err: unknown) => {
      setError(errorText(err));
      setText((cur) => cur || names.join('\n'));
    });
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <label className="field">
        <span>Додати учнів</span>
        <textarea
          className="input textarea"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Оля К.\nПетро М.\nСофія Д.'}
        />
        <small className="hint">
          Кожне ім'я з нового рядка; можна вставити стовпчик із таблиці. Радимо: ім'я та перша
          літера прізвища.
        </small>
      </label>
      <ErrorText error={error} />
      <div>
        <button className="btn" disabled={names.length === 0}>
          Додати{names.length > 0 ? ` (${names.length})` : ''}
        </button>
      </div>
    </form>
  );
}

function StudentTable({
  classId,
  grade,
  students,
}: {
  classId: string;
  grade: number;
  students: Student[];
}) {
  const [showSecrets, setShowSecrets] = useState(false);
  const [renaming, setRenaming] = useState<Student | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const secrets = useQuery<SecretDoc>(
    showSecrets ? query(collection(db, 'studentSecrets'), where('classId', '==', classId)) : null,
    `secrets:${classId}:${showSecrets}`,
  );
  const bindings = useQuery<BindingDoc>(
    query(collection(db, 'bindings'), where('classId', '==', classId)),
    `bindings:${classId}`,
  );

  if (students.length === 0) {
    return (
      <div className="card empty">
        <p>Додайте учнів, щоб вони могли увійти.</p>
      </div>
    );
  }

  const secretOf = new Map(secrets.docs.map((d) => [d.id, d.data.secret]));
  const devicesOf = (studentId: string) =>
    bindings.docs.filter((b) => b.data.studentId === studentId).map((b) => b.data);

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <section className="stack" style={{ marginTop: 16 }}>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={showSecrets}
          onChange={(e) => setShowSecrets(e.target.checked)}
        />
        Показати паролі
      </label>
      <ErrorText error={error ?? secrets.error} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Учень</th>
              <th>Пароль</th>
              <th>Входи</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const secret = secretOf.get(s.id);
              const devices = devicesOf(s.id);
              const last = devices
                .map((d) => d.createdAt?.toDate())
                .filter((d): d is Date => !!d)
                .sort((a, b) => b.getTime() - a.getTime())[0];
              return (
                <tr key={s.id} data-testid={`student-${s.data.displayName}`}>
                  <td className="strong">{s.data.displayName}</td>
                  <td>
                    {showSecrets && secret ? (
                      <SecretView kind={s.data.secretKind} secret={secret} />
                    ) : (
                      <span className="muted">
                        {s.data.secretKind === 'pictures' ? 'картинки' : 'слово'} · ••••
                      </span>
                    )}
                  </td>
                  <td className="small">
                    {devices.length === 0 ? (
                      <span className="muted">ще не входив(ла)</span>
                    ) : (
                      <span title={devices.map((d) => d.device).join('\n')}>
                        {countLabel(devices.length, ['пристрій', 'пристрої', 'пристроїв'])}
                        {last && <span className="muted"> · {formatDateTime(last)}</span>}
                      </span>
                    )}
                  </td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setRenaming(s)}>
                      Змінити
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        act(async () => {
                          if (
                            await confirm({
                              title: `Новий пароль для «${s.data.displayName}»?`,
                              text: 'Старий пароль перестане працювати на всіх пристроях.',
                              ok: 'Видати новий',
                            })
                          ) {
                            await resetSecret(classId, s.id, grade);
                            setShowSecrets(true);
                          }
                        })
                      }
                    >
                      Новий пароль
                    </button>
                    {devices.length > 0 && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          act(async () => {
                            if (
                              await confirm({
                                title: 'Вийти з усіх пристроїв?',
                                text: `«${s.data.displayName}» доведеться знову ввести пароль.`,
                                ok: 'Вийти',
                              })
                            )
                              await logoutAllDevices(s.id);
                          })
                        }
                      >
                        Вийти з усіх пристроїв
                      </button>
                    )}
                    <button
                      className="btn btn-danger-ghost btn-sm"
                      onClick={() =>
                        act(async () => {
                          if (
                            await confirm({
                              title: `Видалити «${s.data.displayName}»?`,
                              text: 'Учень зникне зі списку класу.',
                              ok: 'Видалити',
                              danger: true,
                            })
                          )
                            await deleteStudent(classId, s.id);
                        })
                      }
                    >
                      Видалити
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {renaming && (
        <RenameModal
          student={renaming}
          taken={students
            .filter((s) => s.id !== renaming.id)
            .map((s) => s.data.displayName.toLowerCase())}
          onClose={() => setRenaming(null)}
          onSave={(name) => renameStudent(classId, renaming.id, name)}
        />
      )}
    </section>
  );
}

function RenameModal({
  student,
  taken,
  onClose,
  onSave,
}: {
  student: Student;
  taken: string[];
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(student.data.displayName);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = clean(name, NAME_MAX);
    if (!n) return setError("Вкажіть ім'я");
    if (taken.includes(n.toLowerCase())) return setError('У класі вже є учень з таким іменем');
    try {
      await onSave(n);
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Modal title="Змінити ім'я" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={NAME_MAX}
        />
        <ErrorText error={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn">Зберегти</button>
        </div>
      </form>
    </Modal>
  );
}
