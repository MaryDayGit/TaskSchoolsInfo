import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { decodePictureSecret, getPicture } from '@infoklas/shared';
import type { ClassDto, StudentDto } from '@infoklas/shared';
import { Empty, ErrorBox, Field, QueryState } from '../../components/ui';
import { api } from '../../lib/api';

function Secret({ s }: { s: StudentDto }) {
  if (s.secretKind === 'pictures') {
    const pics = decodePictureSecret(s.secret).map((p) => getPicture(p));
    return (
      <span style={{ fontSize: '1.4rem' }} title={pics.map((p) => p?.label).join(', ')}>
        {pics.map((p) => p?.emoji ?? '?').join(' ')}
      </span>
    );
  }
  return <code style={{ fontSize: '1.05rem', fontWeight: 700 }}>{s.secret}</code>;
}

export function StudentsTab({ cls }: { cls: ClassDto }) {
  const qc = useQueryClient();
  const students = useQuery({
    queryKey: ['students', cls.id],
    queryFn: () => api.get<StudentDto[]>(`/api/classes/${cls.id}/students`),
  });
  const [names, setNames] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['students', cls.id] });
    void qc.invalidateQueries({ queryKey: ['class', cls.id] });
    void qc.invalidateQueries({ queryKey: ['classes'] });
  };

  const add = useMutation({
    mutationFn: (list: string[]) =>
      api.post<StudentDto[]>(`/api/classes/${cls.id}/students`, { names: list }),
    onSuccess: () => {
      setNames('');
      refresh();
    },
  });
  const rename = useMutation({
    mutationFn: ({ id, displayName }: { id: string; displayName: string }) =>
      api.patch(`/api/students/${id}`, { displayName }),
    onSuccess: refresh,
  });
  const reset = useMutation({
    mutationFn: (id: string) => api.post(`/api/students/${id}/reset-secret`),
    onSuccess: () => {
      setShowSecrets(true);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/students/${id}`),
    onSuccess: refresh,
  });

  const parsed = names
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed.length) add.mutate(parsed);
          }}
        >
          <Field
            label="Додати учнів"
            hint="Кожне ім'я з нового рядка. Можна вставити список з таблиці. Радимо: ім'я та перша літера прізвища."
          >
            <textarea
              className="textarea"
              rows={4}
              value={names}
              onChange={(e) => setNames(e.target.value)}
              placeholder={'Оля К.\nПетро М.\nСофія Д.'}
            />
          </Field>
          <ErrorBox error={add.error} />
          <div className="row">
            <button className="btn" disabled={!parsed.length || add.isPending}>
              Додати {parsed.length > 0 ? `(${parsed.length})` : ''}
            </button>
          </div>
        </form>
      </div>

      <QueryState query={students}>
        {(list) =>
          list.length === 0 ? (
            <Empty emoji="🧒">Додайте учнів, щоб вони могли увійти.</Empty>
          ) : (
            <>
              <div className="row">
                <Link to={`/t/classes/${cls.id}/cards`} className="btn btn-secondary">
                  🖨 Картки входу
                </Link>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={showSecrets}
                    onChange={(e) => setShowSecrets(e.target.checked)}
                  />
                  Показати паролі
                </label>
              </div>
              <ErrorBox error={rename.error || reset.error || remove.error} />
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Учень</th>
                      <th>{cls.grade <= 4 ? 'Картинки' : 'Пароль'}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 700 }}>{s.displayName}</td>
                        <td>
                          {showSecrets ? <Secret s={s} /> : <span className="muted">••••••</span>}
                        </td>
                        <td className="nowrap" style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              const n = window.prompt("Нове ім'я", s.displayName)?.trim();
                              if (n && n !== s.displayName)
                                rename.mutate({ id: s.id, displayName: n });
                            }}
                          >
                            Змінити
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Видати новий пароль для «${s.displayName}»? Старий перестане працювати.`,
                                )
                              ) {
                                reset.mutate(s.id);
                              }
                            }}
                          >
                            Новий пароль
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Видалити «${s.displayName}» разом з усіма результатами?`,
                                )
                              ) {
                                remove.mutate(s.id);
                              }
                            }}
                          >
                            Видалити
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        }
      </QueryState>
    </div>
  );
}
