/// <reference types="vitest" />
import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/; a relative base works for any repo name.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: 'index.html', devlog: 'devlog.html' } },
  },
  server: { host: true },
  // BadGun is a git submodule with its own test suite (run in its own repo)
  test: { exclude: ['**/node_modules/**', 'vendor/**'] },
});
