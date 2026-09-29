import { Suspense, lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, RouterProvider, createBrowserRouter } from 'react-router';
import { StudentLayout, TeacherLayout } from './components/Layouts';
import { ApiError } from './lib/api';
import { JoinClass, JoinCode } from './pages/public/JoinClass';
import { Landing } from './pages/public/Landing';
import { TeacherLogin } from './pages/public/TeacherLogin';
import { LivePlay } from './pages/student/LivePlay';
import { StudentHome } from './pages/student/StudentHome';
import { TakeAssignment } from './pages/student/TakeAssignment';
import { Spinner } from './components/ui';

// Teacher pages are loaded on demand so students' phones download less.
const teacher = () => import('./pages/teacher');
const AssignmentResults = lazy(() => teacher().then((m) => ({ default: m.AssignmentResults })));
const ClassPage = lazy(() => teacher().then((m) => ({ default: m.ClassPage })));
const Dashboard = lazy(() => teacher().then((m) => ({ default: m.Dashboard })));
const LiveHost = lazy(() => teacher().then((m) => ({ default: m.LiveHost })));
const PrintCards = lazy(() => teacher().then((m) => ({ default: m.PrintCards })));
const QuizEditor = lazy(() => teacher().then((m) => ({ default: m.QuizEditor })));
const QuizList = lazy(() => teacher().then((m) => ({ default: m.QuizList })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't hammer the server with retries on auth/permission errors.
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

function NotFound() {
  return (
    <main className="page page-narrow center">
      <p style={{ fontSize: '3rem', margin: 0 }}>🤔</p>
      <h1>Сторінку не знайдено</h1>
      <Link to="/" className="btn">
        На головну
      </Link>
    </main>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/join', element: <JoinCode /> },
  { path: '/join/:code', element: <JoinClass /> },
  { path: '/teacher/login', element: <TeacherLogin /> },
  {
    path: '/t',
    element: <TeacherLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'classes/:id', element: <ClassPage /> },
      { path: 'classes/:id/cards', element: <PrintCards /> },
      { path: 'quizzes', element: <QuizList /> },
      { path: 'quizzes/new', element: <QuizEditor /> },
      { path: 'quizzes/:id', element: <QuizEditor /> },
      { path: 'assignments/:id', element: <AssignmentResults /> },
    ],
  },
  // Full-screen projector view, outside of the regular layout.
  { path: '/t/live/:id', element: <LiveHost /> },
  {
    path: '/s',
    element: <StudentLayout />,
    children: [
      { index: true, element: <StudentHome /> },
      { path: 'a/:id', element: <TakeAssignment /> },
      { path: 'live/:id', element: <LivePlay /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<Spinner />}>
        <RouterProvider router={router} />
      </Suspense>
    </QueryClientProvider>
  );
}
