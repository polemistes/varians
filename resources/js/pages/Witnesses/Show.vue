<script setup lang="ts">
import { Head, Link, router, useForm, usePage } from '@inertiajs/vue3';
import { computed, ref, watch } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import ManuscriptImageViewer from '@/components/ManuscriptImageViewer.vue';
import { isEditorOrAbove } from '@/lib/auth';
import {
    confirmDeletion,
    describeDeletionImpact,
    pluralize,
} from '@/lib/deletionImpact';
import {
    destroy as destroyFeature,
    store as storeFeature,
} from '@/routes/manuscript-image-features';
import {
    destroy as destroyImage,
    store as storeImage,
} from '@/routes/manuscript-images';
import { show as showTranscription } from '@/routes/transcriptions';
import { create as createFork } from '@/routes/transcriptions/fork';
import {
    destroy as destroyWitness,
    index as witnessesIndex,
} from '@/routes/witnesses';
import { store as storeTranscription } from '@/routes/witnesses/transcriptions';
import { show as showWork } from '@/routes/works';
import type { Auth } from '@/types/auth';
import type { ManuscriptImage, Witness } from '@/types/models';

const props = defineProps<{
    witness: Witness;
}>();

const page = usePage<{ auth: Auth }>();
const canEdit = computed(() => isEditorOrAbove(page.props.auth.user));

function removeWitness() {
    const parts = describeDeletionImpact(props.witness.deletion_impact, [
        {
            key: 'transcriptions',
            label: (n) => pluralize(n, 'transcription'),
        },
        { key: 'segments', label: (n) => pluralize(n, 'citation') },
        { key: 'regions', label: (n) => pluralize(n, 'image alignment') },
        { key: 'images', label: (n) => pluralize(n, 'manuscript image') },
        {
            key: 'editionSelections',
            label: (n) =>
                pluralize(
                    n,
                    'lemma selection in a published edition',
                    'lemma selections in published editions',
                ),
        },
        {
            key: 'editionPassages',
            label: (n) =>
                pluralize(
                    n,
                    'line currently sourced from this witness in a published edition',
                    'lines currently sourced from this witness in published editions',
                ),
        },
    ]);

    if (!confirmDeletion(`witness ${props.witness.siglum}`, parts)) {
        return;
    }

    router.delete(destroyWitness.url(props.witness));
}

const manuscriptSummary = computed(() => {
    const manuscript = props.witness.manuscript;

    if (!manuscript) {
        return null;
    }

    const location = [manuscript.repository, manuscript.shelfmark]
        .filter(Boolean)
        .join(', ');
    const date = manuscript.date_text ? `(${manuscript.date_text})` : '';

    return [location, date].filter(Boolean).join(' ') || null;
});

const images = computed(() => props.witness.manuscript?.images ?? []);
const selectedImageId = ref<number | null>(images.value[0]?.id ?? null);

// Freshly uploaded images arrive via a normal prop reload, but a plain ref
// set once at setup time wouldn't notice — without this, a first upload
// (going from no images to one) stayed invisible until a manual reload.
// The same reload also has to recover if the *selected* image was the one
// just deleted, or selectedImageId would keep pointing at a dead id.
watch(images, (current) => {
    if (
        selectedImageId.value !== null &&
        !current.some((image) => image.id === selectedImageId.value)
    ) {
        selectedImageId.value = current[0]?.id ?? null;
    } else if (selectedImageId.value === null && current.length > 0) {
        selectedImageId.value = current[0].id;
    }
});

const selectedImage = computed(
    () =>
        images.value.find((image) => image.id === selectedImageId.value) ??
        null,
);

const imageUploadForm = useForm<{ folio_label: string; image: File | null }>({
    folio_label: '',
    image: null,
});

function onImageFileChange(event: Event) {
    imageUploadForm.image =
        (event.target as HTMLInputElement).files?.[0] ?? null;
}

function uploadImage() {
    if (!props.witness.manuscript) {
        return;
    }

    imageUploadForm.post(storeImage.url(props.witness.manuscript.id), {
        preserveScroll: true,
        onSuccess: () => imageUploadForm.reset(),
    });
}

function removeImage(image: ManuscriptImage) {
    const parts = describeDeletionImpact(image.deletion_impact, [
        { key: 'features', label: (n) => pluralize(n, 'marked feature') },
        { key: 'regions', label: (n) => pluralize(n, 'image alignment') },
    ]);

    if (!confirmDeletion(`fol. ${image.folio_label}`, parts)) {
        return;
    }

    router.delete(destroyImage.url(image), { preserveScroll: true });
}

const markingFeature = ref(false);
const featureLabel = ref('');

