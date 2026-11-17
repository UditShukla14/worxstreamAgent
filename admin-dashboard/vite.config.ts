import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built output is served by the agent server at /admin (same origin as /api → no CORS).
// In dev, API calls are proxied to the agent server.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    // changeOrigin lets the proxy reach a remote https agent too (AGENT_URL=https://mcp.worxstream.ai npm run dev).
    proxy: { '/api': { target: process.env.AGENT_URL || 'http://127.0.0.1:3000', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
