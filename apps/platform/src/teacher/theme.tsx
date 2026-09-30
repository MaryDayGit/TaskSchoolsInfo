import { useEffect, useState } from 'react';
import { store } from '../lib/storage';

// Тема кабинета учителя (на этом устройстве). Все темы спокойные, а один яркий
// цвет — только у главных кнопок, чтобы сразу было видно, куда нажимать.

export const TEACHER_THEMES = [
  { id: 'light', label: 'Світла' },
  { id: 'warm', label: 'Тепла' },
  { id: 'dark', label: 'Темна' },
] as const;

export type TeacherTheme = (typeof TEACHER_THEMES)[number]['id'];

const isTheme = (v: unknown): v is TeacherTheme => TEACHER_THEMES.some((t) => t.id === v);

/** Puts the theme on <html> while the cabinet is open (the pupil page has its own). */
export function useTeacherTheme(): [TeacherTheme, (t: TeacherTheme) => void] {
  const [theme, setTheme] = useState<TeacherTheme>(() => {
    const saved = store.get<unknown>('teacherTheme', 'light');
    return isTheme(saved) ? saved : 'light';
  });
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.tt = theme;
    return () => {
      delete root.dataset.tt;
    };
  }, [theme]);
  return [
    theme,
    (t) => {
      store.set('teacherTheme', t);
      setTheme(t);
    },
  ];
}

export function ThemeSwitcher({
  theme,
  onChange,
}: {
  theme: TeacherTheme;
  onChange: (t: TeacherTheme) => void;
}) {
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Тема кабінету">
      {TEACHER_THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={theme === t.id}
          className={`theme-opt theme-opt-${t.id}${theme === t.id ? ' on' : ''}`}
          onClick={() => onChange(t.id)}
          title={`Тема: ${t.label}`}
        >
          <span className="theme-dot" aria-hidden="true" />
          {t.label}
        </button>
      ))}
    </div>
  );
}
