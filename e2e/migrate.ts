/*
 * Данные прежних проектов в эмуляторе для сценария этапа 6: история Клас-пульта
 * (только его коллекции тестов и результатов: код учителя сценариев не трогаем)
 * и немного ІнфоКласа (класс с учеником, домашнее задание со сдачей, игра).
 * Перенос выполняется теми же функциями, что и tools/migrate/migrate.ts.
 */
import type { Question } from '@infoklas/shared';
import { connect } from '../tools/migrate/admin';
import { decode } from '../tools/migrate/dump';
import type { InfoKlasRows } from '../tools/migrate/infoklas';
import { planInfoKlas } from '../tools/migrate/infoklas';
import { planKlasPult } from '../tools/migrate/klaspult';
import { applyPlan, readTarget } from '../tools/migrate/store';
import { klasPultFixture, seeded } from '../tools/migrate/test/fixtures';

let admin: ReturnType<typeof connect> | null = null;
const db = () => (admin ??= connect('demo-klas-pult')).db;

export async function migrateKlasPult() {
  const old = klasPultFixture().filter((d) =>
    ['tests/', 'keys/', 'sessions/', 'results/'].some((p) => d.path.startsWith(p)),
  );
  const bulk = db().bulkWriter();
  for (const d of old) {
    void bulk.set(db().doc(d.path), decode(db(), d.data) as FirebaseFirestore.DocumentData);
  }
  await bulk.close();
  const plan = planKlasPult(old, await readTarget(db()), {
    grades: { Гурток: 7, 'Без назви': 5 },
    random: seeded(11),
  });
  return applyPlan(db(), plan.writes);
}

const Q: Question[] = [
  {
    id: 'q1',
    type: 'single',
    prompt: 'Скільки бітів у байті?',
    timeLimitSec: 20,
    options: [
      { id: 'a', text: '4' },
      { id: 'b', text: '8' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q2',
    type: 'text',
    prompt: 'Найменша одиниця інформації?',
    timeLimitSec: 30,
    acceptedAnswers: ['біт'],
  },
];
export const INFOKLAS = { code: '424242', name: 'Софія Л.', password: 'Ракета47' };

export async function migrateInfoKlas() {
  const at = new Date('2026-09-15T08:00:00Z');
  const rows: InfoKlasRows = {
    classes: [{ id: 'ik-9a', name: '9-А', grade: 9, join_code: INFOKLAS.code, created_at: at }],
    students: [
      {
        id: 'ik-sofia',
        class_id: 'ik-9a',
        display_name: INFOKLAS.name,
        secret_kind: 'password',
        secret: INFOKLAS.password,
        created_at: at,
      },
    ],
    quizzes: [{ id: 'ik-quiz', title: 'Одиниці', questions: Q, created_at: at, updated_at: at }],
    assignments: [
      {
        id: 'ik-hw',
        class_id: 'ik-9a',
        quiz_id: 'ik-quiz',
        title: 'Одиниці (дз)',
        questions: Q,
        due_at: null,
        max_attempts: 1,
        show_correct: true,
        created_at: at,
      },
    ],
    submissions: [
      {
        id: 's1',
        assignment_id: 'ik-hw',
        student_id: 'ik-sofia',
        attempt: 1,
        answers: { q1: 'b', q2: 'байт' },
        submitted_at: at,
      },
    ],
    live_sessions: [
      {
        id: 'ik-game',
        class_id: 'ik-9a',
        quiz_id: 'ik-quiz',
        title: 'Бліц',
        questions: Q,
        status: 'finished',
        created_at: at,
        ended_at: at,
      },
    ],
    live_results: [
      {
        session_id: 'ik-game',
        student_id: 'ik-sofia',
        score: 1400,
        correct_count: 2,
        total: 2,
        answers: {},
      },
    ],
  };
  const plan = planInfoKlas(rows, await readTarget(db()), { random: seeded(12) });
  return applyPlan(db(), plan.writes);
}

export async function closeAdmin() {
  await admin?.db.terminate();
}
