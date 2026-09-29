import { useEffect, useState } from 'react';
import { addMinute, durationText, timerLeft } from '@infoklas/shared/lesson';
import { serverNow } from '../../firebase/clock';
import { setTimer, startTimer, type RoomDoc } from '../../data/room';
import { Icon } from '../../components/Icon';

const PRESETS = [1, 3, 5, 10, 15];

/** «Таймер на екранах» (Клас-пульт): counts by server time on every screen. */
export function TimerPanel({ room }: { room: RoomDoc }) {
  const timer = room.timer && room.timer.id ? room.timer : null;
  const [minutes, setMinutes] = useState('7');
  const [, tick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const t = timer
    ? { id: timer.id, durationMs: timer.durationMs, startedAt: timer.startedAt?.toMillis() ?? 0 }
    : null;
  const left = timerLeft(t, serverNow());

  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [timer]);

  const start = (min: number) => {
    const m = Math.round(min);
    if (!(m >= 1 && m <= 120)) return setError('Таймер: від 1 до 120 хвилин.');
    setError(null);
    void startTimer(m).catch(() => {});
  };

  return (
    <section className="panel panel-timer">
      <h2 className="panel-title">
        <Icon name="clock" /> Таймер на екранах
      </h2>
      {!timer ? (
        <div className="stack stack-sm">
          <div className="row">
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => start(m)}
              >
                {m} хв
              </button>
            ))}
          </div>
          <div className="row">
            <input
              className="input input-sm timer-min"
              type="number"
              min={1}
              max={120}
              value={minutes}
              aria-label="Хвилин"
              onChange={(e) => setMinutes(e.target.value)}
            />
            <span className="muted">хв</span>
            <button type="button" className="btn btn-sm" onClick={() => start(Number(minutes))}>
              Старт
            </button>
          </div>
          {error && <p className="alert alert-error">{error}</p>}
        </div>
      ) : (
        <div className="row">
          <p
            className={`timer-value${left !== null && left <= 0 ? ' done' : ''}`}
            data-testid="pult-timer"
          >
            {left === null
              ? durationText(timer.durationMs)
              : left > 0
                ? durationText(left)
                : 'Час вийшов!'}
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              t &&
              void setTimer({ ...addMinute(t, serverNow()), startedAt: timer.startedAt }).catch(
                () => {},
              )
            }
          >
            +1 хв
          </button>
          <button
            type="button"
            className="btn btn-danger-ghost btn-sm"
            onClick={() => void setTimer(null).catch(() => {})}
          >
            Стоп
          </button>
        </div>
      )}
    </section>
  );
}
