import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { DialogProvider } from './components/Dialog';
import { StudentApp } from './student/StudentApp';

const TeacherApp = lazy(() => import('./teacher'));
const Loading = () => <div className="spinner" role="status" aria-label="Завантаження" />;

function NotFound() {
  return (
    <main className="page center">
      <h1>Сторінку не знайдено</h1>
      <Link to="/" className="btn">
        На головну
      </Link>
    </main>
  );
}

export function App() {
  return (
    <DialogProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<StudentApp />} />
          {/* Ссылка для Google Classroom и карточек: сразу открывает класс по коду. */}
          <Route path="/join/:code" element={<StudentApp />} />
          <Route
            path="/t/*"
            element={
              <Suspense fallback={<Loading />}>
                <TeacherApp />
              </Suspense>
            }
          />
          {/* Старая закладка пульта Клас-пульта ведёт в кабинет. */}
          <Route path="/admin.html" element={<Navigate to="/t" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </DialogProvider>
  );
}
