import { collection, query, where } from 'firebase/firestore';
import { Link, useParams } from 'react-router';
import { db } from '../firebase/app';
import { useDoc, useQuery } from '../firebase/watch';
import { classRef, rosterCol, type ClassDoc, type RosterDoc, type SecretDoc } from '../data/classes';
import { ErrorText, Spinner } from '../components/Modal';
import { SecretView } from '../components/SecretView';

/** Login cards to print, cut and hand out (or screenshot one for an online lesson). */
export function CardsPage() {
  const { id = '' } = useParams();
  const cls = useDoc<ClassDoc>(classRef(id));
  const roster = useQuery<RosterDoc>(rosterCol(id), `roster:${id}`);
  const secrets = useQuery<SecretDoc>(
    query(collection(db, 'studentSecrets'), where('classId', '==', id)),
    `secrets:${id}`,
  );
  const site = window.location.host;

  if (cls.loading || roster.loading || secrets.loading) return <Spinner />;
  const secretOf = new Map(secrets.docs.map((d) => [d.id, d.data.secret]));
  const students = [...roster.docs].sort((a, b) =>
    a.data.displayName.localeCompare(b.data.displayName, 'uk'),
  );

  return (
    <main className="page">
      <div className="no-print">
        <Link to={`/t/classes/${id}`} className="back-link">
          ← До класу
        </Link>
        <div className="page-header">
          <h1>Картки входу{cls.data ? ` · ${cls.data.name}` : ''}</h1>
          <button className="btn" onClick={() => window.print()}>
            Друкувати
          </button>
        </div>
        <p className="muted">
          Розріжте картки й роздайте учням. Для онлайн-уроку можна надіслати кожному його картку
          особисто.
        </p>
        <ErrorText error={cls.error ?? roster.error ?? secrets.error} />
      </div>
      <div className="cards-print">
        {students.map((s) => {
          const secret = secretOf.get(s.id);
          return (
            <div key={s.id} className="login-card" data-testid="login-card">
              <div className="login-card-name">{s.data.displayName}</div>
              <div className="small">
                Сайт: <b>{site}</b> · Клас {cls.data?.name} · Код класу: <b>{cls.data?.joinCode}</b>
              </div>
              <div className="small muted">
                {s.data.secretKind === 'pictures' ? 'Мої картинки (по черзі):' : 'Мій пароль:'}
              </div>
              {secret ? <SecretView kind={s.data.secretKind} secret={secret} size={44} /> : '—'}
            </div>
          );
        })}
      </div>
    </main>
  );
}
