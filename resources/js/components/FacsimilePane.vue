<script setup lang="ts">
import { router } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import ManuscriptImageViewer from '@/components/ManuscriptImageViewer.vue';
import {
    destroy as destroyImage,
    store as storeImage,
} from '@/routes/manuscript-images';
import { update as updateRegion } from '@/routes/transcription-regions';
import type {
    ManuscriptImage,
    ManuscriptPage,
    TranscriptionRegion,
    Witness,
} from '@/types/models';

const props = defineProps<{
    witness: Witness;
    selectedPage: ManuscriptPage | null;
    selectedImage: ManuscriptImage | null;
    /** Regions of the transcript layer open opposite, for the overlay. */
    regions: TranscriptionRegion[];
    hoveredRegionId: number | null;
    editableRegionId: number | null;
    drawingEnabled: boolean;
    canEdit: boolean;
    pagesCount: number;
}>();

const emit = defineEmits<{
    (
        e: 'region-drawn',
        box: { x: number; y: number; width: number; height: number },
    ): void;
    (e: 'select-region', id: number): void;
    (e: 'deselect'): void;
    (e: 'hover-region', id: number | null): void;
    (e: 'remove-region', id: number): void;
}>();

const featuresForSelectedImage = computed(
    () => props.selectedImage?.features ?? [],
);

const regionsForSelectedImage = computed(() =>
    props.regions.filter(
        (region) => region.manuscript_image_id === props.selectedImage?.id,
    ),
);

function onRegionMoved(
    id: number,
    box: { x: number; y: number; width: number; height: number },
) {
    router.patch(updateRegion.url(id), box, { preserveScroll: true });
}

// ---- add / delete images. Adding goes straight into the file dialog and
// uploads on choose — the photograph lands on the CURRENT page, no label to
// type and no second button to press.
const fileInputEl = ref<HTMLInputElement | null>(null);
const uploadError = ref<string | null>(null);
const uploading = ref(false);

function addImage() {
    uploadError.value = null;
    fileInputEl.value?.click();
}

function onFileChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file || !props.selectedPage) {
        return;
    }

    uploading.value = true;
    router.post(
        storeImage.url(props.witness.id),
        { folio_label: props.selectedPage.label, image: file },
        {
            preserveScroll: true,
            forceFormData: true,
            onSuccess: () => {
                uploading.value = false;
            },
            onError: (errors) => {
                uploading.value = false;
                uploadError.value =
                    Object.values(errors)[0] ??
                    'That image could not be uploaded.';
            },
            onFinish: () => {
                // Same file chosen twice must still fire change.
                input.value = '';
            },
        },
    );
}

function deleteImage() {
    const image = props.selectedImage;

    if (!image) {
        return;
    }

    const confirmed = window.confirm(
        `Delete this photograph of ${image.manuscript_page?.label ?? 'the page'}? Its feature markers and image alignments are deleted too.`,
    );

    if (!confirmed) {
        return;
    }

    router.delete(destroyImage.url(image.id), { preserveScroll: true });
}
</script>

<template>
    <div>
        <div
            v-if="props.canEdit"
            class="mb-2 flex flex-wrap items-center gap-2 text-xs"
        >
            <!-- ONE button: a page either lacks a photograph (offer Add)
                 or has one (offer Delete) — a greyed-out half of the pair
                 was never pressable. -->
            <button
                type="button"
                class="rounded border border-stone-300 px-2 py-1 disabled:opacity-40 dark:border-stone-700"
                :class="
                    props.selectedImage
                        ? 'text-red-600 dark:text-red-400'
                        : undefined
                "
                :disabled="!props.selectedPage || uploading"
                :title="
                    !props.selectedPage
                        ? 'Add a page first — the photograph lands on the current page'
                        : undefined
                "
                @click="props.selectedImage ? deleteImage() : addImage()"
            >
                {{
                    uploading
                        ? 'Uploading…'
                        : props.selectedImage
                          ? 'Delete image'
                          : 'Add image'
                }}
            </button>
            <input
                ref="fileInputEl"
                type="file"
                accept="image/*"
                class="hidden"
                @change="onFileChosen"
            />
            <span v-if="uploadError" class="text-red-600 dark:text-red-400">{{
                uploadError
            }}</span>
        </div>

        <p
            v-if="props.editableRegionId"
            class="mb-2 flex items-center justify-between text-xs text-sky-700 dark:text-sky-400"
        >
            <span>Drag the box's body to move it, or a handle to resize.</span>
            <span class="flex items-center gap-2">
                <button
                    type="button"
                    class="text-red-600 underline dark:text-red-400"
                    @click="emit('remove-region', props.editableRegionId!)"
                >
                    Delete
                </button>
                <button
                    type="button"
                    class="underline"
                    @click="emit('deselect')"
                >
                    Done
                </button>
            </span>
        </p>

        <ManuscriptImageViewer
            :image="props.selectedImage"
            :regions="regionsForSelectedImage"
            :features="featuresForSelectedImage"
            :highlighted-region-id="props.hoveredRegionId"
            :editable-region-id="props.editableRegionId"
            :drawing-enabled="props.drawingEnabled"
            @region-drawn="(box) => emit('region-drawn', box)"
            @region-moved="onRegionMoved"
            @select-region="(id) => emit('select-region', id)"
            @deselect="emit('deselect')"
            @hover-region="(id) => emit('hover-region', id)"
        >
            <!-- Plenty of pages are transcribed from a facsimile or the
                 manuscript itself, so having no photograph is ordinary
                 rather than an omission. -->
            <template #empty>
                <span v-if="props.selectedPage">
                    No photograph of {{ props.selectedPage.label }} yet.
                </span>
                <span v-else-if="props.pagesCount === 0">
                    No pages recorded for this witness yet.
                </span>
                <span v-else>Choose a page.</span>
            </template>
        </ManuscriptImageViewer>
    </div>
</template>
