import { useState } from 'react';
import { Icon } from '../components/Icon';

/** Link that opens the class and then this assignment (after the pupil logs in). */
export function assignmentLink(joinCode: string, assignmentId: string): string {
  return `${window.location.origin}/join/${joinCode}?a=${encodeURIComponent(assignmentId)}`;
}

/** Google Classroom «share»: opens Classroom with the link attached to a new post. */
export function classroomShareUrl(url: string, title: string): string {
  return `https://classroom.google.com/share?${new URLSearchParams({ url, title }).toString()}`;
}

/** Link for pupils + one-click posting to Google Classroom (from ІнфоКлас). */
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
  const [copied, setCopied] = useState<'ok' | 'manual' | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('ok');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // No clipboard (http, old browser): the link stays selected in the field below.
      setCopied('manual');
    }
  };

  return (
    <div className="stack share-box">
      <div className="row">
        <a
          className="btn btn-sm btn-classroom"
          href={classroomShareUrl(link, title)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Поділитися в Classroom
        </a>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>
          <Icon name={copied === 'ok' ? 'check' : 'copy'} />
          {copied === 'ok' ? 'Скопійовано' : 'Копіювати посилання'}
        </button>
      </div>
      {copied === 'manual' && (
        <input
          className="input"
          readOnly
          value={link}
          aria-label="Посилання для учнів"
          onFocus={(e) => e.target.select()}
          autoFocus
        />
      )}
    </div>
  );
}
