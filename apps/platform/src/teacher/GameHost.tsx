import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  everyoneAnswered,
  gameResults,
  leaderboard,
  optionStats,
  revealInfo,
  tally,
  textAnswers,
  type GameAnswer,
  type PlayerTally,
  type Question,
} from '@infoklas/shared';
import { useUser } from '../firebase/auth';
import { serverNow, syncClock, useClockReady } from '../firebase/clock';
import { errorText } from '../firebase/errors';
import { useDoc, useQuery } from '../firebase/watch';
import { rosterCol, type RosterDoc } from '../data/classes';
import {
  finishGame,
  gameAnswersCol,
  gameKeyRef,
  gamePlayersCol,
  gameRef,
  openQuestion,
  revealQuestion,
  type GameAnswerDoc,
  type GameDoc,
  type GamePlayerInfo,
} from '../data/games';
import { useConfirm } from '../components/Dialog';
import { Icon, OptionShape } from '../components/Icon';
import { ErrorText, Spinner } from '../components/Modal';
import { plural } from '../lib/text';

/**
 * Ведущий живой игры (бывший LiveManager на сервере): браузер учителя, обычно
 * на проекторе. Всё состояние — в Firestore, поэтому после перезагрузки вкладки
 * игра продолжается с того же вопроса.
 */
