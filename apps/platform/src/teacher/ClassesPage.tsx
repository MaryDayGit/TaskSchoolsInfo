import { useState, type FormEvent } from 'react';
import { collection } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router';
import { db } from '../firebase/app';
import { errorText } from '../firebase/errors';
import { useQuery } from '../firebase/watch';
import { CLASS_NAME_MAX, createClass, type ClassDoc } from '../data/classes';
import { isJuniorGrade } from '../lib/secrets';
import { clean } from '../lib/text';
import { ErrorText, Modal, Spinner } from '../components/Modal';

export const GRADES = [2, 3, 4, 5, 6, 7, 8, 9];

export function ClassForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; grade: number };
  submitLabel: string;
  onSubmit: (name: string, grade: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [grade, setGrade] = useState(initial?.grade ?? 5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = clean(name, CLASS_NAME_MAX);
    if (!n) return setError('Вкажіть назву класу');
    setBusy(true);
    setError(null);
    try {
      await onSubmit(n, grade);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        <span>Назва класу</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={CLASS_NAME_MAX}
          autoFocus
          placeholder="Наприклад: 5-А"
        />
      </label>
      <label className="field">
        <span>Рік навчання</span>
        <select className="input" value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g} клас
            </option>
          ))}
        </select>
        <small className="hint">
          {isJuniorGrade(grade)
            ? 'Початкова школа: вхід за 4 картинками, без рейтингів і поспіху'
            : 'Вхід за простим паролем (слово і дві цифри)'}
        </small>
      </label>
      <ErrorText error={error} />
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Скасувати
        </button>
        <button className="btn" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function ClassesPage() {
  const classes = useQuery<ClassDoc>(collection(db, 'classes'), 'classes');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const list = classes.docs
    .filter((c) => !c.data.archived)
    .sort((a, b) => a.data.grade - b.data.grade || a.data.name.localeCompare(b.data.name, 'uk'));

  return (
    <main className="page">
      <div className="page-header">
        <h1>Мої класи</h1>
        <button className="btn" onClick={() => setCreating(true)}>
          + Новий клас
        </button>
      </div>
      <ErrorText error={classes.error} />
      {classes.loading ? (
        <Spinner />
      ) : list.length === 0 ? (
        <div className="card empty">
          <p>
            Ще немає жодного класу. Створіть клас і додайте учнів: вони зможуть увійти за кодом
            класу.
          </p>
        </div>
      ) : (
        <div className="grid">
          {list.map((c) => (
            <Link key={c.id} to={`/t/classes/${c.id}`} className="card card-link">
              <h2>{c.data.name}</h2>
              <p className="row">
                <span className="badge">{c.data.grade} клас</span>
                {isJuniorGrade(c.data.grade) && <span className="badge badge-warn">початкова</span>}
              </p>
              <p className="muted small">Код класу: {c.data.joinCode}</p>
            </Link>
          ))}
        </div>
      )}
      {creating && (
        <Modal title="Новий клас" onClose={() => setCreating(false)}>
          <ClassForm
            submitLabel="Створити"
            onCancel={() => setCreating(false)}
            onSubmit={async (name, grade) => {
              const id = await createClass(name, grade);
              navigate(`/t/classes/${id}`);
            }}
          />
        </Modal>
      )}
    </main>
  );
}
