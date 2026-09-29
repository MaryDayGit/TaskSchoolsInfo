import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Школьные ПК: Windows 7, Chrome 109 / Firefox 115 ESR. Весь код (и зависимости)
// переводится в синтаксис, который понимают эти браузеры.
export const BROWSER_TARGETS = ['chrome109', 'firefox115'];

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, host: true },
  preview: { port: 5174 },
  build: {
    target: BROWSER_TARGETS,
    cssTarget: BROWSER_TARGETS,
    sourcemap: true,
  },
});
