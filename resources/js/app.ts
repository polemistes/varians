import { createInertiaApp, router } from '@inertiajs/vue3';
import type { Auth } from '@/types/auth';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

createInertiaApp({
    title: (title) => (title ? `${title} - ${appName}` : appName),
    progress: {
        color: '#4B5563',
    },
});

// The blade root sets data-greek-font server-side for the first paint;
// this keeps it current across Inertia visits, so saving a new font on
// the profile page takes effect immediately, no full reload needed.
router.on('success', (event) => {
    const auth = event.detail.page.props.auth as Auth | undefined;
    document.documentElement.dataset.greekFont =
        auth?.user?.greek_font ?? 'eb-garamond';
});
