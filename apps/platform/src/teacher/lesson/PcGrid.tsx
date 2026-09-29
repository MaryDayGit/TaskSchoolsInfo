import { useEffect, useState } from 'react';
import { isOnline, pcLabel, raisedHands, taskStatus, type PcCard } from '@infoklas/shared/lesson';
import { lowerHands, type RoomDoc } from '../../data/room';
import { Icon } from '../../components/Icon';

/** Statuses are recomputed every 20 s (online / offline without new snapshots). */
const REFRESH_MS = 20_000;

/** «Учні»: PC cards sorted by number; a click selects the PC as a recipient. */
export function PcGrid({
  room,
  pcs,
  skew,
  selected,
  onSelect,
}: {
  room: RoomDoc;
  pcs: PcCard[];
  skew: number;
  selected: string[];
  onSelect: (ids: string[]) => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const online = pcs.filter((p) => isOnline(p, now, skew));
  const hands = raisedHands(pcs, room.handsDown);
  const handOrder = hands.map((p) => p.id);
  const lower = (list: PcCard[]) => {
    const down: Record<string, number> = {};
    for (const p of list) if (p.handId) down[p.id] = p.handId;
    void lowerHands(down).catch(() => {});
  };
  const toggle = (id: string) =>
    onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <section className="panel panel-students">
      <div className="panel-head">
        <h2 className="panel-title">Учні</h2>
        {pcs.length > 0 && (
          <span className="muted small" data-testid="online-count">
            онлайн: {online.length} з {pcs.length}
          </span>
        )}
        <div className="row panel-links">
          <button
            type="button"
            className="link-btn small"
            onClick={() => onSelect(online.map((p) => p.id))}
          >
            вибрати всіх онлайн
          </button>
          <button type="button" className="link-btn small" onClick={() => onSelect([])}>
            зняти вибір
          </button>
        </div>
      </div>
      {hands.length > 0 && (
        <div className="hands" data-testid="hands">
          <span className="strong">
            <Icon name="hand" /> Піднята рука:
          </span>
          {hands.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="hand-chip"
              title="Опустити руку"
              onClick={() => lower([p])}
            >
              <span className="hand-order">{i + 1}</span> ПК {pcLabel(p.num)} · {p.name || '—'}{' '}
              <Icon name="cross" />
            </button>
          ))}
          {hands.length > 1 && (
            <button type="button" className="link-btn small" onClick={() => lower(hands)}>
              опустити всі
            </button>
          )}
        </div>
      )}
      {!pcs.length ? (
        <p className="muted">
          Учнів ще немає. Відкрийте на комп’ютерах учнів сторінку учня — картки з’являться тут.
        </p>
      ) : (
        <div className="pc-grid">
          {pcs.map((p) => {
            const on = isOnline(p, now, skew);
            const status = taskStatus(p, room.task);
            const hand = handOrder.indexOf(p.id);
            const isSel = selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`pc-card${isSel ? ' selected' : ''}${on ? '' : ' offline'}${hand !== -1 ? ' hand' : ''}`}
                aria-pressed={isSel}
                data-pc={p.id}
                onClick={() => toggle(p.id)}
              >
                {hand !== -1 && (
                  <span className="pc-hand" title={`Піднята рука, черга ${hand + 1}`}>
                    <Icon name="hand" size={14} /> {hand + 1}
                  </span>
                )}
                <span className="pc-num">{pcLabel(p.num)}</span>
                <span className="pc-name" title={p.name}>
                  {p.name || '—'}
                  {!p.studentId && <span className="muted"> · гість</span>}
                </span>
                <span className={`pc-presence${on ? ' on' : ''}`}>
                  <span className="dot" aria-hidden="true" /> {on ? 'онлайн' : 'не в мережі'}
                </span>
                {status && <span className={`pc-status ${status.kind}`}>{status.text}</span>}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
