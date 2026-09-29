import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Своё модальное окно вместо window.confirm/prompt/alert: встроенные браузеры
 * (в т.ч. в приложениях) не показывают системные окна и сразу отвечают
 * «отмена». Урок Клас-пульта; линтер запрещает window.confirm/prompt/alert.
 */
export interface ConfirmOptions {
  title: string;
  text?: string;
  ok?: string;
  cancel?: string;
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const DialogContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })),
    [],
  );
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <DialogContext.Provider value={confirm}>
      {children}
      {pending && <DialogView p={pending} onClose={close} />}
    </DialogContext.Provider>
  );
}

function DialogView({ p, onClose }: { p: Pending; onClose: (ok: boolean) => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}
    >
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">{p.title}</h2>
        {p.text && <p>{p.text}</p>}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => onClose(false)}>
            {p.cancel ?? 'Скасувати'}
          </button>
          <button
            ref={okRef}
            className={`btn${p.danger ? ' btn-danger' : ''}`}
            onClick={() => onClose(true)}
          >
            {p.ok ?? 'Так'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useConfirm must be used inside <DialogProvider>');
  return ctx;
}
