import { Link, Route, Routes } from 'react-router';
import { Brand } from '../components/Brand';
import { CardsPage } from './CardsPage';
import { ClassPage } from './ClassPage';
import { ClassesPage } from './ClassesPage';
import { TeacherGate, useTeacher } from './TeacherGate';

function TeacherLayout() {
  const { logout } = useTeacher();
  return (
    <>
      <header className="topbar no-print">
        <div className="topbar-inner">
          <Link to="/t" className="brand">
            <Brand /> ІнфоКлас
          </Link>
          <span className="badge">попередня версія</span>
          <button className="btn btn-ghost btn-sm topbar-end" onClick={logout}>
            Вийти
          </button>
        </div>
      </header>
      <Routes>
        <Route index element={<ClassesPage />} />
        <Route path="classes/:id" element={<ClassPage />} />
        <Route path="classes/:id/cards" element={<CardsPage />} />
      </Routes>
    </>
  );
}

/** Кабинет учителя грузится отдельной частью: страница ученика на слабых ПК легче. */
export default function TeacherApp() {
  return (
    <TeacherGate>
      <TeacherLayout />
    </TeacherGate>
  );
}
