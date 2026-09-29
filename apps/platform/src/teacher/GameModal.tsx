import { useState } from 'react';
import { collection } from 'firebase/firestore';
import { useNavigate } from 'react-router';
import { db } from '../firebase/app';
import { errorText } from '../firebase/errors';
import { useQuery } from '../firebase/watch';
import type { ClassDoc } from '../data/classes';
import { createGame } from '../data/games';
import { quizzesCol, type QuizDoc } from '../data/quizzes';
import { ErrorText, Modal } from '../components/Modal';
import { isJuniorGrade } from '../lib/secrets';
import { questionsLabel } from '../lib/text';
import { byFolder } from './AssignModal';

/** «Жива гра»: a test from the bank for a class; opens the host screen. */
export function GameModal({
  classId: fixedClassId,
  quizId: fixedQuizId,
  onClose,
}: {
  classId?: string;
  quizId?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const classes = useQuery<ClassDoc>(collection(db, 'classes'), 'classes');
  const quizzes = useQuery<QuizDoc>(quizzesCol(), 'quizzes');
  const [classId, setClassId] = useState(fixedClassId ?? '');
  const [quizId, setQuizId] = useState(fixedQuizId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cls = classes.docs.find((c) => c.id === classId);
  const quiz = quizzes.docs.find((q) => q.id === quizId);

  const start = async () => {
    if (!cls || !quiz) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createGame(
        { id: cls.id, name: cls.data.name, junior: isJuniorGrade(cls.data.grade) },
        { id: quiz.id, title: quiz.data.title, questions: quiz.data.questions },
      );
      navigate(`/t/game/${id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Жива гра" onClose={onClose}>
      <div className="stack">
        <p className="hint">
          Питання з'являються на проекторі й у телефонах або на ПК учнів; бали — за правильність і
          швидкість (у 2–4 класі — без гонки й рейтингу). Результати потрапляють у журнал.
        </p>
        {!fixedClassId && (
          <label className="field">
            <span>Клас</span>
            <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Оберіть клас…</option>
              {[...classes.docs]
                .sort((a, b) => a.data.name.localeCompare(b.data.name, 'uk'))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.data.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {!fixedQuizId && (
          <label className="field">
            <span>Тест</span>
            <select className="input" value={quizId} onChange={(e) => setQuizId(e.target.value)}>
              <option value="">
                {quizzes.docs.length ? 'Оберіть тест…' : 'У банку ще немає тестів'}
              </option>
              {byFolder(quizzes.docs).map(([folder, list]) => (
                <optgroup key={folder} label={folder}>
                  {list.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.data.title} ({questionsLabel(q.data.questions.length)})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {fixedQuizId && quiz && <p className="muted">Тест «{quiz.data.title}»</p>}
        <ErrorText error={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn" disabled={busy || !cls || !quiz} onClick={() => void start()}>
            Відкрити гру
          </button>
        </div>
      </div>
    </Modal>
  );
}
