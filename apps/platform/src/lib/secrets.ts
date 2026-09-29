import { PICTURES } from '@infoklas/shared/pictures';

/**
 * Пароль-картинка єдиної платформи — 4 картинки з 12 (20 736 варіантів):
 * без сервера не можна блокувати вхід після кількох помилок, тож пароль довший,
 * ніж у старому ІнфоКласі (3 картинки). Старі паролі з 3 картинок теж приймаються.
 */
export const PICTURE_COUNT = 4;

export type SecretKind = 'pictures' | 'password';

/** Прості слова для паролів 5–9 класів (разом із двома цифрами). */
const WORDS = [
  'сонце', 'зірка', 'ракета', 'комета', 'планета', 'місяць', 'хмара', 'веселка',
  'лисиця', 'ведмідь', 'дельфін', 'пінгвін', 'сова', 'їжак', 'тигр', 'панда',
  'яблуко', 'груша', 'вишня', 'кавун', 'лимон', 'слива', 'горіх', 'малина',
  'робот', 'піксель', 'байт', 'модем', 'сервер', 'курсор', 'мишка', 'екран',
  'річка', 'гора', 'ліс', 'море', 'поле', 'сад', 'міст', 'парк',
];

/** Криптостійке випадкове ціле в [0, max). */
export function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  // Rejection sampling removes modulo bias.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  do crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return buf[0]! % max;
}

export const isJuniorGrade = (grade: number) => grade <= 4;

export function generateSecret(grade: number): { kind: SecretKind; secret: string; pictureCount?: number } {
  if (isJuniorGrade(grade)) {
    const ids = Array.from({ length: PICTURE_COUNT }, () => PICTURES[randomInt(PICTURES.length)]!.id);
    return { kind: 'pictures', secret: ids.join('-'), pictureCount: PICTURE_COUNT };
  }
  return { kind: 'password', secret: `${WORDS[randomInt(WORDS.length)]}${10 + randomInt(90)}` };
}

/** Порівняння паролів так само, як у старому ІнфоКласі: слово без регістру й пробілів з країв. */
export function normalizeSecret(kind: SecretKind, secret: string): string {
  return kind === 'password' ? secret.trim().toLowerCase() : secret.trim();
}

export function generateJoinCode(): string {
  return String(randomInt(1_000_000)).padStart(6, '0');
}