export function GameHostPage() {
  const { id = '' } = useParams();
  const { user } = useUser();
  const confirm = useConfirm();
  const game = useDoc<GameDoc>(gameRef(id));
  const key = useDoc<{ questions: Question[] }>(gameKeyRef(id));
  const players = useQuery<{ joinedAt: unknown }>(gamePlayersCol(id), `gp:${id}`);
  const answers = useQuery<GameAnswerDoc>(gameAnswersCol(id), `ga:${id}`);
  const classId = game.data?.classId ?? '';
  const roster = useQuery<RosterDoc>(classId ? rosterCol(classId) : null, `roster:${classId}`);
  const clockReady = useClockReady();
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    if (user) syncClock(user.uid).catch(() => {});
  }, [user]);

  const g = game.data;
  const questions = useMemo(() => key.data?.questions ?? [], [key.data]);
  const names = useMemo(
    () => new Map(roster.docs.map((r) => [r.id, r.data.displayName])),
    [roster.docs],
  );
  const playerIds = useMemo(() => players.docs.map((d) => d.id).sort(), [players.docs]);
  const ans: GameAnswer[] = useMemo(
    () =>
      answers.docs.map((d) => ({
        studentId: d.data.studentId,
        index: d.data.index,
        value: d.data.value,
        at: d.data.at?.toMillis() ?? serverNow(),
      })),
    [answers.docs],
  );

  const scores = useCallback(
    (asked: number) =>
      tally({
        questions,
        answers: ans,
        players: playerIds,
        asked,
        starts: g?.starts ?? {},
        junior: !!g?.junior,
      }),
    [questions, ans, playerIds, g?.starts, g?.junior],
  );

  const playersMap = (t: Map<string, PlayerTally>, index: number) => {
    const out: Record<string, GamePlayerInfo> = {};
    for (const p of t.values()) {
      const last = p.answers.get(index);
      out[p.studentId] = {
        name: names.get(p.studentId) ?? '—',
        score: p.score,
        correct: p.correctCount,
        // null: no answer to this question («Ти не встиг(ла) відповісти»).
        last: last ? { correct: last.correct, points: last.points } : null,
      };
    }
    return out;
  };
  const board = (t: Map<string, PlayerTally>) =>
    g?.junior ? [] : leaderboard(t, names).map(({ name, score }) => ({ name, score }));

  const act = async (fn: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      busy.current = false;
    }
  };

  const open = (index: number) =>
    act(async () => {
      const q = questions[index];
      if (!q || !g) return;
      await openQuestion(id, index, serverNow(), q.timeLimitSec, g.starts ?? {});
    });

  const reveal = () =>
    act(async () => {
      if (!g || g.status !== 'question') return;
      const q = questions[g.index]!;
      const t = scores(g.index + 1);
      await revealQuestion(id, {
        stats: {
          options: optionStats(q, ans, g.index),
          answered: new Set(ans.filter((a) => a.index === g.index).map((a) => a.studentId)).size,
        },
        reveal: revealInfo(q),
        players: playersMap(t, g.index),
        leaderboard: board(t),
      });
    });

  const finish = () =>
    act(async () => {
      if (!g || g.status === 'finished') return;
      const asked = g.status === 'lobby' ? 0 : g.index + 1;
      const t = scores(asked);
      await finishGame(
        id,
        g.classId,
        { players: playersMap(t, asked - 1), leaderboard: board(t) },
        gameResults(t, questions, asked),
      );
    });

  // Auto-reveal: everyone who joined has answered, or the time is up. Also right
  // after a reload of this tab if the deadline passed meanwhile.
  const deadline = g?.deadline?.toMillis() ?? null;
  const loaded = !game.loading && !key.loading && !players.loading && !answers.loading;
  const everyone = g?.status === 'question' && everyoneAnswered(playerIds, ans, g.index);
  const timeUp =
    g?.status === 'question' && clockReady && deadline !== null && serverNow() >= deadline;
  useEffect(() => {
    if (loaded && (everyone || timeUp)) void reveal();
  });

  // Countdown and the deadline check.
  useEffect(() => {
    if (g?.status !== 'question') return;
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [g?.status, g?.index]);

  if (game.loading || key.loading) return <Spinner />;
  if (!g) {
    return (
      <main className="page">
        <ErrorText error={game.error ?? 'Гру не знайдено'} />
        <Link to="/t" className="back-link">
          ← До кабінету
        </Link>
      </main>
    );
  }

  const q = g.index >= 0 ? questions[g.index] : null;
  const seconds =
    deadline !== null && clockReady
      ? Math.max(0, Math.ceil((deadline - serverNow()) / 1000))
      : null;
  const answeredNow =
    g.status === 'question' || g.status === 'reveal'
      ? new Set(ans.filter((a) => a.index === g.index).map((a) => a.studentId)).size
      : 0;

  const end = async () => {
    const ok = await confirm({
      title: 'Завершити гру?',
      text:
        g.status === 'lobby'
          ? 'Гра ще не почалася: у журнал нічого не потрапить.'
          : 'Результати збережуться в журнал класу.',
      ok: 'Завершити',
      danger: true,
    });
    if (ok) await finish();
  };

  return (
    <div className="game-host" data-testid="game-host">
      <div className="host-bar">
        <strong>{g.title}</strong>
        <span className="badge">{g.className}</span>
        {(g.status === 'question' || g.status === 'reveal') && (
          <span className="badge">
            Питання {g.index + 1} з {questions.length}
          </span>
        )}
        <div className="row host-bar-end">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              document.fullscreenElement
                ? void document.exitFullscreen()
                : void document.documentElement.requestFullscreen?.().catch(() => {})
            }
          >
            На весь екран
          </button>
          {g.status !== 'finished' && (
            <button
              type="button"
              className="btn btn-danger-ghost btn-sm"
              onClick={() => void end()}
            >
              Завершити
            </button>
          )}
        </div>
      </div>
      <ErrorText error={error ?? game.error ?? answers.error ?? players.error} />

      {g.status === 'lobby' && (
        <div className="stack center host-lobby">
          <p className="host-join">
            Учні відкривають <b>{window.location.host}</b>, входять за своєю карткою і натискають
            «Приєднатися до гри».
          </p>
          <p className="stat-big" data-testid="joined-count">
            {playerIds.length}
          </p>
          <p className="muted">
            {plural(playerIds.length, [
              'учень приєднався',
              'учні приєдналися',
              'учнів приєдналися',
            ])}
          </p>
          <div className="chips chips-center">
            {playerIds.map((p) => (
              <span key={p} className="chip">
                {names.get(p) ?? '…'}
              </span>
            ))}
          </div>
          <div>
            <button
              className="btn btn-lg btn-sun"
              disabled={!playerIds.length}
              onClick={() => void open(0)}
            >
              Почати гру
            </button>
          </div>
          {!playerIds.length && (
            <p className="muted">Кнопка стане активною, щойно приєднається хоча б один учень.</p>
          )}
        </div>
      )}

      {(g.status === 'question' || g.status === 'reveal') && q && (
        <div className="stack host-question">
          {g.status === 'question' && seconds !== null && (
            <div className={`host-timer${seconds <= 5 ? ' low' : ''}`} data-testid="host-timer">
              {seconds}
            </div>
          )}
          <p className="host-prompt">{q.prompt}</p>
          {q.type !== 'text' ? (
            <div className="host-options">
              {q.options.map((o, i) => {
                const revealed = g.status === 'reveal';
                const correct = revealed && g.reveal?.correctIds.includes(o.id);
                return (
                  <div
                    key={o.id}
                    className={`host-option${revealed && !correct ? ' dim' : ''}`}
                    style={{ ['--opt' as string]: `var(--opt-${i % 8})` }}
                  >
                    <OptionShape index={i} />
                    <span className="grow">{o.text}</span>
                    {revealed && (
                      <span className="count" data-testid={`count-${o.id}`}>
                        {correct && <Icon name="check" />} {g.stats?.options[o.id] ?? 0}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : g.status === 'reveal' ? (
            <div className="stack center">
              <p className="alert alert-info host-answer">
                Правильна відповідь: <b>{g.reveal?.correctText}</b>
              </p>
              <div className="chips chips-center">
                {textAnswers(q, ans, g.index, names).map((a, i) => (
                  <span key={i} className={`chip${a.correct ? ' chip-ok' : ''}`} title={a.name}>
                    {a.value}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="center muted host-typing">Учні пишуть відповідь…</p>
          )}
          <p className="center">
            <span className="stat-big" data-testid="answered">
              {answeredNow}/{playerIds.length}
            </span>{' '}
            <span className="muted">відповіли</span>
          </p>
          {g.status === 'reveal' && !g.junior && (g.leaderboard?.length ?? 0) > 0 && (
            <Leaderboard entries={g.leaderboard!} />
          )}
          <div className="row row-center">
            {g.status === 'question' ? (
              <button className="btn btn-lg" onClick={() => void reveal()}>
                Показати відповідь
              </button>
            ) : g.index + 1 < questions.length ? (
              <button className="btn btn-lg" onClick={() => void open(g.index + 1)}>
                Наступне питання →
              </button>
            ) : (
              <button className="btn btn-lg btn-sun" onClick={() => void finish()}>
                Підсумки
              </button>
            )}
          </div>
        </div>
      )}

      {g.status === 'finished' && (
        <div className="stack center host-finished" data-testid="game-finished">
          <h1>Гру завершено!</h1>
          {g.junior ? (
            <p className="lead">Молодці! Усі старалися.</p>
          ) : (
            <Leaderboard entries={g.leaderboard ?? []} />
          )}
          <p className="muted">
            Учасників: {Object.keys(g.players ?? {}).length}.{' '}
            {g.index >= 0
              ? 'Результати збережено в журнал класу.'
              : 'Гра не почалася — у журнал нічого не потрапило.'}
          </p>
          <div>
            <Link to={`/t/classes/${g.classId}?tab=journal`} className="btn btn-secondary">
              Відкрити журнал
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Leaderboard({ entries }: { entries: { name: string; score: number }[] }) {
  return (
    <ol className="leaderboard" data-testid="leaderboard">
      {entries.map((e, i) => (
        <li key={`${e.name}-${i}`} className={`leader leader-${i + 1}`}>
          <span className="place">{i + 1}</span>
          <span className="grow">{e.name}</span>
          <span className="pts">{e.score}</span>
        </li>
      ))}
    </ol>
  );
}
