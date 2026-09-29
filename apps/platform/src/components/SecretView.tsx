import { isPictureId } from '@infoklas/shared/pictures';
import type { SecretKind } from '../lib/secrets';
import { Picture } from './Picture';

/** A student's password as the teacher sees it: pictures in order, or the word. */
export function SecretView({
  kind,
  secret,
  size = 32,
}: {
  kind: SecretKind;
  secret: string;
  size?: number;
}) {
  if (kind === 'pictures') {
    return (
      <span className="secret-pictures" aria-label="Картинки-пароль">
        {secret
          .split('-')
          .map((id, i) =>
            isPictureId(id) ? <Picture key={i} id={id} size={size} /> : <span key={i}>?</span>,
          )}
      </span>
    );
  }
  return <code className="secret-word">{secret}</code>;
}
