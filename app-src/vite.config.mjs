import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// The '@' alias lets the REAL vendored library files (Motion Primitives, Kitchen) compile unmodified:
// their internal imports (@/lib/utils, @/helpers/classname-helper, @/hooks/...) resolve to the
// adapter re-exports in src/vendor/alias/ — no vendored byte changes.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: '@', replacement: resolve(HERE, 'src/vendor/alias') }],
  },
  base: './',
  build: { outDir: 'dist', sourcemap: false },
});
