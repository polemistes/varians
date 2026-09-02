<script setup lang="ts">
import { Head, useForm } from '@inertiajs/vue3';
import AppHeader from '@/components/AppHeader.vue';
import { store } from '@/routes/witnesses';

const form = useForm({
    siglum: '',
    label: '',
    repository: '',
    shelfmark: '',
    date_text: '',
    description: '',
});

function submit() {
    form.post(store.url());
}
</script>

<template>
    <Head title="New witness" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-2xl">
            <AppHeader />

            <h1 class="mt-2 mb-1 font-serif text-2xl font-medium">
                New witness
            </h1>
            <p class="mb-6 text-sm text-stone-500 dark:text-stone-400">
                A witness isn't tied to any work yet — it becomes connected to
                one once a transcription of it has a segment citing it.
            </p>

            <form class="flex flex-col gap-4" @submit.prevent="submit">
                <label class="flex flex-col gap-1 text-sm">
                    Siglum
                    <input
                        v-model="form.siglum"
                        type="text"
                        placeholder="e.g. A"
                        class="w-28 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                    <span
                        v-if="form.errors.siglum"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ form.errors.siglum }}</span
                    >
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    Label
                    <input
                        v-model="form.label"
                        type="text"
                        placeholder="e.g. Venetus A"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                </label>

                <!-- Every physical detail is optional: a collection of
                     readings from the Suda has no shelfmark, and there is no
                     witness "type" to pick — the empty fields say it all. -->
                <label class="flex flex-col gap-1 text-sm">
                    Date
                    <input
                        v-model="form.date_text"
                        type="text"
                        placeholder="e.g. s. X"
                        class="w-40 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                </label>
                <label class="flex flex-col gap-1 text-sm">
                    Repository
                    <input
                        v-model="form.repository"
                        type="text"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                </label>
                <label class="flex flex-col gap-1 text-sm">
                    Shelfmark
                    <input
                        v-model="form.shelfmark"
                        type="text"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                </label>
                <label class="flex flex-col gap-1 text-sm">
                    Description
                    <textarea
                        v-model="form.description"
                        rows="3"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    ></textarea>
                </label>

                <button
                    type="submit"
                    class="self-start rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                    :disabled="form.processing"
                >
                    {{ form.processing ? 'Creating…' : 'Register witness' }}
                </button>
            </form>
        </div>
    </div>
</template>
