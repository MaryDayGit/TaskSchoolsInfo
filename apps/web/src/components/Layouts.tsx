import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useStudent, useTeacher } from '../lib/session';
import { ErrorBox, Spinner } from './ui';

function Brand({ to }: { to: string }) {
  return (
    <Link to={to} className="brand">
      <img src="/icon.svg" alt="" />
      ІнфоКлас
    </Link>
  );
}

export function TeacherLayout() {
  const me = useTeacher();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  if (me.isPending) return <Spinner />;
  if (me.error) return <ErrorBox error={me.error} />;
  if (!me.data) {
    return <Navigate to={`/teacher/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    navigate('/');
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand to="/t" />
          <nav className="nav">
            <NavLink to="/t" end>
              Класи
            </NavLink>
            <NavLink to="/t/quizzes">Тести</NavLink>
          </nav>
          <div className="topbar-user">
            <span className="muted small">{me.data.name}</span>
            <button className="btn btn-ghost btn-sm" onClick={logout}>
              Вийти
            </button>
          </div>
        </div>
      </header>
      <Outlet />
    </>
  );
}

export function StudentLayout() {
  const me = useStudent();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  if (me.isPending) return <Spinner />;
  if (me.error) return <ErrorBox error={me.error} />;
  if (!me.data) {
    return <Navigate to={`/join?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  const logout = async () => {
    await api.post('/api/student/logout');
    qc.clear();
    navigate('/join');
  };

  return (
    <div className={me.data.junior ? 'junior' : undefined}>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand to="/s" />
          <div className="topbar-user">
            <span style={{ fontWeight: 800 }}>
              {me.data.junior ? '🙂 ' : ''}
              {me.data.displayName}
            </span>
            <span className="badge badge-muted">{me.data.className}</span>
            <button className="btn btn-secondary btn-sm" onClick={logout}>
              Вийти
            </button>
          </div>
        </div>
      </header>
      <Outlet context={me.data} />
    </div>
  );
}
