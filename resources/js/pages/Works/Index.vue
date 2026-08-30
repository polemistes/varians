<script setup lang="ts">
import { Head, Link, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import { isEditorOrAbove } from '@/lib/auth';
import { create, show } from '@/routes/works';
import type { Auth } from '@/types/auth';
import type { Work } from '@/types/models';

defineProps<{
    works: Work[];
}>();

const page = usePage<{ auth: Auth }>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));
</script>

<template>
    <Head title="Works" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-3xl">
            <AppHeader />

            <div class="mb-8 flex items-baseline justify-between gap-4">
                <div>
                    <h1 class="mb-1 font-serif text-2xl font-medium">Works</h1>
                    <p class="text-sm text-stone-500 dark:text-stone-400">
                        Ancient texts available for transcription and edition.
                    </p>
                </div>
                <Link
                    v-if="canEdit"
                    :href="create.url()"
                    class="rounded bg-stone-900 px-3 py-1.5 text-sm text-white dark:bg-stone-100 dark:text-stone-900"
                >
                    New work
                </Link>
            </div>

            <ul class="flex flex-col gap-3">
                <li v-for="work in works" :key="work.id">
                    <Link
                        :href="show.url(work)"
                        class="block rounded-lg border border-stone-200 p-4 transition hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"
                    >
                        <div class="flex items-baseline justify-between gap-4">
                            <span class="font-serif text-lg">{{
                                work.title
                            }}</span>
                            <span
                                v-if="work.author"
                                class="text-sm text-stone-500 dark:text-stone-400"
                                >{{ work.author }}</span
                            >
                        </div>
                        <div
                            class="mt-1 text-xs text-stone-500 dark:text-stone-400"
                        >
                            {{ work.language }} ·
                            {{ work.reference_scheme?.name }}
                        </div>
                    </Link>
                </li>
            </ul>
        </div>
    </div>
</template>
