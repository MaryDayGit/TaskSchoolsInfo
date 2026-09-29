/** Short random id for questions/options (works without a secure context). */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}
