import { ref } from 'vue';

/**
 * The edition editor's cut passage range. Module-scoped (not component
 * state) so a range cut on one page of a long edition survives the Inertia
 * visit to another page and can be pasted there — the page component
 * remounts, the clipboard doesn't.
 */
export const editionOrderClipboard = ref<{
    editionId: number;
    startId: number;
    endId: number;
    label: string;
} | null>(null);
