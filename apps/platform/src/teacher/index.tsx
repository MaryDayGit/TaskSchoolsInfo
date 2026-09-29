import { Link, NavLink, Route, Routes } from 'react-router';
import { Brand } from '../components/Brand';
import { CardsPage } from './CardsPage';
import { ClassPage } from './ClassPage';
import { AssignmentPage } from './AssignmentPage';
import { ClassesPage } from './ClassesPage';
import { QuizEditorPage } from './QuizEditorPage';
import { QuizzesPage } from './QuizzesPage';
import { LessonPage } from './lesson/LessonPage';
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
          <nav className="topnav" aria-label="Розділи">
            <NavLink to="/t/lesson">Урок</NavLink>
            <NavLink to="/t" end>
              Класи
            </NavLink>
            <NavLink to="/t/quizzes">Банк тестів</NavLink>
          </nav>
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
        <Route path="lesson" element={<LessonPage />} />
        <Route path="quizzes" element={<QuizzesPage />} />
        <Route path="quizzes/new" element={<QuizEditorPage />} />
        <Route path="quizzes/:id" element={<QuizEditorPage />} />
        <Route path="assignments/:id" element={<AssignmentPage />} />
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
