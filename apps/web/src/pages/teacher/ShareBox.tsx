import { useState } from 'react';
import { assignmentLink, classroomShareUrl } from '../../lib/classroom';

/** Link for students + one-click posting to Google Classroom. */
export function ShareBox({
  joinCode,
  assignmentId,
  title,
}: {
  joinCode: string;
  assignmentId: string;
  title: string;
}) {
  const link = assignmentLink(joinCode, assignmentId);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Скопіюйте посилання', link);
    }
  };

  return (
    <div className="row">
      <a
        className="btn btn-sm"
        href={classroomShareUrl(link, title)}
        target="_blank"
        rel="noopener noreferrer"
        style={{ background: '#0f9d58' }}
      >
        Поділитися в Classroom
      </a>
      <button className="btn btn-secondary btn-sm" onClick={copy}>
        {copied ? '✔ Скопійовано' : '🔗 Копіювати посилання'}
      </button>
    </div>
  );
}
