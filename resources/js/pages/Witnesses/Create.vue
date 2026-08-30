<script setup lang="ts">
import { Head, Link, useForm } from '@inertiajs/vue3';
import AppHeader from '@/components/AppHeader.vue';
import { index as witnessesIndex, store } from '@/routes/witnesses';

const form = useForm({
    type: 'manuscript',
    siglum: '',
    label: '',
    repository: '',
    shelfmark: '',
    date_text: '',
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

            <Link
                :href="witnessesIndex.url()"
                class="text-sm text-stone-500 hover:underline dark:text-stone-400"
            >
                &larr; Witnesses
            </Link>

            <h1 class="mt-2 mb-1 font-serif text-2xl font-medium">
                New witness
            </h1>
            <p class="mb-6 text-sm text-stone-500 dark:text-stone-400">
                A witness isn't tied to any work yet — it becomes connected to
                one once a transcription of it has a segment citing it.
            </p>

            <form class="flex flex-col gap-4" @submit.prevent="submit">
                <label class="flex flex-col gap-1 text-sm">
                    Type
                    <select
                        v-model="form.type"
                        class="w-64 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    >
                        <option value="manuscript">Manuscript</option>
                        <option value="printed_edition">Printed edition</option>
                        <option value="apparatus_reconstruction">
                            Apparatus reconstruction
                        </option>
                    </select>
                    <span
                        v-if="form.errors.type"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ form.errors.type }}</span
                    >
                </label>

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

                <fieldset
                    v-if="form.type === 'manuscript'"
                    class="rounded-lg border border-stone-200 p-3 dark:border-stone-800"
                >
                    <legend class="px-1 text-sm font-medium">
                        Manuscript details
                    </legend>
                    <div class="flex flex-col gap-3">
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
                            Date
                            <input
                                v-model="form.date_text"
                                type="text"
                                placeholder="e.g. s. X"
                                class="w-40 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            />
                        </label>
                    </div>
                </fieldset>

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
