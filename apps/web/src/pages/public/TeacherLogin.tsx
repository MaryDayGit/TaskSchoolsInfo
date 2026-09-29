import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import type { AuthConfigDto, TeacherDto } from '@infoklas/shared';
import { ErrorBox, Field, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useTeacher } from '../../lib/session';

export function TeacherLogin() {
  const me = useTeacher();
  const config = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api.get<AuthConfigDto>('/api/auth/config'),
  });
  const [params] = useSearchParams();
  const next = params.get('next');
  const target = next && next.startsWith('/t') ? next : '/t';
  const [mode, setMode] = useState<'login' | 'register' | null>(null);
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const qc = useQueryClient();
  const navigate = useNavigate();

  const submit = useMutation({
    mutationFn: (m: 'login' | 'register') =>
      api.post<TeacherDto>(m === 'login' ? '/api/auth/login' : '/api/auth/register', form),
    onSuccess: (t) => {
      qc.setQueryData(['teacher-me'], t);
      navigate(target, { replace: true });
    },
  });

  if (me.data) return <Navigate to={target} replace />;
  if (config.isPending || me.isPending) return <Spinner />;

  // With no teachers yet, the first visit is the registration of the owner.
  const signupOpen = config.data?.teacherSignupOpen ?? false;
  const current = mode ?? 'login';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate(current);
  };
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <main className="page page-narrow">
      <Link to="/" className="back-link">
        ← На головну
      </Link>
      <div className="card">
        <form className="stack" onSubmit={onSubmit}>
          <h1>{current === 'login' ? 'Вхід для вчителя' : 'Реєстрація вчителя'}</h1>
          {current === 'register' && (
            <Field label="Ім'я та по батькові" hint="Так вас бачитимуть учні">
              <input
                className="input"
                value={form.name}
                onChange={set('name')}
                required
                autoComplete="name"
              />
            </Field>
          )}
          <Field label="Електронна пошта">
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={set('email')}
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Пароль" hint={current === 'register' ? 'Щонайменше 8 символів' : undefined}>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={set('password')}
              required
              autoComplete={current === 'login' ? 'current-password' : 'new-password'}
            />
          </Field>
          <ErrorBox error={submit.error} />
          <button className="btn btn-lg btn-block" disabled={submit.isPending}>
            {current === 'login' ? 'Увійти' : 'Зареєструватися'}
          </button>
          {signupOpen && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                submit.reset();
                setMode(current === 'login' ? 'register' : 'login');
              }}
            >
              {current === 'login' ? 'Ще немає акаунта? Зареєструватися' : 'Уже є акаунт? Увійти'}
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
