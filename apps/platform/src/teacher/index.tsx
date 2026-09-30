import { Link, NavLink, Route, Routes } from 'react-router';
import { Brand } from '../components/Brand';
import { CardsPage } from './CardsPage';
import { ClassPage } from './ClassPage';
import { AssignmentPage } from './AssignmentPage';
import { GameHostPage } from './GameHost';
import { HistoryPage } from './HistoryPage';
import { HomePage } from './HomePage';
import { QuizEditorPage } from './QuizEditorPage';
import { QuizzesPage } from './QuizzesPage';
import { LessonPage } from './lesson/LessonPage';
import { TeacherGate, useTeacher } from './TeacherGate';
import { ThemeSwitcher, useTeacherTheme } from './theme';

function TeacherLayout() {
  const { logout } = useTeacher();
  const [theme, setTheme] = useTeacherTheme();
  return (
    <>
      <header className="topbar no-print">
        <div className="topbar-inner">
          <Link to="/t" className="brand">
            <Brand /> ІнфоКлас
          </Link>
          <nav className="topnav" aria-label="Розділи">
            <NavLink to="/t" end>
              Головна
            </NavLink>
            <NavLink to="/t/lesson">Урок</NavLink>
            <NavLink to="/t/quizzes">Тести</NavLink>
            <NavLink to="/t/history">Історія</NavLink>
          </nav>
          <div className="topbar-end row">
            <ThemeSwitcher theme={theme} onChange={setTheme} />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Вийти
          </button>
        </div>
      </header>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="classes/:id" element={<ClassPage />} />
        <Route path="classes/:id/cards" element={<CardsPage />} />
        <Route path="lesson" element={<LessonPage />} />
        <Route path="quizzes" element={<QuizzesPage />} />
        <Route path="quizzes/new" element={<QuizEditorPage />} />
        <Route path="quizzes/:id" element={<QuizEditorPage />} />
        <Route path="assignments/:id" element={<AssignmentPage />} />
        <Route path="game/:id" element={<GameHostPage />} />
        <Route path="history" element={<HistoryPage />} />
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
