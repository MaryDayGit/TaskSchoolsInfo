/** Reads text aloud in Ukrainian: helps 2nd graders who are still learning to read. */
export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function speak(text: string) {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'uk-UA';
  u.rate = 0.9;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith('uk'));
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
}
