import type { CSSProperties } from 'react';

/** Color + shape per option index, so options are distinguishable without reading. */
export const OPTION_SHAPES = ['▲', '◆', '●', '■', '★', '⬟', '♥', '✚'];

export function optionStyle(i: number): CSSProperties {
  return { ['--opt-color' as string]: `var(--opt-${i % 8})` };
}
