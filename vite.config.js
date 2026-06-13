import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The client lives in /client and builds to /dist, which the Express
// server serves in production. In dev, Vite runs on 5173 and proxies
// API + websocket traffic to the Express server on PORT (default 8080).
const API_TARGET = `http://localhost:${process.env.PORT || 8080}`;

export default defineConfig({
  root: 'client',
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/socket.io': { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
