import { z } from 'zod';
import { notFound } from './errors.js';

const uuid = z.string().uuid();

/** Parses an `:id`-style route param; malformed ids are treated as "not found". */
export function idParam(params: unknown, key = 'id'): string {
  const value = (params as Record<string, unknown>)[key];
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
}
