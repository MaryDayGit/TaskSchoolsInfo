import { randomInt } from 'node:crypto';
import { PICTURES, PICTURE_SECRET_LENGTH, encodePictureSecret, isJuniorGrade } from '@infoklas/shared';
import type { SecretKind } from '@infoklas/shared';

export function generateJoinCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Short, easy to type words for grades 5–9 passwords (combined with 2 digits). */
const WORDS = [
  'сонце', 'зірка', 'ракета', 'комета', 'планета', 'місяць', 'хмара', 'веселка',
  'лисиця', 'ведмідь', 'дельфін', 'пінгвін', 'сова', 'їжак', 'тигр', 'панда',
  'яблуко', 'груша', 'вишня', 'кавун', 'лимон', 'слива', 'горіх', 'малина',
  'робот', 'піксель', 'байт', 'модем', 'сервер', 'курсор', 'мишка', 'екран',
  'річка', 'гора', 'ліс', 'море', 'поле', 'сад', 'міст', 'парк',
];

export function generateStudentSecret(grade: number): { kind: SecretKind; secret: string } {
  if (isJuniorGrade(grade)) {
    const ids: string[] = [];
    for (let i = 0; i < PICTURE_SECRET_LENGTH; i++) {
      ids.push(PICTURES[randomInt(0, PICTURES.length)]!.id);
    }
    return { kind: 'pictures', secret: encodePictureSecret(ids) };
  }
  const word = WORDS[randomInt(0, WORDS.length)]!;
  return { kind: 'password', secret: `${word}${randomInt(10, 100)}` };
}
