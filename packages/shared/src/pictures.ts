/**
 * Picture passwords for grades 2–4: a student taps 3 pictures in order instead of
 * typing a password. 12 pictures × 3 positions = 1728 combinations; brute force is
 * prevented by a per-student lockout on the server.
 */
export const PICTURES = [
  { id: 'cat', emoji: '🐱', label: 'Кіт' },
  { id: 'dog', emoji: '🐶', label: 'Пес' },
  { id: 'fox', emoji: '🦊', label: 'Лисиця' },
  { id: 'frog', emoji: '🐸', label: 'Жабка' },
  { id: 'bear', emoji: '🐻', label: 'Ведмідь' },
  { id: 'owl', emoji: '🦉', label: 'Сова' },
  { id: 'apple', emoji: '🍎', label: 'Яблуко' },
  { id: 'sun', emoji: '☀️', label: 'Сонце' },
  { id: 'car', emoji: '🚗', label: 'Машина' },
  { id: 'ball', emoji: '⚽', label: "М'яч" },
  { id: 'star', emoji: '⭐', label: 'Зірка' },
  { id: 'rocket', emoji: '🚀', label: 'Ракета' },
] as const;

export type PictureId = (typeof PICTURES)[number]['id'];

export const PICTURE_SECRET_LENGTH = 3;

const byId = new Map<string, (typeof PICTURES)[number]>(PICTURES.map((p) => [p.id, p]));

export function isPictureId(id: string): id is PictureId {
  return byId.has(id);
}

export function getPicture(id: string) {
  return byId.get(id);
}

/** Picture secrets are stored as ids joined by dashes, e.g. "cat-sun-rocket". */
export function encodePictureSecret(ids: readonly string[]): string {
  return ids.join('-');
}

export function decodePictureSecret(secret: string): string[] {
  return secret.split('-');
}
