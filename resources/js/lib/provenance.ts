/**
 * When a record was made, and by whom — what tells copies apart.
 *
 * A copy carries the original's name: two editions both called "Editio
 * maior", two witnesses both siglum "A". The owner and the date are the
 * only things on a list that distinguish them, so every list that can hold
 * a copy shows both.
 *
 * The DATE is shown and the exact TIME rides in the tooltip (user
 * decision): two copies made minutes apart are rare, and a clock time on
 * every row is noise the rest of the time.
 *
 * Both halves are in the reader's own locale and time zone — which the
 * server rendering the page cannot know. Server-side rendering formatted
 * them in the SERVER's locale ("10. sep. 2026"), the browser then expected
 * its own ("Sep 10, 2026"), and every witness page load logged a Vue
 * hydration mismatch (real bug). So until the page has mounted in a
 * browser the formatters give a locale-free ISO form that server and
 * client render identically; a component that shows them calls
 * `useHydrated()`, which flips them to the reader's locale once mounted.
 */
import { onMounted, ref } from 'vue';

/**
 * Whether a browser has mounted the page. False on the server and during
 * the hydration render, true from the first `onMounted` on — module-wide,
 * since one page mounting means every formatter may use the locale.
 */
const hydrated = ref(false);

/** Call from any component that renders a recorded date. */
export function useHydrated(): void {
    onMounted(() => {
        hydrated.value = true;
    });
}

/** "10 Sep 2026" — the visible half, in the reader's own locale. */
export function recordedOn(iso: string | null | undefined): string {
    const date = parse(iso);

    if (date === null) {
        return '';
    }

    if (!hydrated.value) {
        return date.toISOString().slice(0, 10);
    }

    return date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

/**
 * "10 September 2026 at 14:32" — the tooltip half, where the time is what
 * separates one copy from the next.
 */
export function recordedAt(iso: string | null | undefined): string {
    const date = parse(iso);

    if (date === null) {
        return '';
    }

    if (!hydrated.value) {
        const utc = date.toISOString();

        return `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC`;
    }

    return date.toLocaleString(undefined, {
        dateStyle: 'long',
        timeStyle: 'short',
    });
}

/**
 * One line for a list row: "Anna Lyt · 10 Sep 2026", either half alone
 * when the other is missing. An owner can be missing — the account was
 * deleted — and nothing here should render "undefined" at a reader.
 */
export function provenance(
    owner: string | null | undefined,
    iso: string | null | undefined,
): string {
    return [owner, recordedOn(iso)].filter((part) => !!part).join(' · ');
}

function parse(iso: string | null | undefined): Date | null {
    if (!iso) {
        return null;
    }

    const date = new Date(iso);

    return Number.isNaN(date.getTime()) ? null : date;
}
