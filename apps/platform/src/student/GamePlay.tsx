import { useEffect, useState } from 'react';
import { getDoc } from 'firebase/firestore';
import type { AnswerValue } from '@infoklas/shared/grading';
import { useUser } from '../firebase/auth';
import { serverNow, syncClock, useClockReady } from '../firebase/clock';
import { errorText, isPermissionDenied } from '../firebase/errors';
import { useDoc } from '../firebase/watch';
import {
  answerGame,
  gameAnswerRef,
  gamePlayerRef,
  gameRef,
  joinGame,
  type GameDoc,
} from '../data/games';
import { Icon } from '../components/Icon';
import { ErrorText, Spinner } from '../components/Modal';
import { QuestionInput, hasAnswer } from './Homework';

// Экран ученика в живой игре (ІнфоКлас LivePlay): лобби, вопрос с отсчётом,
// «Відповідь прийнято», результат вопроса, итог. Баллы считает ведущий.

export default function GamePlay({
  gameId,
  studentId,
  onBack,
}: {
  gameId: string;
  studentId: string;
  onBack: () => void;
}) {
  const { user } = useUser();
  const game = useDoc<GameDoc>(gameRef(gameId));
  const clockReady = useClockReady();
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (user) syncClock(user.uid).catch(() => {});
  }, [user]);

  // «Я в грі»: once; a second create is refused by the rules — then we are already in.
  useEffect(() => {
    let cancelled = false;
    getDoc(gamePlayerRef(gameId, studentId))
      .then((snap) => (snap.exists() ? undefined : joinGame(gameId, studentId)))
      .catch((err: unknown) => {
        if (!cancelled && !isPermissionDenied(err)) setJoinError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, studentId]);

  const g = game.data;
  let body;
  if (game.loading) body = <Spinner />;
  else if (!g) body = <ErrorText error="Гру не знайдено." />;
  else if (g.status === 'lobby') {
    body = (
      <div className="stack center">
        <h1>{g.title}</h1>
        <p className="waiting">
          <span className="pulse-dot" aria-hidden="true" /> Чекаємо, коли вчитель почне гру
        </p>
      </div>
    );
  } else if (g.status === 'question') {
    body = (
      <Question key={g.index} gameId={gameId} studentId={studentId} g={g} clockReady={clockReady} />
    );
  } else if (g.status === 'reveal') {
    const me = g.players?.[studentId];
    const place = rank(g, studentId);
    body = (
      <div className="stack center" data-testid="game-reveal">
        {me?.last ? (
          <p className={`game-result ${me.last.correct ? 'ok' : 'bad'}`}>
            <Icon name={me.last.correct ? 'check' : 'cross'} size={28} />{' '}
            {me.last.correct ? `Правильно! +${me.last.points}` : 'Неправильно'}
          </p>
        ) : (
          <p className="game-result bad">Ти не встиг(ла) відповісти</p>
        )}
        {!me?.last?.correct && g.reveal && (
          <p className="answer-ok">Правильна відповідь: {g.reveal.correctText}</p>
        )}
        <p className="lead">
          Твої бали: <b data-testid="my-score">{me?.score ?? 0}</b>
          {!g.junior && place ? ` · ${place} місце` : ''}
        </p>
        <p className="muted">Чекаємо наступне питання…</p>
      </div>
    );
  } else {
    const me = g.players?.[studentId];
    body = (
      <div className="stack center" data-testid="game-final">
        <h1>Гру завершено!</h1>
        <p className="lead">
          Правильних відповідей: <b>{me?.correct ?? 0}</b> з {Math.max(0, g.index + 1)}
        </p>
        {!g.junior && (
          <p className="lead">
            Бали: <b>{me?.score ?? 0}</b>
            {rank(g, studentId) ? ` · ${rank(g, studentId)} місце` : ''}
          </p>
        )}
        {g.junior && <p className="lead">Молодець! Дякуємо за гру.</p>}
        <div>
          <button className="btn btn-secondary" onClick={onBack}>
            На головну
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack game-play" data-testid="game-play">
      {g && g.status !== 'finished' && (
        <p className="row small muted">
          <strong>{g.title}</strong>
          {g.index >= 0 && g.status !== 'lobby' && (
            <span>
              · питання {g.index + 1} з {g.questions.length}
            </span>
          )}
        </p>
      )}
      <ErrorText error={joinError ?? game.error} />
      {body}
    </div>
  );
}

function rank(g: GameDoc, studentId: string): number | null {
  const list = Object.entries(g.players ?? {}).sort(
    ([, a], [, b]) => b.score - a.score || a.name.localeCompare(b.name, 'uk'),
  );
  const i = list.findIndex(([id]) => id === studentId);
  return i >= 0 ? i + 1 : null;
}

function Question({
  gameId,
  studentId,
  g,
  clockReady,
}: {
  gameId: string;
  studentId: string;
  g: GameDoc;
  clockReady: boolean;
}) {
  const q = g.questions[g.index]!;
  const [value, setValue] = useState<AnswerValue | undefined>(undefined);
  const [sent, setSent] = useState<'no' | 'sending' | 'yes'>('no');
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  // After a reload: was this question already answered?
  useEffect(() => {
    getDoc(gameAnswerRef(gameId, studentId, g.index)).then(
      (snap) => snap.exists() && setSent('yes'),
      () => {},
    );
  }, [gameId, studentId, g.index]);

  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);

  const deadline = g.deadline?.toMillis() ?? null;
  const seconds =
    deadline !== null && clockReady
      ? Math.max(0, Math.ceil((deadline - serverNow()) / 1000))
      : null;

  const send = async (v: AnswerValue | undefined) => {
    if (sent !== 'no' || !hasAnswer(v)) return;
    setSent('sending');
    setError(null);
    try {
      await answerGame(gameId, studentId, g.index, v!);
      setSent('yes');
    } catch (err) {
      setSent('no');
      setError(isPermissionDenied(err) ? 'Час на це питання минув' : errorText(err));
    }
  };

  if (sent === 'yes') {
    return (
      <div className="stack center" data-testid="answer-accepted">
        <p className="game-result ok">
          <Icon name="check" size={28} /> Відповідь прийнято!
        </p>
        <p className="muted">Чекаємо інших…</p>
      </div>
    );
  }

  return (
    <div className="stack">
      {seconds !== null && (
        <div className={`game-timer${seconds <= 5 ? ' low' : ''}`} data-testid="game-timer">
          {seconds}
        </div>
      )}
      <p className="question-prompt">{q.prompt}</p>
      <QuestionInput
        question={q}
        value={value}
        onChange={(v) => {
          setValue(v);
          // One right answer: a tap sends it, as on the projector game.
          if (q.type === 'single') void send(v);
        }}
        onEnter={() => void send(value)}
      />
      {q.type !== 'single' && (
        <button
          type="button"
          className="btn btn-sun btn-lg"
          disabled={!hasAnswer(value) || sent !== 'no'}
          onClick={() => void send(value)}
        >
          Відповісти
        </button>
      )}
      <ErrorText error={error} />
    </div>
  );
}
