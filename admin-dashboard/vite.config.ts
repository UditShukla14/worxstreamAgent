import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built output is served by the agent server at /admin (same origin as /api → no CORS).
// In dev, API calls are proxied to the agent server.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': process.env.AGENT_URL || 'http://127.0.0.1:3000' },
  },
  build: { outDir: 'dist', sourcemap: false },
});
