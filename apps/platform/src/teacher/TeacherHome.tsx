import { PICTURES } from '@infoklas/shared';
import { Brand } from '../components/Brand';
import { Picture } from '../components/Picture';
import { useTeacher } from './TeacherGate';

const STAGES = [
  { n: 1, title: 'Фундамент: Firebase, старі браузери, вхід учителя', done: true },
  { n: 2, title: 'Класи, учні, вхід учнів за картинками', done: false },
  { n: 3, title: 'Банк тестів і домашні завдання, журнал', done: false },
  { n: 4, title: 'Пульт уроку (усе з Клас-пульта)', done: false },
  { n: 5, title: 'Жива гра', done: false },
  { n: 6, title: 'Історія, перенесення даних', done: false },
];

export function TeacherHome() {
  const { logout } = useTeacher();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            <Brand /> ІнфоКлас
          </span>
          <span className="badge">Кабінет учителя · попередня версія</span>
          <button className="btn btn-ghost btn-sm topbar-end" onClick={logout}>
            Вийти
          </button>
        </div>
      </header>
      <main className="page">
        <h1>Єдина платформа ІнфоКлас</h1>
        <p className="muted">
          Тут з'являтимуться можливості ІнфоКласу та Клас-пульта в одному місці. Уроки поки що
          проводьте в Клас-пульті, як і раніше.
        </p>

        <section className="card">
          <h2>Етапи</h2>
          <ol className="stages">
            {STAGES.map((s) => (
              <li key={s.n} className={s.done ? 'done' : undefined}>
                <span className="stage-mark" aria-hidden="true" />
                {s.title}
                {s.done && <span className="sr-only"> (готово)</span>}
              </li>
            ))}
          </ol>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <h2>Картинки-паролі для 2–4 класів</h2>
          <p className="muted small">
            Нові картинки намальовано векторно, тому вони однаково виглядають і на старих ПК з
            Windows 7, і на телефонах.
          </p>
          <div className="picture-gallery">
            {PICTURES.map((p) => (
              <figure key={p.id}>
                <Picture id={p.id} size={64} />
                <figcaption>{p.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