function armFeatureDrawing() {
    if (!featureLabel.value) {
        return;
    }

    markingFeature.value = true;
}

function onFeatureDrawn(box: {
    x: number;
    y: number;
    width: number;
    height: number;
}) {
    if (!selectedImageId.value) {
        return;
    }

    router.post(
        storeFeature.url(selectedImageId.value),
        { label: featureLabel.value, ...box },
        {
            preserveScroll: true,
            onSuccess: () => {
                featureLabel.value = '';
                markingFeature.value = false;
            },
        },
    );
}

function removeFeature(featureId: number) {
    router.delete(destroyFeature.url(featureId), { preserveScroll: true });
}

const transcriptionForm = useForm({});

function submitTranscription() {
    transcriptionForm.post(storeTranscription.url(props.witness));
}
</script>

<template>
    <Head :title="`${props.witness.siglum} — ${props.witness.label}`" />

    <div
        class="min-h-screen bg-[#FDFDFC] p-6 text-[#1b1b18] lg:p-12 dark:bg-[#0a0a0a] dark:text-[#EDEDEC]"
    >
        <div class="mx-auto max-w-3xl">
            <AppHeader />

            <Link
                :href="witnessesIndex.url()"
                class="text-sm text-stone-500 hover:underline dark:text-stone-400"
            >
                &larr; Witnesses
            </Link>

            <div class="mt-2 mb-1 flex items-baseline gap-3">
                <h1 class="font-serif text-2xl font-medium">
                    {{ props.witness.siglum }} &mdash;
                    {{ props.witness.label }}
                </h1>
                <span class="text-xs text-stone-500 dark:text-stone-400">{{
                    props.witness.type
                }}</span>
            </div>
            <div class="mb-8 flex items-center justify-between gap-4">
                <p
                    v-if="manuscriptSummary"
                    class="text-sm text-stone-600 dark:text-stone-400"
                >
                    {{ manuscriptSummary }}
                </p>
                <span v-else />
                <button
                    v-if="canEdit"
                    type="button"
                    class="text-red-600 underline dark:text-red-400"
                    @click="removeWitness"
                >
                    Delete witness
                </button>
            </div>

            <section class="mb-10">
                <h2 class="mb-3 font-serif text-lg">Works</h2>
                <ul class="mb-3 flex flex-wrap gap-2">
                    <li v-for="work in props.witness.works" :key="work.id">
                        <Link
                            :href="showWork.url(work)"
                            class="rounded-full border border-stone-200 px-3 py-1 text-sm hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"
                        >
                            {{ work.title }}
                        </Link>
                    </li>
                    <li
                        v-if="!props.witness.works?.length"
                        class="text-sm text-stone-500 dark:text-stone-400"
                    >
                        Not yet associated with any work.
                    </li>
                </ul>
                <p
                    v-if="canEdit"
                    class="text-xs text-stone-500 dark:text-stone-400"
                >
                    A witness becomes connected to a work once one of its
                    transcriptions has a segment citing it.
                </p>
            </section>

            <section v-if="props.witness.manuscript" class="mb-10">
                <h2 class="mb-3 font-serif text-lg">Images</h2>

                <ManuscriptImageViewer
                    :image="selectedImage"
                    :features="selectedImage?.features ?? []"
                    :drawing-enabled="markingFeature"
                    @region-drawn="onFeatureDrawn"
                />
                <div v-if="images.length > 1" class="mt-3 flex flex-wrap gap-2">
                    <button
                        v-for="image in images"
                        :key="image.id"
                        type="button"
                        class="rounded border px-2 py-1 text-xs"
                        :class="
                            image.id === selectedImageId
                                ? 'border-stone-500 bg-stone-100 dark:bg-stone-800'
                                : 'border-stone-200 dark:border-stone-800'
                        "
                        @click="selectedImageId = image.id"
                    >
                        fol. {{ image.folio_label }}
                    </button>
                </div>

                <form
                    v-if="canEdit"
                    class="mt-3 flex flex-wrap items-center gap-2"
                    @submit.prevent="uploadImage"
                >
                    <input
                        v-model="imageUploadForm.folio_label"
                        type="text"
                        placeholder="folio (e.g. 12r)"
                        class="w-28 rounded border border-stone-300 bg-transparent px-2 py-1 text-xs dark:border-stone-700"
                    />
                    <input
                        type="file"
                        accept="image/*"
                        class="text-xs"
                        @change="onImageFileChange"
                    />
                    <button
                        type="submit"
                        class="rounded border border-stone-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-stone-700"
                        :disabled="
                            imageUploadForm.processing ||
                            !imageUploadForm.folio_label ||
                            !imageUploadForm.image
                        "
                    >
                        Upload page
                    </button>
                    <span
                        v-if="imageUploadForm.errors.image"
                        class="text-xs text-red-600 dark:text-red-400"
                    >
                        {{ imageUploadForm.errors.image }}
                    </span>
                </form>

                <div
                    v-if="selectedImage"
                    class="mt-4 rounded-lg border border-dashed border-stone-300 p-3 dark:border-stone-700"
                >
                    <div
                        v-if="canEdit"
                        class="mb-2 flex items-center justify-between gap-4"
                    >
                        <p class="text-xs text-stone-500 dark:text-stone-400">
                            Mark an illustration, damage, or other non-textual
                            feature on this page.
                        </p>
                        <button
                            type="button"
                            class="shrink-0 text-xs text-red-600 underline dark:text-red-400"
                            @click="removeImage(selectedImage)"
                        >
                            Delete this page
                        </button>
                    </div>
                    <div
                        v-if="canEdit"
                        class="flex flex-wrap items-center gap-2"
                    >
                        <input
                            v-model="featureLabel"
                            type="text"
                            placeholder="e.g. Illustration"
                            class="flex-1 rounded border border-stone-300 bg-transparent px-2 py-1 text-sm dark:border-stone-700"
                        />
                        <button
                            v-if="!markingFeature"
                            type="button"
                            class="rounded border border-stone-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-stone-700"
                            :disabled="!featureLabel"
                            @click="armFeatureDrawing"
                        >
                            Draw on image
                        </button>
                        <span
                            v-else
                            class="text-xs text-sky-700 dark:text-sky-400"
                        >
                            Drag a box on the image above&hellip;
                            <button
                                type="button"
                                class="ml-1 underline"
                                @click="markingFeature = false"
                            >
                                Cancel
                            </button>
                        </span>
                    </div>

                    <ul
                        v-if="selectedImage.features?.length"
                        class="mt-3 flex flex-wrap gap-1"
                    >
                        <li
                            v-for="feature in selectedImage.features"
                            :key="feature.id"
                            class="rounded border border-stone-200 px-1.5 py-0.5 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400"
                        >
                            {{ feature.label }}
                            <span
                                v-if="canEdit"
                                class="ml-1 text-red-500"
                                @click="removeFeature(feature.id)"
                                >×</span
                            >
                        </li>
                    </ul>
                </div>
            </section>

            <section>
                <h2 class="mb-3 font-serif text-lg">Transcriptions</h2>
                <ul class="mb-3 flex flex-col gap-3">
                    <li
                        v-for="transcription in props.witness.transcriptions"
                        :key="transcription.id"
                        class="rounded-lg border border-stone-200 p-4 dark:border-stone-800"
                    >
                        <Link
                            :href="showTranscription.url(transcription.id)"
                            class="block hover:opacity-80"
                        >
                            <div
                                class="flex items-baseline justify-between gap-4"
                            >
                                <span class="flex flex-wrap gap-1">
                                    <span
                                        v-for="tag in transcription.tags"
                                        :key="tag.id"
                                        class="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                                        >{{ tag.name }}</span
                                    >
                                    <span
                                        v-if="!transcription.tags?.length"
                                        class="text-xs text-stone-400 italic dark:text-stone-600"
                                        >untagged</span
                                    >
                                </span>
                                <span
                                    class="rounded bg-stone-100 px-1 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                                    >{{ transcription.layer }}</span
                                >
                                <span
                                    class="text-xs text-stone-500 dark:text-stone-400"
                                    >{{ transcription.visibility }}</span
                                >
                            </div>
                            <div
                                class="mt-1 text-xs text-stone-500 dark:text-stone-400"
                            >
                                by {{ transcription.user?.name }}
                            </div>
                        </Link>
                        <Link
                            v-if="canEdit"
                            :href="createFork.url(transcription.id)"
                            class="mt-2 inline-block text-xs text-stone-500 underline dark:text-stone-400"
                        >
                            Fork &rarr;
                        </Link>
                    </li>
                    <li
                        v-if="!props.witness.transcriptions?.length"
                        class="text-sm text-stone-500 dark:text-stone-400"
                    >
                        No transcriptions of this witness yet.
                    </li>
                </ul>

                <form
                    v-if="canEdit"
                    class="flex items-center gap-2"
                    @submit.prevent="submitTranscription"
                >
                    <button
                        type="submit"
                        class="rounded bg-stone-900 px-3 py-1 text-xs text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                        :disabled="transcriptionForm.processing"
                    >
                        Start blank transcription
                    </button>
                </form>
            </section>
        </div>
    </div>
</template>
