import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { AnswerValue, LivePlayerState } from '@infoklas/shared';
import { QuestionInput, hasAnswer } from '../../components/QuestionInput';
import { SpeakButton } from '../../components/SpeakButton';
import { Spinner } from '../../components/ui';
import { useCountdown, useLive } from '../../lib/useLive';

export function LivePlay() {
  const { id = '' } = useParams();
  const { state, connected, error, clockOffset, answer } = useLive('player', id);

  if (!state) {
    return (
      <main className="page page-narrow center">
        {error ? (
          <div className="stack">
            <div className="alert alert-error">{error}</div>
            <Link to="/s" className="btn btn-secondary">
              До завдань
            </Link>
          </div>
        ) : (
          <Spinner />
        )}
      </main>
    );
  }

  return (
    <main className="page" style={{ maxWidth: 760 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <b>🎮 {state.title}</b>
        {state.status !== 'lobby' && state.status !== 'finished' && (
          <span className="badge">
            {state.questionIndex + 1} / {state.questionCount}
          </span>
        )}
        {!connected && <span className="badge badge-danger">Перепідключення…</span>}
        {!state.junior && state.status !== 'lobby' && (
          <span className="badge badge-success" style={{ marginLeft: 'auto' }}>
            {state.myScore} балів
          </span>
        )}
      </div>
      <Screen state={state} clockOffset={clockOffset} answer={answer} />
    </main>
  );
}

function Screen({
  state,
  clockOffset,
  answer,
}: {
  state: LivePlayerState;
  clockOffset: number;
  answer: (i: number, v: AnswerValue) => Promise<{ ok: boolean; error?: string }>;
}) {
  switch (state.status) {
    case 'lobby':
      return (
        <div className="feedback feedback-neutral">
          <span className="emoji" aria-hidden>
            ⏳
          </span>
          <h2>Ти в грі, {state.name}!</h2>
          <p style={{ margin: 0 }}>Чекаємо, поки вчитель почне…</p>
        </div>
      );
    case 'question':
      return (
        <QuestionScreen
          key={state.questionIndex}
          state={state}
          clockOffset={clockOffset}
          answer={answer}
        />
      );
    case 'reveal':
      return <RevealScreen state={state} />;
    case 'finished':
      return (
        <div className="stack">
          <div className="feedback feedback-neutral">
            <span className="emoji" aria-hidden>
              🏁
            </span>
            <h2>Гру завершено!</h2>
            <p style={{ fontSize: '1.2rem', margin: 0 }}>
              Правильних відповідей: <b>{state.myCorrectCount}</b> з {state.questionIndex + 1}
            </p>
            {state.myPlace !== null && (
              <p style={{ fontSize: '1.2rem', margin: 0 }}>
                Твоє місце: <b>{state.myPlace}</b> · {state.myScore} балів
              </p>
            )}
          </div>
          <Link to="/s" className="btn btn-secondary">
            До завдань
          </Link>
        </div>
      );
  }
}

function QuestionScreen({
  state,
  clockOffset,
  answer,
}: {
  state: LivePlayerState;
  clockOffset: number;
  answer: (i: number, v: AnswerValue) => Promise<{ ok: boolean; error?: string }>;
}) {
  const q = state.question!;
  const [value, setValue] = useState<AnswerValue | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seconds = useCountdown(state.deadline, clockOffset, q.timeLimitSec);

  const send = async (v: AnswerValue | undefined) => {
    if (!hasAnswer(v) || sending) return;
    setSending(true);
    const r = await answer(state.questionIndex, v!);
    setSending(false);
    setError(r.ok ? null : (r.error ?? 'Помилка'));
  };

  if (state.myAnswer !== null) {
    return (
      <div className="feedback feedback-neutral">
        <span className="emoji" aria-hidden>
          👌
        </span>
        <h2>Відповідь прийнято!</h2>
        <p style={{ margin: 0 }}>Чекаємо на інших…</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <div className="progress" style={{ flex: 1 }}>
          <div
            style={{
              width: `${seconds !== null ? (seconds / q.timeLimitSec) * 100 : 100}%`,
              background: seconds !== null && seconds <= 5 ? 'var(--danger)' : undefined,
            }}
          />
        </div>
        <b style={{ minWidth: 40, textAlign: 'right' }}>{seconds ?? ''}</b>
      </div>
      <div className="card">
        <div className="question-prompt">{q.prompt}</div>
        {state.junior && (
          <div style={{ marginTop: -8, marginBottom: 12 }}>
            <SpeakButton
              text={[q.prompt, ...(q.type === 'text' ? [] : q.options.map((o) => o.text))].join(
                '. ',
              )}
            />
          </div>
        )}
        <QuestionInput
          question={q}
          value={value}
          disabled={sending}
          onChange={(v) => {
            setValue(v);
            // Single choice: one tap answers, like in a quiz show.
            if (q.type === 'single') void send(v);
          }}
          onSubmitText={() => void send(value)}
        />
        {q.type !== 'single' && (
          <button
            className="btn btn-lg btn-block"
            style={{ marginTop: 16 }}
            disabled={!hasAnswer(value) || sending}
            onClick={() => void send(value)}
          >
            Відповісти
          </button>
        )}
        {error && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function RevealScreen({ state }: { state: LivePlayerState }) {
  const r = state.myResult;
  const answered = state.myAnswer !== null;
  const ok = r?.correct ?? false;
  return (
    <div className="stack">
      <div
        className={`feedback ${ok ? 'feedback-ok' : answered ? 'feedback-bad' : 'feedback-neutral'}`}
      >
        <span className="emoji" aria-hidden>
          {ok ? '🎉' : answered ? '🙈' : '⌛'}
        </span>
        <h2>
          {ok
            ? state.junior
              ? 'Правильно! Молодець!'
              : 'Правильно!'
            : answered
              ? state.junior
                ? 'Не вийшло — наступного разу вийде!'
                : 'Неправильно'
              : 'Час вийшов'}
        </h2>
        {!state.junior && ok && r && <p style={{ margin: 0 }}>+{r.points} балів</p>}
        {!ok && r && (
          <p style={{ margin: 0 }}>
            Правильна відповідь: <b>{r.correctAnswer}</b>
          </p>
        )}
      </div>
      {state.myPlace !== null && (
        <p className="center" style={{ fontSize: '1.15rem' }}>
          Ти зараз на <b>{state.myPlace}</b> місці
        </p>
      )}
      <p className="center muted">Чекаємо на наступне питання…</p>
    </div>
  );
}
