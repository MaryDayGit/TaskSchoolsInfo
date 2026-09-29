/** Українські форми множини: plural(5, ['учень', 'учні', 'учнів']) → 'учнів'. */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

export const countLabel = (n: number, forms: [string, string, string]) =>
  `${n} ${plural(n, forms)}`;

/** Схлопнуть пробелы и обрезать (как App.clean в Клас-пульте). */
export function clean(s: string, max: number): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

const dateTimeFmt = new Intl.DateTimeFormat('uk-UA', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDateTime = (d: Date) => dateTimeFmt.format(d);
