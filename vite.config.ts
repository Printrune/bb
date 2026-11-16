import { defineConfig } from 'vite';

const gameServerUrl = process.env.VITE_GAME_SERVER_URL;
if (gameServerUrl) {
  const endpoint = new URL(gameServerUrl);
  const local = endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1';
  if ((!local && endpoint.protocol !== 'https:') || !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('VITE_GAME_SERVER_URL must be an HTTPS origin without a path or credentials.');
  }
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  worker: { format: 'es' },
  build: { outDir: 'dist/client', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { middlewareMode: true },
});
