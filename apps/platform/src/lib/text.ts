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

const shortDateFmt = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit' });

/** «25.09», как «давали: 5-А 25.09» в Клас-пульте. */
export const formatShortDate = (d: Date) => shortDateFmt.format(d);

export const questionsLabel = (n: number) => countLabel(n, ['питання', 'питання', 'питань']);

/** `<input type="datetime-local">` value <-> Date (local time of the teacher's computer). */
export function toLocalInput(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
