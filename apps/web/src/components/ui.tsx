import { useEffect, type ReactNode } from 'react';
import { errorMessage } from '../lib/api';

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Завантаження" />;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      {errorMessage(error)}
    </div>
  );
}

export function Empty({ emoji, children }: { emoji: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="emoji" aria-hidden>
        {emoji}
      </span>
      {children}
    </div>
  );
}

/** Renders loading/error states for a query, children once data is ready. */
export function QueryState<T>({
  query,
  children,
}: {
  query: { isPending: boolean; error: unknown; data: T | undefined };
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Spinner />;
  if (query.error) return <ErrorBox error={query.error} />;
  return <>{children(query.data as T)}</>;
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

export function ScoreBadge({ correct, total }: { correct: number; total: number }) {
  const p = total > 0 ? Math.round((100 * correct) / total) : 0;
  const level = p >= 75 ? 'high' : p >= 50 ? 'mid' : 'low';
  return (
    <span className={`score score-${level}`} title={`${correct} з ${total}`}>
      {p}%
    </span>
  );
}
