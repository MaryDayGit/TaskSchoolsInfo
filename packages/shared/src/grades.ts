export const MIN_GRADE = 2;
export const MAX_GRADE = 9;
export const GRADES = [2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * Grades 2–4 (НУШ primary school) get the "junior" experience: picture passwords,
 * big buttons, no leaderboards and no speed pressure — feedback stays formative.
 */
export function isJuniorGrade(grade: number): boolean {
  return grade <= 4;
}
