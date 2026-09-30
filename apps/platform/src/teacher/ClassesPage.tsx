import { useState, type FormEvent } from 'react';
import { errorText } from '../firebase/errors';
import { CLASS_NAME_MAX } from '../data/classes';
import { isJuniorGrade } from '../lib/secrets';
import { clean } from '../lib/text';
import { ErrorText } from '../components/Modal';

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
