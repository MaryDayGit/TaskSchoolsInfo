/** Ukrainian plural forms: plural(5, ['учень', 'учні', 'учнів']) → 'учнів'. */
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export const countLabel = (n: number, forms: [string, string, string]) =>
  `${n} ${plural(n, forms)}`;

const dateFmt = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' });
const dateTimeFmt = new Intl.DateTimeFormat('uk-UA', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

export function percent(correct: number, total: number): number {
  return total > 0 ? Math.round((100 * correct) / total) : 0;
}

/** Color level for results: used by the journal and result tables. */
export function scoreLevel(correct: number, total: number): 'high' | 'mid' | 'low' {
  const p = percent(correct, total);
  return p >= 75 ? 'high' : p >= 50 ? 'mid' : 'low';
}

/** `<input type="datetime-local">` value ↔ ISO string. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
