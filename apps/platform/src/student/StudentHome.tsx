import { doc } from 'firebase/firestore';
import { db } from '../firebase/app';
import { useUser } from '../firebase/auth';
import { useDoc } from '../firebase/watch';
import { Brand } from '../components/Brand';

/**
 * Сторінка учня. Етап 1: перевіряє вхід і зв'язок із базою на старих ПК.
 * Вхід до класу з'явиться на етапі 2 (docs/platform/ROADMAP.md).
 */
export function StudentHome() {
  const { user, error } = useUser();
  const setup = useDoc(user ? doc(db, 'setup', 'state') : null);
  const online = user && !setup.loading && !setup.error && !setup.fromCache;

  return (
    <div className="student">
      <header className="student-bar">
        <span className="brand brand-light">
          <Brand /> ІнфоКлас
        </span>
      </header>
      <main className="student-main">
        <div className="task-card">
          <h1>Сторінка учня</h1>
          <p>Незабаром тут можна буде увійти до свого класу та виконувати завдання.</p>
          <p className="status-line" data-testid="connection">
            <span className={`dot ${online ? 'dot-ok' : 'dot-wait'}`} aria-hidden="true" />
            {online ? "Зв'язок є" : "Під'єднуємося…"}
          </p>
          {(error || setup.error) && (
            <p className="alert alert-error" role="alert">
              {error || setup.error}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
