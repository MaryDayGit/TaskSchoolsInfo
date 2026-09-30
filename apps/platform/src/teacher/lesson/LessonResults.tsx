import { percent, toCsv } from '@infoklas/shared';
import { pcLabel, type PcCard } from '@infoklas/shared/lesson';
import { useDoc } from '../../firebase/watch';
import { assignmentRef, type AssignmentDoc } from '../../data/assignments';
import type { RoomDoc } from '../../data/room';
import { useLessonStats, useSaveSummary } from '../useLessonRows';
import { Icon } from '../../components/Icon';
import { downloadText } from '../../lib/download';
import { ScoreBadge } from '../AssignmentPage';

/** The last test belongs to this class period only if its id carries the current resetAt. */
const currentAssignment = (room: RoomDoc) => {
  const id = room.lastTest?.assignmentId;
  return id && room.resetAt && id.startsWith(`lesson_${room.resetAt}_`) ? id : null;
};

/** «Результати: …» of the last test sent on this lesson (pupils and guests). */
export function LessonResults({ room, pcs }: { room: RoomDoc; pcs: PcCard[] }) {
  const id = currentAssignment(room);
  return (
    <section className="panel panel-results">
      {id ? (
        <Results id={id} room={room} pcs={pcs} />
      ) : (
        <>
          <h2 className="panel-title">Результати</h2>
          <p className="muted">
            {room.lastTest && !id
              ? 'Цьому класу ще не надсилали тест. Попередні результати — у вкладці «Історія».'
              : 'Тут з’являться результати, коли ви надішлете тест.'}
          </p>
        </>
      )}
    </section>
  );
}

function Results({ id, room, pcs }: { id: string; room: RoomDoc; pcs: PcCard[] }) {
  const assignment = useDoc<AssignmentDoc>(assignmentRef(id));
  const { questions, stats, loading } = useLessonStats(id, room.classId ?? null);
  const rows = stats.rows;
  // «Історія»: здали N · X% in the list without opening the test.
  useSaveSummary(
    id,
    assignment.data?.summary,
    !loading && !assignment.loading && !!assignment.data && stats.total > 0,
    stats,
  );
  const target = room.lastTest?.target?.length ? room.lastTest.target : null;
  const done = new Set(rows.map((r) => r.pcId));
  const missing = pcs.filter((p) => !done.has(p.id) && (!target || target.includes(p.id)));
  const title = room.lastTest?.title ?? '';
  const avg = rows.length ? rows.reduce((acc, r) => acc + r.correctCount, 0) / rows.length : 0;

  const csv = () => {
    const data = [
      ['ПК', 'Учень', 'Бал', 'Питань', 'Відсоток', ...questions.map((_, i) => String(i + 1))],
      ...rows.map((r) => [
        r.pcId ? pcLabel(Number(r.pcId.slice(2))) : '',
        r.name,
        String(r.correctCount),
        String(r.total),
        `${percent(r.correctCount, r.total)}%`,
        ...r.perQuestion.map((ok) => (ok ? '1' : '0')),
      ]),
      ...missing.map((p) => [pcLabel(p.num), p.name, 'не здав(ла)']),
    ];
    const d = new Date();
    const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    downloadText(`${title} ${room.className ?? ''} ${date}.csv`, toCsv(data));
  };

  return (
    <>
      <div className="panel-head">
        <h2 className="panel-title" data-testid="results-title">
          Результати: {title}
        </h2>
        <button className="btn btn-secondary btn-sm" disabled={!rows.length} onClick={csv}>
          <Icon name="download" /> Завантажити CSV
        </button>
      </div>
      {!rows.length ? (
        <p className="muted">Ще ніхто не здав цей тест.</p>
      ) : (
        <div className="table-wrap">
          <table className="table" data-testid="lesson-results">
            <thead>
              <tr>
                <th>ПК</th>
                <th>Учень</th>
                <th>Бал</th>
                {questions.map((q, i) => (
                  <th key={q.id} className="center" title={q.prompt}>
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid={`lr-${r.name}`}>
                  <td>{r.pcId ? pcLabel(Number(r.pcId.slice(2))) : '—'}</td>
                  <td className="strong">
                    {r.name}
                    {!r.studentId && <span className="muted small"> · гість</span>}
                  </td>
                  <td>
                    <span className="row">
                      {r.correctCount} / {r.total}{' '}
                      <ScoreBadge correct={r.correctCount} total={r.total} />
                    </span>
                  </td>
                  {r.perQuestion.map((ok, i) => (
                    <td key={i} className="center">
                      <span
                        className={`dot ${ok ? 'dot-ok' : 'dot-bad'}`}
                        aria-label={ok ? 'правильно' : 'неправильно'}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {missing.length > 0 ? (
        <p className="small" data-testid="results-missing">
          <strong>Ще не здали:</strong>{' '}
          {missing.map((p) => `ПК ${pcLabel(p.num)} (${p.name || '—'})`).join(', ')}
        </p>
      ) : (
        rows.length > 0 && <p className="small answer-ok">Усі здали.</p>
      )}
      {rows.length > 0 && (
        <p className="small muted">
          Середній бал {avg.toFixed(1).replace('.', ',')} з {questions.length}. Результати учнів зі
          списку вже в журналі класу.
        </p>
      )}
    </>
  );
}
