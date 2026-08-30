<script setup lang="ts">
import { Head, Link, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import { isEditorOrAbove } from '@/lib/auth';
import {
    create as createWitness,
    index as witnessesIndex,
} from '@/routes/witnesses';
import { create as createWork, index as worksIndex } from '@/routes/works';
import type { Auth } from '@/types/auth';

defineProps<{
    workCount: number;
    witnessCount: number;
}>();

const page = usePage<{ auth: Auth }>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));
</script>

<template>
    <Head />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-3xl">
            <AppHeader />

            <header class="mb-16">
                <h1 class="font-serif text-4xl font-medium">Varians</h1>
                <p class="mt-2 text-stone-600 dark:text-stone-400">
                    A workspace for building digital critical editions of
                    ancient texts — manuscript transcription, image alignment,
                    and citation mapping in one place.
                </p>
            </header>

            <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <section
                    class="flex flex-col rounded-lg border border-stone-200 p-6 dark:border-stone-800"
                >
                    <h2 class="font-serif text-xl">Works</h2>
                    <p
                        class="mt-1 mb-6 text-sm text-stone-500 dark:text-stone-400"
                    >
                        The texts being edited — the {{ workCount }}
                        {{ workCount === 1 ? 'work' : 'works' }} registered so
                        far, each with its own citation scheme.
                    </p>
                    <div class="mt-auto flex items-center gap-4 text-sm">
                        <Link
                            :href="worksIndex.url()"
                            class="rounded bg-stone-900 px-3 py-1.5 text-white dark:bg-stone-100 dark:text-stone-900"
                        >
                            Browse works
                        </Link>
                        <Link
                            v-if="canEdit"
                            :href="createWork.url()"
                            class="text-stone-600 underline dark:text-stone-400"
                        >
                            + New work
                        </Link>
                    </div>
                </section>

                <section
                    class="flex flex-col rounded-lg border border-stone-200 p-6 dark:border-stone-800"
                >
                    <h2 class="font-serif text-xl">Witnesses</h2>
                    <p
                        class="mt-1 mb-6 text-sm text-stone-500 dark:text-stone-400"
                    >
                        The manuscripts and other sources — {{ witnessCount }}
                        {{ witnessCount === 1 ? 'witness' : 'witnesses' }}
                        registered, with their images and transcriptions.
                    </p>
                    <div class="mt-auto flex items-center gap-4 text-sm">
                        <Link
                            :href="witnessesIndex.url()"
                            class="rounded bg-stone-900 px-3 py-1.5 text-white dark:bg-stone-100 dark:text-stone-900"
                        >
                            Browse witnesses
                        </Link>
                        <Link
                            v-if="canEdit"
                            :href="createWitness.url()"
                            class="text-stone-600 underline dark:text-stone-400"
                        >
                            + New witness
                        </Link>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>
