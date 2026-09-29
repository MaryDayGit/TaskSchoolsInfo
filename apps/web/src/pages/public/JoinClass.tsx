import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { PICTURES, PICTURE_SECRET_LENGTH, encodePictureSecret, getPicture } from '@infoklas/shared';
import type { ClassPublicDto, StudentMeDto } from '@infoklas/shared';
import { ErrorBox, QueryState } from '../../components/ui';
import { api } from '../../lib/api';

/** Only allow in-app redirects after login. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/s';
}

export function JoinCode() {
  const [code, setCode] = useState('');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 6) {
      navigate(`/join/${code}${next ? `?next=${encodeURIComponent(next)}` : ''}`);
    }
  };

  return (
    <main className="page page-narrow">
      <Link to="/" className="back-link">
        ← На головну
      </Link>
      <div className="card">
        <form onSubmit={submit} className="stack">
          <h1 className="center">Введи код класу</h1>
          <p className="muted center">Код тобі скаже вчитель. Він складається з 6 цифр.</p>
          <input
            className="input code-input"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••••"
            aria-label="Код класу"
          />
          <button className="btn btn-lg btn-block" disabled={code.length !== 6}>
            Далі →
          </button>
        </form>
      </div>
    </main>
  );
}

export function JoinClass() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const cls = useQuery({
    queryKey: ['join', code],
    queryFn: () => api.get<ClassPublicDto>(`/api/join/${code}`),
    retry: false,
  });
  const [studentId, setStudentId] = useState<string | null>(null);

  return (
    <main className={`page page-narrow${cls.data?.junior ? ' junior' : ''}`}>
      <Link to="/join" className="back-link">
        ← Інший код
      </Link>
      <QueryState query={cls}>
        {(c) => {
          const student = c.students.find((s) => s.id === studentId);
          return (
            <div className="card">
              <p className="center">
                <span className="badge">Клас {c.name}</span>
              </p>
              {!student ? (
                <>
                  <h1 className="center">Хто ти?</h1>
                  {c.students.length === 0 ? (
                    <p className="muted center">
                      У класі ще немає учнів. Попроси вчителя додати тебе.
                    </p>
                  ) : (
                    <div className="name-grid">
                      {c.students.map((s) => (
                        <button key={s.id} className="name-btn" onClick={() => setStudentId(s.id)}>
                          {s.displayName}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <SecretStep
                  code={code}
                  junior={c.junior}
                  student={student}
                  next={next}
                  onBack={() => setStudentId(null)}
                />
              )}
            </div>
          );
        }}
      </QueryState>
    </main>
  );
}

function SecretStep({
  code,
  junior,
  student,
  next,
  onBack,
}: {
  code: string;
  junior: boolean;
  student: { id: string; displayName: string };
  next: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [pictures, setPictures] = useState<string[]>([]);
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: (secret: string) =>
      api.post<StudentMeDto>('/api/student/login', {
        classCode: code,
        studentId: student.id,
        secret,
      }),
    onSuccess: (me) => {
      qc.setQueryData(['student-me'], me);
      navigate(next, { replace: true });
    },
    onError: () => setPictures([]),
  });

  // Picture passwords submit automatically once all slots are filled.
  const addPicture = (id: string) => {
    const nextPictures = [...pictures, id];
    setPictures(nextPictures);
    if (nextPictures.length === PICTURE_SECRET_LENGTH) {
      login.mutate(encodePictureSecret(nextPictures));
    }
  };

  return (
    <div className="stack">
      <h1 className="center">Привіт, {student.displayName}!</h1>
      {junior ? (
        <>
          <p className="center muted">Натисни свої {PICTURE_SECRET_LENGTH} картинки по черзі</p>
          <div className="picture-slots" aria-live="polite">
            {Array.from({ length: PICTURE_SECRET_LENGTH }, (_, i) => {
              const p = pictures[i] ? getPicture(pictures[i]) : undefined;
              return (
                <div key={i} className={`picture-slot${p ? ' filled' : ''}`}>
                  {p?.emoji ?? ''}
                </div>
              );
            })}
          </div>
          <div className="picture-grid">
            {PICTURES.map((p) => (
              <button
                key={p.id}
                className="picture-btn"
                aria-label={p.label}
                title={p.label}
                disabled={login.isPending || pictures.length >= PICTURE_SECRET_LENGTH}
                onClick={() => addPicture(p.id)}
              >
                {p.emoji}
              </button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setPictures((cur) => cur.slice(0, -1))}
              disabled={pictures.length === 0 || login.isPending}
            >
              ⌫ Стерти
            </button>
          </div>
        </>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.trim()) login.mutate(password);
          }}
        >
          <input
            className="input"
            style={{ fontSize: '1.3rem', minHeight: 56 }}
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Твій пароль"
            aria-label="Пароль"
          />
          <button className="btn btn-lg btn-block" disabled={login.isPending || !password.trim()}>
            Увійти
          </button>
        </form>
      )}
      <ErrorBox error={login.error} />
      <button className="btn btn-ghost" onClick={onBack}>
        Це не я
      </button>
    </div>
  );
}
