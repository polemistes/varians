import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import {
    provenance,
    recordedAt,
    recordedOn,
    useHydrated,
} from '@/lib/provenance';

/**
 * Recorded dates are shown in the reader's locale — which the server
 * rendering the page cannot know. Until a browser has mounted the page the
 * formatters give a locale-free form that server and client render
 * identically, so hydration finds what it expects (a mismatch was logged on
 * every witness page load); from the first mount on, the reader's locale.
 */
const iso = '2026-09-10T18:21:00.000000Z';

describe('a recorded date before and after the page mounts', () => {
    it('is locale-free until a component mounts', () => {
        expect(recordedOn(iso)).toBe('2026-09-10');
        expect(recordedAt(iso)).toBe('2026-09-10 18:21 UTC');
        expect(provenance('Anna Lyt', iso)).toBe('Anna Lyt · 2026-09-10');
        expect(provenance(null, null)).toBe('');
    });

    it("takes the reader's locale once a component calling useHydrated has mounted", async () => {
        const Shown = defineComponent({
            setup() {
                useHydrated();

                return () => h('span', recordedOn(iso));
            },
        });

        const wrapper = mount(Shown);
        await nextTick();

        expect(wrapper.text()).toBe(
            new Date(iso).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
            }),
        );
        expect(wrapper.text()).not.toBe('2026-09-10');
    });
});
