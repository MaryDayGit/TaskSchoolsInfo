import { canSpeak, speak } from '../lib/speech';

export function SpeakButton({ text }: { text: string }) {
  if (!canSpeak()) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={() => speak(text)}
      aria-label="Прочитати вголос"
      title="Прочитати вголос"
    >
      🔊 Прочитати
    </button>
  );
}
