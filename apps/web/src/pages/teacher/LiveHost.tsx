import { Link, useParams } from 'react-router';
import type { LiveHostState } from '@infoklas/shared';
import { OPTION_SHAPES, optionStyle } from '../../components/options';
import { Spinner } from '../../components/ui';
import { plural } from '../../lib/format';
import { useCountdown, useLive } from '../../lib/useLive';

const MEDALS = ['🥇', '🥈', '🥉'];

function Leaderboard({ entries }: { entries: LiveHostState['leaderboard'] }) {
  return (
    <div className="leaderboard">
      {entries.map((e, i) => (
        <div key={e.name} className="leader">
          <span className="place">{MEDALS[i] ?? i + 1}</span>
          <span>{e.name}</span>
          <span className="pts">{e.score}</span>
        </div>
      ))}
    </div>
  );
}

function Timer({ seconds }: { seconds: number | null }) {
  if (seconds === null) return null;
  return <div className={`timer${seconds <= 5 ? ' low' : ''}`}>{seconds}</div>;
}

export function LiveHost() {
  const { id = '' } = useParams();
  const { state, connected, error, clockOffset, command } = useLive('host', id);
  const seconds = useCountdown(state?.deadline ?? null, clockOffset, state?.question?.timeLimitSec);

  if (!state) {
    return (
      <div className="host">
        <div className="host-main center">
          {error ? (
            <div className="stack" style={{ alignItems: 'center' }}>
              <div className="alert alert-error">{error}</div>
              <Link to="/t" className="btn btn-secondary">
                До кабінету
              </Link>
            </div>
          ) : (
            <Spinner />
          )}
        </div>
      </div>
    );
  }

  const q = state.question;
  const connectedPlayers = state.participants.filter((p) => p.connected);
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  return (
    <div className="host">
      <div className="host-bar">
        <b style={{ fontSize: '1.1rem' }}>🎮 {state.title}</b>
        {state.status !== 'lobby' && state.status !== 'finished' && (
          <span className="badge">
            Питання {state.questionIndex + 1} з {state.questionCount}
          </span>
        )}
        {!connected && <span className="badge badge-danger">Немає з'єднання…</span>}
        <div className="row" style={{ marginLeft: 'auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={fullscreen}>
            ⛶ На весь екран
          </button>
          {state.status !== 'finished' && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() =>
                window.confirm('Завершити гру? Результати збережуться в журнал.') &&
                command('live:end')
              }
            >
              Завершити
            </button>
          )}
        </div>
      </div>

      <div className="host-main">
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {state.status === 'lobby' && <Lobby state={state} onStart={() => command('live:start')} />}

        {(state.status === 'question' || state.status === 'reveal') && q && (
          <>
            <div className="row" style={{ justifyContent: 'center' }}>
              {state.status === 'question' && <Timer seconds={seconds} />}
            </div>
            <div className="host-prompt">{q.prompt}</div>

            {q.type !== 'text' ? (
              <div className="host-options">
                {q.options.map((o, i) => {
                  const correct =
                    q.type === 'single'
                      ? q.correctOptionId === o.id
                      : q.correctOptionIds.includes(o.id);
                  const revealed = state.status === 'reveal';
                  const count = state.optionStats.find((s) => s.optionId === o.id)?.count ?? 0;
                  return (
                    <div
                      key={o.id}
                      className={`host-option${revealed && !correct ? ' dim' : ''}`}
                      style={optionStyle(i)}
                    >
                      <span aria-hidden>{OPTION_SHAPES[i % OPTION_SHAPES.length]}</span>
                      <span>{o.text}</span>
                      {revealed && (
                        <span className="count">
                          {correct ? '✔ ' : ''}
                          {count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : state.status === 'reveal' ? (
              <div className="stack" style={{ alignItems: 'center' }}>
                <div className="alert alert-success" style={{ fontSize: '1.4rem' }}>
                  Правильна відповідь: <b>{q.acceptedAnswers[0]}</b>
                </div>
                <div className="text-answers">
                  {state.textAnswers.map((a, i) => (
                    <span key={i} className={`chip${a.correct ? ' done' : ''}`} title={a.name}>
                      {a.value}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="center muted" style={{ fontSize: '1.3rem' }}>
                Учні пишуть відповідь…
              </p>
            )}

            <div className="host-stats">
              <div className="stat">
                <div className="stat-value">
                  {state.answeredCount}/{connectedPlayers.length}
                </div>
                <div className="stat-label">відповіли</div>
              </div>
            </div>

            {state.status === 'reveal' && state.showLeaderboard && state.leaderboard.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <Leaderboard entries={state.leaderboard} />
              </div>
            )}

            <div className="row" style={{ justifyContent: 'center', marginTop: 28 }}>
              {state.status === 'question' ? (
                <button className="btn btn-lg" onClick={() => command('live:reveal')}>
                  Показати відповідь
                </button>
              ) : (
                <button className="btn btn-lg" onClick={() => command('live:next')}>
                  {state.questionIndex + 1 >= state.questionCount
                    ? 'Підсумки 🏁'
                    : 'Наступне питання →'}
                </button>
              )}
            </div>
          </>
        )}

        {state.status === 'finished' && <Finished state={state} />}
      </div>
    </div>
  );
}

function Lobby({ state, onStart }: { state: LiveHostState; onStart: () => void }) {
  const online = state.participants.filter((p) => p.connected);
  return (
    <div className="stack" style={{ alignItems: 'center', gap: 24 }}>
      <LobbyJoinInfo state={state} />
      <div className="center">
        <div className="stat-value">{online.length}</div>
        <div className="stat-label">
          {plural(online.length, ['учень приєднався', 'учні приєдналися', 'учнів приєдналися'])}
        </div>
      </div>
      <div className="chips">
        {state.participants.map((p) => (
          <span key={p.studentId} className={`chip${p.connected ? '' : ' off'}`}>
            {p.name}
          </span>
        ))}
      </div>
      <button className="btn btn-lg btn-success" onClick={onStart} disabled={online.length === 0}>
        ▶ Почати гру
      </button>
      {online.length === 0 && (
        <p className="muted">Кнопка стане активною, щойно приєднається хоча б один учень.</p>
      )}
    </div>
  );
}

function LobbyJoinInfo({ state }: { state: LiveHostState }) {
  return (
    <div className="card center" style={{ maxWidth: 640, width: '100%' }}>
      <p style={{ fontSize: '1.2rem', marginBottom: 6 }}>
        Відкрийте <b>{window.location.host}</b> → «Я учень»
      </p>
      <div className="muted">Код класу {state.className}</div>
      <div className="code-display" style={{ fontSize: '3.2rem' }}>
        {state.joinCode}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        Після входу з'явиться кнопка «Приєднатися до гри»
      </p>
    </div>
  );
}

function Finished({ state }: { state: LiveHostState }) {
  const avg =
    state.participants.length > 0
      ? Math.round(state.participants.reduce((s, p) => s + p.score, 0) / state.participants.length)
      : 0;
  return (
    <div className="stack" style={{ alignItems: 'center', gap: 24 }}>
      <h1 style={{ fontSize: '2.4rem' }}>🏁 Гру завершено!</h1>
      {state.showLeaderboard ? (
        <Leaderboard entries={state.leaderboard} />
      ) : (
        <p style={{ fontSize: '1.3rem' }}>Молодці! Усі старалися 👏</p>
      )}
      <p className="muted">
        Учасників: {state.participants.length} · середній бал: {avg}. Результати збережено в журнал
        класу.
      </p>
      <Link to={`/t/classes/${state.classId}?tab=journal`} className="btn btn-secondary">
        Відкрити журнал
      </Link>
    </div>
  );
}
