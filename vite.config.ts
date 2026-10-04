import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs: the Capacitor WebView serves the app from a custom origin, not from "/".
  base: './',
  server: {
    // Listen on all interfaces so a phone on the same Wi-Fi can open the dev server.
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    // PixiJS alone is ~500 kB minified; that is expected for a game, so don't warn about it.
    chunkSizeWarningLimit: 1000,
  },
});
