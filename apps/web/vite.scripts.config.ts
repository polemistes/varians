/**
 * The command-line scripts, bundled for a release: build/scripts/cli.js,
 * import-lexicon.js and migrate.js run with plain Node, without tsx and
 * without the TypeScript sources of the workspace packages (Node does not
 * strip types under node_modules). Run after the SvelteKit build, which
 * empties build/: `vite build && vite build -c vite.scripts.config.ts`.
 * In development the scripts still run from source with tsx.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { buildDefines } from './build-info.ts';

export default defineConfig({
  define: buildDefines(),
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
  },
  ssr: {
    // The workspace packages ship TypeScript source: bundle them. @sveltejs/kit is a development dependency
    // (the server bundle includes what it needs); the error helpers some server modules use are bundled too.
    // Everything else stays a dependency.
    noExternal: ['@varians/core', '@varians/db', '@sveltejs/kit'],
  },
  build: {
    ssr: true,
    outDir: 'build/scripts',
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        cli: 'scripts/cli.ts',
        'import-lexicon': 'scripts/import-lexicon.ts',
        migrate: 'scripts/migrate.ts',
      },
      output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});
