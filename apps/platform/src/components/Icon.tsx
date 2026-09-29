/**
 * Small SVG icons instead of emoji and symbol characters: Windows 7 shows many of
 * them as empty squares (решение Р9).
 */
const PATHS = {
  check: 'M4 12.5l5 5L20 6.5',
  cross: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  plus: 'M12 5v14M5 12h14',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  speaker: 'M4 9v6h4l5 4V5L8 9H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12',
  key: 'M14 10a4 4 0 1 0-3.9 4H11l2 2h2v2h2v2h3v-3l-5.1-5.1A4 4 0 0 0 14 10zM8 10h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  send: 'M4 12l16-8-6 16-3-7-7-1z',
  retry: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Colour + shape per option, so options differ without reading (as in ІнфоКлас). */
const SHAPES = [
  'M12 3L22 20H2z', // triangle
  'M12 2l10 10-10 10L2 12z', // diamond
  'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', // circle
  'M4 4h16v16H4z', // square
  'M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7L2 9.5l7.1-.6z', // star
  'M12 2l10 7.5-3.8 11.5H5.8L2 9.5z', // pentagon
  'M12 21s-9-5.6-9-11.5A5 5 0 0 1 12 6a5 5 0 0 1 9 3.5C21 15.4 12 21 12 21z', // heart
  'M9 2h6v7h7v6h-7v7H9v-7H2V9h7z', // cross
];

export function OptionShape({ index }: { index: number }) {
  return (
    <svg className="option-shape" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={SHAPES[index % SHAPES.length]} fill="currentColor" />
    </svg>
  );
}
