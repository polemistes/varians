import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
      },
      adapter: adapter(),
      alias: {
        $core: '../../packages/core/src',
      },
    }),
  ],
  ssr: {
    // Workspace packages ship TypeScript source; bundle them for the server too.
    noExternal: ['@varians/core', '@varians/db'],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Server tests share one test database and seed the same sample; run files one at a time.
    fileParallelism: false,
  },
});
