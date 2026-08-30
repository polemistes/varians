<script setup lang="ts">
import { Head, Link, useForm } from '@inertiajs/vue3';
import AppHeader from '@/components/AppHeader.vue';
import { store } from '@/routes/editions';
import { show as showWork } from '@/routes/works';
import type { Work } from '@/types/models';

const props = defineProps<{
    work: Work;
}>();

const form = useForm({
    title: '',
    description: '',
});

function submit() {
    form.post(store.url(props.work));
}
</script>

<template>
    <Head title="New edition" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-2xl">
            <AppHeader />

            <Link
                :href="showWork.url(props.work)"
                class="text-sm text-stone-500 hover:underline dark:text-stone-400"
            >
                &larr; {{ props.work.title }}
            </Link>

            <h1 class="mt-2 mb-1 font-serif text-2xl font-medium">
                New edition
            </h1>
            <p class="mb-6 text-sm text-stone-500 dark:text-stone-400">
                An edition starts out empty — build it up passage by passage
                afterward, choosing readings from the work's transcriptions and
                conjectures.
            </p>

            <form class="flex flex-col gap-4" @submit.prevent="submit">
                <label class="flex flex-col gap-1 text-sm">
                    Title
                    <input
                        v-model="form.title"
                        type="text"
                        placeholder="e.g. Editio maior"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                    <span
                        v-if="form.errors.title"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ form.errors.title }}</span
                    >
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    Description
                    <textarea
                        v-model="form.description"
                        rows="3"
                        class="rounded border border-stone-300 bg-transparent p-2 dark:border-stone-700"
                    />
                    <span
                        v-if="form.errors.description"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ form.errors.description }}</span
                    >
                </label>

                <button
                    type="submit"
                    class="self-start rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                    :disabled="form.processing"
                >
                    {{ form.processing ? 'Creating…' : 'Create edition' }}
                </button>
            </form>
        </div>
    </div>
</template>
