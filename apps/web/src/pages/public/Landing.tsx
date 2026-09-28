import { Link } from 'react-router';
import { useStudent, useTeacher } from '../../lib/session';

export function Landing() {
  const student = useStudent();
  const teacher = useTeacher();

  return (
    <main>
      <div className="hero">
        <img src="/icon.svg" alt="" width={72} height={72} />
        <h1>ІнфоКлас</h1>
        <p className="muted" style={{ fontSize: '1.15rem' }}>
          Тести, домашні завдання та ігри на уроках інформатики
        </p>
      </div>

      {(student.data || teacher.data) && (
        <div className="page page-narrow" style={{ paddingTop: 0, paddingBottom: 16 }}>
          <div className="stack">
            {student.data && (
              <Link to="/s" className="btn btn-lg btn-block">
                Продовжити як {student.data.displayName} →
              </Link>
            )}
            {teacher.data && (
              <Link to="/t" className="btn btn-lg btn-secondary btn-block">
                До кабінету вчителя →
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="role-cards">
        <Link to="/join" className="card card-link role-card">
          <span className="emoji" aria-hidden>
            🎒
          </span>
          Я учень / учениця
          <p className="muted small" style={{ fontWeight: 600, marginTop: 6 }}>
            Увійти з кодом класу
          </p>
        </Link>
        <Link to="/teacher/login" className="card card-link role-card">
          <span className="emoji" aria-hidden>
            🧑‍🏫
          </span>
          Я вчитель
          <p className="muted small" style={{ fontWeight: 600, marginTop: 6 }}>
            Кабінет вчителя
          </p>
        </Link>
      </div>
    </main>
  );
}
