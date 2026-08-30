<script setup lang="ts">
import { Head, Link, useForm } from '@inertiajs/vue3';
import { ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import { index as worksIndex, store } from '@/routes/works';
import type { ReferenceScheme } from '@/types/models';

const props = defineProps<{
    referenceSchemes: ReferenceScheme[];
}>();

const useExistingScheme = ref(props.referenceSchemes.length > 0);
const slugTouched = ref(false);

const form = useForm({
    title: '',
    author: '',
    language: '',
    slug: '',
    reference_scheme_id: '' as number | '',
    new_scheme_name: '',
    levels: [{ key: '', label: '', type: 'integer', separator: '' }],
});

function slugify(value: string) {
    return value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function onTitleInput() {
    if (!slugTouched.value) {
        form.slug = slugify(form.title);
    }
}

function addLevel() {
    form.levels.push({ key: '', label: '', type: 'integer', separator: '.' });
}

function removeLevel(index: number) {
    form.levels.splice(index, 1);
}

function submit() {
    form.transform((data) => ({
        ...data,
        reference_scheme_id: useExistingScheme.value
            ? data.reference_scheme_id || null
            : null,
        new_scheme_name: useExistingScheme.value ? null : data.new_scheme_name,
        levels: useExistingScheme.value ? null : data.levels,
    })).post(store.url());
}
</script>

<template>
    <Head title="New work" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-2xl">
            <AppHeader />

            <Link
                :href="worksIndex.url()"
                class="text-sm text-stone-500 hover:underline dark:text-stone-400"
            >
                &larr; Works
            </Link>

            <h1 class="mt-2 mb-6 font-serif text-2xl font-medium">New work</h1>

            <form class="flex flex-col gap-4" @submit.prevent="submit">
                <label class="flex flex-col gap-1 text-sm">
                    Title
                    <input
                        v-model="form.title"
                        type="text"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                        @input="onTitleInput"
                    />
                    <span
                        v-if="form.errors.title"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ form.errors.title }}</span
                    >
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    Author
                    <input
                        v-model="form.author"
                        type="text"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    Language (ISO code)
                    <input
                        v-model="form.language"
                        type="text"
                        placeholder="grc"
                        class="w-32 rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                    />
                    <span
                        v-if="form.errors.language"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ form.errors.language }}</span
                    >
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    Slug
                    <input
                        v-model="form.slug"
                        type="text"
                        class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                        @input="slugTouched = true"
                    />
                    <span
                        v-if="form.errors.slug"
                        class="text-xs text-red-600 dark:text-red-400"
                        >{{ form.errors.slug }}</span
                    >
                </label>

                <fieldset
                    class="rounded-lg border border-stone-200 p-3 dark:border-stone-800"
                >
                    <legend class="px-1 text-sm font-medium">
                        Reference scheme
                    </legend>
                    <p class="mb-3 text-xs text-stone-500 dark:text-stone-400">
                        Defines how passages of this work are cited — e.g. book
                        and line for epic, or Stephanus page and section for
                        Plato.
                    </p>

                    <div class="mb-3 flex gap-4 text-sm">
                        <label class="flex items-center gap-1">
                            <input
                                type="radio"
                                :checked="useExistingScheme"
                                :disabled="referenceSchemes.length === 0"
                                @change="useExistingScheme = true"
                            />
                            Use existing
                        </label>
                        <label class="flex items-center gap-1">
                            <input
                                type="radio"
                                :checked="!useExistingScheme"
                                @change="useExistingScheme = false"
                            />
                            Define new
                        </label>
                    </div>

                    <div v-if="useExistingScheme">
                        <select
                            v-model="form.reference_scheme_id"
                            class="w-full rounded border border-stone-300 bg-transparent px-2 py-1 text-sm dark:border-stone-700"
                        >
                            <option value="" disabled>
                                Choose a scheme&hellip;
                            </option>
                            <option
                                v-for="scheme in referenceSchemes"
                                :key="scheme.id"
                                :value="scheme.id"
                            >
                                {{ scheme.name }}
                            </option>
                        </select>
                        <span
                            v-if="form.errors.reference_scheme_id"
                            class="text-xs text-red-600 dark:text-red-400"
                        >
                            {{ form.errors.reference_scheme_id }}
                        </span>
                    </div>

                    <div v-else class="flex flex-col gap-3">
                        <label class="flex flex-col gap-1 text-sm">
                            Scheme name
                            <input
                                v-model="form.new_scheme_name"
                                type="text"
                                placeholder="Book and line numbering"
                                class="rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
                            />
                            <span
                                v-if="form.errors.new_scheme_name"
                                class="text-xs text-red-600 dark:text-red-400"
                            >
                                {{ form.errors.new_scheme_name }}
                            </span>
                        </label>

                        <p class="text-xs text-stone-500 dark:text-stone-400">
                            List citation levels in order, outermost first (e.g.
                            Book, then Line).
                        </p>

                        <div
                            v-for="(level, index) in form.levels"
                            :key="index"
                            class="flex items-center gap-2"
                        >
                            <input
                                v-model="level.key"
                                type="text"
                                placeholder="key (line)"
                                class="w-24 rounded border border-stone-300 bg-transparent px-2 py-1 text-sm dark:border-stone-700"
                            />
                            <input
                                v-model="level.label"
                                type="text"
                                placeholder="Label (Line)"
                                class="w-28 rounded border border-stone-300 bg-transparent px-2 py-1 text-sm dark:border-stone-700"
                            />
                            <select
                                v-model="level.type"
                                class="rounded border border-stone-300 bg-transparent px-2 py-1 text-sm dark:border-stone-700"
                            >
                                <option value="integer">Number</option>
                                <option value="string">Letter</option>
                            </select>
                            <input
                                v-model="level.separator"
                                type="text"
                                placeholder="sep (.)"
                                class="w-16 rounded border border-stone-300 bg-transparent px-2 py-1 text-sm dark:border-stone-700"
                            />
                            <button
                                v-if="form.levels.length > 1"
                                type="button"
                                class="text-xs text-red-600 hover:underline dark:text-red-400"
                                @click="removeLevel(index)"
                            >
                                Remove
                            </button>
                        </div>
                        <button
                            type="button"
                            class="self-start text-xs text-stone-600 underline dark:text-stone-400"
                            @click="addLevel"
                        >
                            Add level
                        </button>
                        <span
                            v-if="form.errors.levels"
                            class="text-xs text-red-600 dark:text-red-400"
                        >
                            {{ form.errors.levels }}
                        </span>
                    </div>
                </fieldset>

                <button
                    type="submit"
                    class="self-start rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                    :disabled="form.processing"
                >
                    {{ form.processing ? 'Creating…' : 'Create work' }}
                </button>
            </form>
        </div>
    </div>
</template>
