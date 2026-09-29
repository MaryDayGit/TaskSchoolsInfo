import type { ReactElement } from 'react';
// Subpath import: the package index also exports Zod schemas, which would bloat
// the student page.
import { getPicture, type PictureId } from '@infoklas/shared/pictures';

/**
 * Картинки-пароли для 2–4 класів у SVG: на Windows 7 емодзі показуються
 * квадратиками, тому кожну картинку намальовано векторно.
 */
const O = '#1a1f3a'; // контур і очі

const DRAWINGS: Record<PictureId, ReactElement> = {
  cat: (
    <g>
      <path
        d="M14 26 L18 8 L28 20 Z M50 26 L46 8 L36 20 Z"
        fill="#f59e0b"
        stroke={O}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="36" r="20" fill="#fbbf24" stroke={O} strokeWidth="2" />
      <circle cx="24" cy="33" r="3" fill={O} />
      <circle cx="40" cy="33" r="3" fill={O} />
      <path d="M29 41 L35 41 L32 44 Z" fill="#f472b6" />
      <path
        d="M12 40 H22 M12 45 H22 M42 40 H52 M42 45 H52"
        stroke={O}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </g>
  ),
  dog: (
    <g>
      <ellipse cx="14" cy="30" rx="7" ry="14" fill="#92400e" stroke={O} strokeWidth="2" />
      <ellipse cx="50" cy="30" rx="7" ry="14" fill="#92400e" stroke={O} strokeWidth="2" />
      <circle cx="32" cy="34" r="19" fill="#d6a06b" stroke={O} strokeWidth="2" />
      <ellipse cx="32" cy="43" rx="10" ry="8" fill="#f5deb3" />
      <circle cx="25" cy="31" r="3" fill={O} />
      <circle cx="39" cy="31" r="3" fill={O} />
      <ellipse cx="32" cy="40" rx="4" ry="3" fill={O} />
      <path d="M32 43 V47" stroke={O} strokeWidth="1.6" />
    </g>
  ),
  fox: (
    <g>
      <path
        d="M10 12 L24 22 L32 20 L40 22 L54 12 L50 34 L32 56 L14 34 Z"
        fill="#f97316"
        stroke={O}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M14 34 L32 56 L50 34 L40 38 L32 34 L24 38 Z" fill="#fff" />
      <circle cx="24" cy="30" r="3" fill={O} />
      <circle cx="40" cy="30" r="3" fill={O} />
      <circle cx="32" cy="50" r="3" fill={O} />
    </g>
  ),
  frog: (
    <g>
      <ellipse cx="32" cy="40" rx="24" ry="16" fill="#4ade80" stroke={O} strokeWidth="2" />
      <circle cx="20" cy="22" r="9" fill="#4ade80" stroke={O} strokeWidth="2" />
      <circle cx="44" cy="22" r="9" fill="#4ade80" stroke={O} strokeWidth="2" />
      <circle cx="20" cy="22" r="4.5" fill="#fff" />
      <circle cx="44" cy="22" r="4.5" fill="#fff" />
      <circle cx="21" cy="23" r="2.5" fill={O} />
      <circle cx="45" cy="23" r="2.5" fill={O} />
      <path
        d="M20 44 Q32 52 44 44"
        fill="none"
        stroke={O}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </g>
  ),
  bear: (
    <g>
      <circle cx="15" cy="16" r="8" fill="#a16207" stroke={O} strokeWidth="2" />
      <circle cx="49" cy="16" r="8" fill="#a16207" stroke={O} strokeWidth="2" />
      <circle cx="32" cy="35" r="21" fill="#a16207" stroke={O} strokeWidth="2" />
      <ellipse cx="32" cy="43" rx="10" ry="8" fill="#e7c9a0" />
      <circle cx="24" cy="31" r="3" fill={O} />
      <circle cx="40" cy="31" r="3" fill={O} />
      <ellipse cx="32" cy="40" rx="4" ry="3" fill={O} />
    </g>
  ),
  owl: (
    <g>
      <path
        d="M14 14 L22 20 L32 16 L42 20 L50 14 L50 48 Q32 62 14 48 Z"
        fill="#8b5e34"
        stroke={O}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <ellipse cx="32" cy="46" rx="11" ry="9" fill="#e7c9a0" />
      <circle cx="24" cy="30" r="8" fill="#fff" stroke={O} strokeWidth="1.5" />
      <circle cx="40" cy="30" r="8" fill="#fff" stroke={O} strokeWidth="1.5" />
      <circle cx="24" cy="30" r="3.5" fill={O} />
      <circle cx="40" cy="30" r="3.5" fill={O} />
      <path d="M29 36 L35 36 L32 42 Z" fill="#f59e0b" />
    </g>
  ),
  apple: (
    <g>
      <path
        d="M32 18 C22 10 8 16 10 32 C12 48 22 58 32 54 C42 58 52 48 54 32 C56 16 42 10 32 18 Z"
        fill="#ef4444"
        stroke={O}
        strokeWidth="2"
      />
      <path
        d="M32 18 Q31 10 35 6"
        fill="none"
        stroke="#78350f"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M34 12 Q44 4 50 10 Q42 16 34 12 Z" fill="#22c55e" stroke={O} strokeWidth="1.5" />
      <ellipse cx="21" cy="28" rx="3" ry="6" fill="#fff" opacity="0.6" />
    </g>
  ),
  sun: (
    <g stroke="#f59e0b" strokeWidth="4" strokeLinecap="round">
      <path d="M32 4 V12 M32 52 V60 M4 32 H12 M52 32 H60 M12 12 L18 18 M46 46 L52 52 M52 12 L46 18 M12 52 L18 46" />
      <circle cx="32" cy="32" r="14" fill="#fde047" stroke={O} strokeWidth="2" />
    </g>
  ),
  car: (
    <g>
      <path
        d="M8 40 L12 30 L20 30 L26 20 L42 20 L48 30 L56 32 L56 42 L8 42 Z"
        fill="#3b82f6"
        stroke={O}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M28 23 L40 23 L44 30 L24 30 Z" fill="#bfdbfe" />
      <circle cx="20" cy="44" r="6" fill={O} />
      <circle cx="44" cy="44" r="6" fill={O} />
      <circle cx="20" cy="44" r="2.5" fill="#d1d5db" />
      <circle cx="44" cy="44" r="2.5" fill="#d1d5db" />
    </g>
  ),
  ball: (
    <g>
      <circle cx="32" cy="32" r="24" fill="#fff" stroke={O} strokeWidth="2" />
      <path d="M32 22 L41 28 L38 38 L26 38 L23 28 Z" fill={O} />
      <path
        d="M32 22 V9 M41 28 L53 24 M38 38 L46 49 M26 38 L18 49 M23 28 L11 24"
        stroke={O}
        strokeWidth="2"
      />
    </g>
  ),
  star: (
    <path
      d="M32 5 L39.6 23.6 L59.6 25 L44.3 37.9 L49.1 57.4 L32 46.8 L14.9 57.4 L19.7 37.9 L4.4 25 L24.4 23.6 Z"
      fill="#facc15"
      stroke={O}
      strokeWidth="2"
      strokeLinejoin="round"
    />
  ),
  rocket: (
    <g>
      <path
        d="M32 4 C44 14 46 32 42 46 L22 46 C18 32 20 14 32 4 Z"
        fill="#e5e7eb"
        stroke={O}
        strokeWidth="2"
      />
      <path
        d="M22 36 L12 48 L22 46 Z M42 36 L52 48 L42 46 Z"
        fill="#ef4444"
        stroke={O}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="24" r="6" fill="#60a5fa" stroke={O} strokeWidth="2" />
      <path d="M26 48 Q32 62 38 48 Z" fill="#f97316" />
    </g>
  ),
};

export function Picture({ id, size = 48 }: { id: PictureId; size?: number }) {
  const label = getPicture(id)?.label ?? id;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={label}>
      <title>{label}</title>
      {DRAWINGS[id]}
    </svg>
  );
}
