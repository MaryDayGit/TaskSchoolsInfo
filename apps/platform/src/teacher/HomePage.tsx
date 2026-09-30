import { useState } from 'react';
import { collection } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router';
import { db } from '../firebase/app';
import { useQuery } from '../firebase/watch';
import { createClass, rosterCol, type ClassDoc } from '../data/classes';
import { assignmentsCol } from '../data/assignments';
import { gamesCol } from '../data/games';
import { quizzesCol } from '../data/quizzes';
import { Icon, type IconName } from '../components/Icon';
import { ErrorText, Modal, Spinner } from '../components/Modal';
import { isJuniorGrade } from '../lib/secrets';
import { store } from '../lib/storage';
import { countLabel } from '../lib/text';
import { AssignModal } from './AssignModal';
import { ClassForm } from './ClassesPage';
import { CreateTestModal } from './CreateTestModal';
import { GameModal } from './GameModal';

type Dialog = 'class' | 'test' | 'game' | 'homework' | null;

/**
 * Головна кабінету: чотири великі дії, «З чого почати» для нового вчителя і
 * класи. Кожна дія відкривається одним натисканням.
 */
export function HomePage() {
  const classes = useQuery<ClassDoc>(collection(db, 'classes'), 'classes');
  const quizzes = useQuery(quizzesCol(), 'quizzes');
  const given = useQuery(assignmentsCol(), 'assignments');
  const games = useQuery(gamesCol(), 'games-all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [hideSteps, setHideSteps] = useState(() => store.get('hideFirstSteps', false));
  const navigate = useNavigate();

  const list = classes.docs
    .filter((c) => !c.data.archived)
    .sort((a, b) => a.data.grade - b.data.grade || a.data.name.localeCompare(b.data.name, 'uk'));
  const hasClass = list.length > 0;
  const hasTest = quizzes.docs.length > 0;
  const hasWork = given.docs.length > 0 || games.docs.length > 0;
  const needs = !hasClass ? 'Спочатку створіть клас' : !hasTest ? 'Спочатку створіть тест' : null;

  const actions: {
    icon: IconName;
    title: string;
    note: string;
    primary?: boolean;
    disabled?: string | null;
    onClick: () => void;
  }[] = [
    {
      icon: 'play',
      title: 'Почати урок',
      note: 'Посилання, тест і повідомлення на комп’ютери класу',
      primary: true,
      onClick: () => navigate('/t/lesson'),
    },
    {
      icon: 'edit',
      title: 'Створити тест',
      note: 'Вручну, з готового тексту або з шаблону',
      onClick: () => setDialog('test'),
    },
    {
      icon: 'star',
      title: 'Жива гра',
      note: 'Вікторина на проекторі: учні входять за кодом гри',
      disabled: needs,
      onClick: () => setDialog('game'),
    },
    {
      icon: 'send',
      title: 'Дати домашнє',
      note: 'Посилання для Classroom, результати — в журналі',
      disabled: needs,
      onClick: () => setDialog('homework'),
    },
  ];

  const steps = [
    { done: hasClass, title: 'Створіть клас і додайте учнів', go: () => setDialog('class') },
    {
      done: hasClass && list.length > 0 && !!store.get('printedCards', false),
      title: 'Роздрукуйте картки входу (код класу і пароль кожного учня)',
      go: () => list[0] && navigate(`/t/classes/${list[0].id}/cards`),
    },
    { done: hasTest, title: 'Створіть тест або візьміть шаблон', go: () => setDialog('test') },
    {
      done: hasWork,
      title: 'Проведіть урок, живу гру або дайте домашнє',
      go: () => navigate('/t/lesson'),
    },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <main className="page">
      <h1 className="home-title">Що робимо сьогодні?</h1>
      <section className="home-actions" aria-label="Головні дії">
        {actions.map((a) => (
          <button
            key={a.title}
            type="button"
            className={`action${a.primary ? ' action-primary' : ''}`}
            disabled={!!a.disabled}
            onClick={a.onClick}
          >
            <span className="action-icon">
              <Icon name={a.icon} size={28} />
            </span>
            <span className="action-title">{a.title}</span>
            <span className="action-note">{a.disabled ?? a.note}</span>
          </button>
        ))}
      </section>

      {!allDone && !hideSteps && !classes.loading && (
        <section className="card first-steps" aria-labelledby="first-steps-title">
          <div className="panel-head">
            <h2 id="first-steps-title" className="panel-title">
              З чого почати
            </h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                store.set('hideFirstSteps', true);
                setHideSteps(true);
              }}
            >
              Сховати
            </button>
          </div>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.title} className={s.done ? 'step done' : 'step'}>
                <span className="step-num" aria-hidden="true">
                  {s.done ? <Icon name="check" /> : i + 1}
                </span>
                <span className="grow">
                  {s.title}
                  {s.done && <span className="sr-only"> — зроблено</span>}
                </span>
                {!s.done && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={s.go}>
                    Зробити
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="page-header">
        <h2 className="section-title-inline">Мої класи</h2>
        <button className="btn btn-secondary" onClick={() => setDialog('class')}>
          + Новий клас
        </button>
      </div>
      <ErrorText error={classes.error} />
      {classes.loading ? (
        <Spinner />
      ) : !hasClass ? (
        <div className="card empty">
          <p>
            Ще немає жодного класу. Створіть клас і додайте учнів: вони зможуть увійти за кодом
            класу.
          </p>
        </div>
      ) : (
        <div className="grid">
          {list.map((c) => (
            <ClassCard key={c.id} id={c.id} c={c.data} />
          ))}
        </div>
      )}

      {dialog === 'class' && (
        <Modal title="Новий клас" onClose={() => setDialog(null)}>
          <ClassForm
            submitLabel="Створити"
            onCancel={() => setDialog(null)}
            onSubmit={async (name, grade) => {
              const id = await createClass(name, grade);
              navigate(`/t/classes/${id}`);
            }}
          />
        </Modal>
      )}
      {dialog === 'test' && <CreateTestModal onClose={() => setDialog(null)} />}
      {dialog === 'game' && <GameModal onClose={() => setDialog(null)} />}
      {dialog === 'homework' && <AssignModal onClose={() => setDialog(null)} />}
    </main>
  );
}

function ClassCard({ id, c }: { id: string; c: ClassDoc }) {
  const roster = useQuery(rosterCol(id), `roster:${id}`);
  return (
    <Link to={`/t/classes/${id}`} className="card card-link class-card">
      <h3 className="class-card-name">{c.name}</h3>
      <p className="row small">
        <span className="badge">{c.grade} клас</span>
        {isJuniorGrade(c.grade) && <span className="badge badge-warn">початкова</span>}
      </p>
      <p className="muted small">
        <Icon name="users" />{' '}
        {roster.loading ? '…' : countLabel(roster.docs.length, ['учень', 'учні', 'учнів'])}
        {' · '}код класу {c.joinCode}
      </p>
    </Link>
  );
}
