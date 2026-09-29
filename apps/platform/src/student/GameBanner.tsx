import { useQuery } from '../firebase/watch';
import { activeGamesQuery, type GameDoc } from '../data/games';

/** «Жива гра»: a running game of the pupil's class, one tap to join. */
export function GameBanner({ classId, onOpen }: { classId: string; onOpen: (id: string) => void }) {
  const games = useQuery<GameDoc>(activeGamesQuery(classId), `games:${classId}`);
  const game = [...games.docs].sort(
    (a, b) =>
      (b.data.createdAt?.toMillis() ?? Infinity) - (a.data.createdAt?.toMillis() ?? Infinity),
  )[0];
  if (!game) return null;
  return (
    <button
      type="button"
      className="game-banner"
      onClick={() => onOpen(game.id)}
      data-testid="game-banner"
    >
      <span className="game-banner-title">Жива гра: {game.data.title}</span>
      <span className="btn btn-sun">Приєднатися до гри</span>
    </button>
  );
}
