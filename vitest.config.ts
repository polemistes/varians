import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The JS suite. Deliberately separate from vite.config.ts: the app's config
 * carries the Laravel, Inertia, Tailwind and Wayfinder plugins, none of
 * which a test run has any use for (Wayfinder shells out to artisan).
 *
 * What belongs here is what only a browser-shaped environment can check —
 * the transcription editor's caret and citation-claim behaviour above all
 * (see .ai/rules/pages-transcriptions.md). Everything the PHP suite can
 * reach stays in the PHP suite.
 */
export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./resources/js', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',
        include: ['resources/js/**/*.test.ts'],
    },
});
