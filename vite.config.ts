import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Keep the standalone PerfTest reachable at /Legend-of-Morvath/experiments/perftest/
// after the Pages deploy switched to GitHub Actions (only dist/ is published).
function copyPerfTest(): Plugin {
  return {
    name: 'copy-perftest',
    apply: 'build',
    closeBundle() {
      const root = import.meta.dirname;
      // The PerfTest reads ../../docs/art-style/tokens.{css,json}, so ship those too.
      const paths = [
        'experiments/perftest',
        'docs/art-style/tokens.css',
        'docs/art-style/tokens.json',
      ];
      for (const path of paths) {
        const from = resolve(root, path);
        if (existsSync(from)) {
          cpSync(from, resolve(root, 'dist', path), { recursive: true });
        }
      }
    },
  };
}

export default defineConfig({
  // A new value per build: data and language files are fetched with it, so a browser never
  // mixes new code with old (cached) JSON after a deploy.
  define: {
    __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 12) ?? String(Date.now())),
  },
  // GitHub Pages serves the project at https://ljwceo.github.io/Legend-of-Morvath/
  base: '/Legend-of-Morvath/',
  build: {
    target: 'es2022',
    sourcemap: true,
    // Each output file must stay below this size (scripts/check-bundle.mjs fails CI above it).
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // Libraries go into their own files: they change rarely, so browsers keep them cached
        // across deploys, and no single file grows towards the size limit.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  plugins: [copyPerfTest()],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
