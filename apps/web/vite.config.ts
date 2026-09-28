import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // changeOrigin stays false so the server's same-origin check for sockets passes.
    proxy: {
      '/api': { target: api },
      '/socket.io': { target: api, ws: true },
    },
  },
  build: {
    sourcemap: true,
  },
});
