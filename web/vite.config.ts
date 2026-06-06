import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In production the Mosaic Node server serves the built app, so /api and /ws are
// same-origin. For local `npm run dev`, proxy them to a server running on :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/overlay': 'http://localhost:8080',
      '/whep': 'http://localhost:8080', // covers /whep/:feed and /whep-resource
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
