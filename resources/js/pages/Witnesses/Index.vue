<script setup lang="ts">
import { Head, Link, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import { isEditorOrAbove } from '@/lib/auth';
import { create, show } from '@/routes/witnesses';
import type { Auth } from '@/types/auth';
import type { Witness } from '@/types/models';

defineProps<{
    witnesses: Witness[];
}>();

const page = usePage<{ auth: Auth }>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));
</script>

<template>
    <Head title="Witnesses" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-3xl">
            <AppHeader />

            <div class="mb-8 flex items-baseline justify-between gap-4">
                <div>
                    <h1 class="mb-1 font-serif text-2xl font-medium">
                        Witnesses
                    </h1>
                    <p class="text-sm text-stone-500 dark:text-stone-400">
                        Manuscripts, printed editions, and other sources — each
                        may attest to one or several works.
                    </p>
                </div>
                <Link
                    v-if="canEdit"
                    :href="create.url()"
                    class="rounded bg-stone-900 px-3 py-1.5 text-sm whitespace-nowrap text-white dark:bg-stone-100 dark:text-stone-900"
                >
                    New witness
                </Link>
            </div>

            <ul class="flex flex-col gap-3">
                <li v-for="witness in witnesses" :key="witness.id">
                    <Link
                        :href="show.url(witness)"
                        class="block rounded-lg border border-stone-200 p-4 transition hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"
                    >
                        <div class="flex items-baseline justify-between gap-4">
                            <span class="font-serif text-lg"
                                >{{ witness.siglum }} &mdash;
                                {{ witness.label }}</span
                            >
                            <span
                                class="text-xs text-stone-500 dark:text-stone-400"
                                >{{ witness.type }}</span
                            >
                        </div>
                        <div
                            v-if="witness.works?.length"
                            class="mt-1 text-xs text-stone-500 dark:text-stone-400"
                        >
                            {{ witness.works.map((w) => w.title).join(', ') }}
                        </div>
                    </Link>
                </li>
                <li
                    v-if="witnesses.length === 0"
                    class="text-sm text-stone-500 dark:text-stone-400"
                >
                    No witnesses registered yet.
                </li>
            </ul>
        </div>
    </div>
</template>
