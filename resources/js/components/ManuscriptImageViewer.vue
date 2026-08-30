<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import type {
    ManuscriptImage,
    ManuscriptImageFeature,
    TranscriptionRegion,
} from '@/types/models';

const props = withDefaults(
    defineProps<{
        image: ManuscriptImage | null;
        regions?: TranscriptionRegion[];
        features?: ManuscriptImageFeature[];
        highlightedRegionId?: number | null;
        editableRegionId?: number | null;
        drawingEnabled?: boolean;
    }>(),
    {
        regions: () => [],
        features: () => [],
        highlightedRegionId: null,
        editableRegionId: null,
        drawingEnabled: false,
    },
);

type Box = { x: number; y: number; width: number; height: number };

const emit = defineEmits<{
    (e: 'region-drawn', box: Box): void;
    (e: 'region-moved', id: number, box: Box): void;
    (e: 'select-region', id: number): void;
    (e: 'deselect'): void;
    (e: 'hover-region', id: number | null): void;
}>();

const HANDLES = [
    { name: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
    { name: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
    { name: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
    { name: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
    { name: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
    { name: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
    { name: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
    { name: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
] as const;

const scale = ref(1);
const offset = reactive({ x: 0, y: 0 });
const dragging = ref(false);
const lastPointer = reactive({ x: 0, y: 0 });
const imgEl = ref<HTMLImageElement | null>(null);
const containerEl = ref<HTMLDivElement | null>(null);
const drawBox = ref<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
} | null>(null);

// A move or resize in progress on the editable region. `draftBox` mirrors it
// for rendering (and lingers after the gesture ends, until the parent's next
// props update or a new edit starts) so the box never visibly snaps back
// while the PATCH round-trips.
const adjust = ref<{
    mode: 'move' | 'resize';
    handle?: (typeof HANDLES)[number]['name'];
    startBox: Box;
    startPointer: { x: number; y: number };
} | null>(null);
const draftBox = ref<Box | null>(null);

watch(
    () => props.editableRegionId,
    () => {
        draftBox.value = null;
    },
);

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function zoom(delta: number) {
    scale.value = Math.min(4, Math.max(1, scale.value + delta));

    if (scale.value === 1) {
        offset.x = 0;
        offset.y = 0;
    }
}

function onWheel(event: WheelEvent) {
    event.preventDefault();
    zoom(event.deltaY > 0 ? -0.2 : 0.2);
}

function pointerFraction(event: PointerEvent) {
    const rect = imgEl.value!.getBoundingClientRect();

    return {
        x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
}

function startInteraction(event: PointerEvent) {
    if (props.drawingEnabled && imgEl.value) {
        event.preventDefault();
        const { x, y } = pointerFraction(event);
        drawBox.value = { startX: x, startY: y, x, y, width: 0, height: 0 };
        containerEl.value?.setPointerCapture(event.pointerId);

        return;
    }

    // A pointerdown that reaches here (rather than being stopped by a
    // region's own handler) landed on the background — clicking away from
    // the selected region is the natural way to deselect it.
    if (props.editableRegionId !== null) {
        emit('deselect');
    }

    if (scale.value === 1) {
        return;
    }

    event.preventDefault();
    dragging.value = true;
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
    containerEl.value?.setPointerCapture(event.pointerId);
}

function regionBox(region: TranscriptionRegion): Box {
    return {
        x: Number(region.x),
        y: Number(region.y),
        width: Number(region.width),
        height: Number(region.height),
    };
}

function onRegionPointerDown(region: TranscriptionRegion, event: PointerEvent) {
    if (props.drawingEnabled) {
        return;
    }

    event.stopPropagation();

    if (region.id !== props.editableRegionId) {
        emit('select-region', region.id);

        return;
    }

    event.preventDefault();
    adjust.value = {
        mode: 'move',
        startBox: draftBox.value ?? regionBox(region),
        startPointer: pointerFraction(event),
    };
    containerEl.value?.setPointerCapture(event.pointerId);
}

function onHandlePointerDown(
    region: TranscriptionRegion,
    handle: (typeof HANDLES)[number]['name'],
    event: PointerEvent,
) {
    event.stopPropagation();
    event.preventDefault();
    adjust.value = {
        mode: 'resize',
        handle,
        startBox: draftBox.value ?? regionBox(region),
        startPointer: pointerFraction(event),
    };
    containerEl.value?.setPointerCapture(event.pointerId);
}

const MIN_BOX_SIZE = 0.004;

function applyMove(startBox: Box, dx: number, dy: number): Box {
    return {
        x: clamp(startBox.x + dx, 0, 1 - startBox.width),
        y: clamp(startBox.y + dy, 0, 1 - startBox.height),
        width: startBox.width,
        height: startBox.height,
    };
}

function applyResize(
    startBox: Box,
    handle: (typeof HANDLES)[number]['name'],
    dx: number,
    dy: number,
): Box {
    let { x, y, width, height } = startBox;

    if (handle.includes('e')) {
        width = Math.max(MIN_BOX_SIZE, startBox.width + dx);
    }

    if (handle.includes('s')) {
        height = Math.max(MIN_BOX_SIZE, startBox.height + dy);
    }

    if (handle.includes('w')) {
        width = Math.max(MIN_BOX_SIZE, startBox.width - dx);
        x = startBox.x + startBox.width - width;
    }

    if (handle.includes('n')) {
        height = Math.max(MIN_BOX_SIZE, startBox.height - dy);
        y = startBox.y + startBox.height - height;
    }

    return {
        x: clamp(x, 0, 1 - width),
        y: clamp(y, 0, 1 - height),
        width,
        height,
    };
}

function onMove(event: PointerEvent) {
    if (adjust.value && imgEl.value) {
        event.preventDefault();
        const { x, y } = pointerFraction(event);
        const dx = x - adjust.value.startPointer.x;
        const dy = y - adjust.value.startPointer.y;

        draftBox.value =
            adjust.value.mode === 'move'
                ? applyMove(adjust.value.startBox, dx, dy)
                : applyResize(
                      adjust.value.startBox,
                      adjust.value.handle!,
                      dx,
                      dy,
                  );

        return;
    }

    if (drawBox.value && imgEl.value) {
        event.preventDefault();
        const { x, y } = pointerFraction(event);
        drawBox.value.x = Math.min(drawBox.value.startX, x);
        drawBox.value.y = Math.min(drawBox.value.startY, y);
        drawBox.value.width = Math.abs(x - drawBox.value.startX);
        drawBox.value.height = Math.abs(y - drawBox.value.startY);

        return;
    }

    if (!dragging.value) {
        return;
    }

    offset.x += event.clientX - lastPointer.x;
    offset.y += event.clientY - lastPointer.y;
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
}

function stopInteraction(event: PointerEvent) {
    if (adjust.value) {
        if (props.editableRegionId !== null && draftBox.value) {
            emit('region-moved', props.editableRegionId, draftBox.value);
        }

        adjust.value = null;
    } else if (drawBox.value) {
        if (drawBox.value.width > 0.004 && drawBox.value.height > 0.004) {
            emit('region-drawn', {
                x: drawBox.value.x,
                y: drawBox.value.y,
                width: drawBox.value.width,
                height: drawBox.value.height,
            });
        }

        drawBox.value = null;
        window.getSelection()?.removeAllRanges();
    } else {
        dragging.value = false;
    }

    if (containerEl.value?.hasPointerCapture(event.pointerId)) {
        containerEl.value.releasePointerCapture(event.pointerId);
    }
}

function reset() {
    scale.value = 1;
    offset.x = 0;
    offset.y = 0;
}

function boxStyle(box: {
    x: string | number;
    y: string | number;
    width: string | number;
    height: string | number;
}) {
    return {
        left: `${Number(box.x) * 100}%`,
        top: `${Number(box.y) * 100}%`,
        width: `${Number(box.width) * 100}%`,
        height: `${Number(box.height) * 100}%`,
    };
}

function displayBox(region: TranscriptionRegion): Box {
    return region.id === props.editableRegionId && draftBox.value
        ? draftBox.value
        : regionBox(region);
}

function drawBoxStyle() {
    if (!drawBox.value) {
        return {};
    }

    return {
        left: `${drawBox.value.x * 100}%`,
        top: `${drawBox.value.y * 100}%`,
        width: `${drawBox.value.width * 100}%`,
        height: `${drawBox.value.height * 100}%`,
    };
}
</script>

<template>
    <div class="flex flex-col gap-2">
        <div
            ref="containerEl"
            class="relative h-[32rem] overflow-hidden rounded-lg border border-stone-300 bg-stone-100 dark:border-stone-700 dark:bg-stone-900"
            :class="{
                'cursor-crosshair select-none': drawingEnabled,
                'cursor-grabbing select-none': !drawingEnabled && dragging,
                'cursor-grab': !drawingEnabled && !dragging && scale > 1,
                'cursor-zoom-in': !drawingEnabled && scale === 1,
            }"
            @wheel="onWheel"
            @pointerdown="startInteraction"
            @pointermove="onMove"
            @pointerup="stopInteraction"
            @pointercancel="stopInteraction"
        >
            <div
                v-if="image"
                class="absolute top-1/2 left-1/2 inline-block"
                :style="{
                    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                }"
            >
                <img
                    ref="imgEl"
                    :src="image.url"
                    :alt="`Folio ${image.folio_label}`"
                    class="block h-[32rem] max-w-none select-none"
                    draggable="false"
                />
                <div class="absolute inset-0">
                    <div
                        v-for="region in regions"
                        :key="region.id"
                        class="absolute border transition-colors"
                        :class="
                            region.id === editableRegionId
                                ? 'cursor-move border-sky-500 bg-sky-400/20'
                                : [
                                      'border-transparent',
                                      !drawingEnabled && 'cursor-pointer',
                                      region.id === highlightedRegionId &&
                                          'border-amber-400 bg-amber-300/50',
                                  ]
                        "
                        :style="boxStyle(displayBox(region))"
                        @pointerdown="onRegionPointerDown(region, $event)"
                        @pointerenter.stop="emit('hover-region', region.id)"
                        @pointerleave.stop="emit('hover-region', null)"
                    >
                        <template v-if="region.id === editableRegionId">
                            <div
                                v-for="handle in HANDLES"
                                :key="handle.name"
                                class="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2"
                                :style="{
                                    left: handle.left,
                                    top: handle.top,
                                    cursor: handle.cursor,
                                }"
                                @pointerdown="
                                    onHandlePointerDown(
                                        region,
                                        handle.name,
                                        $event,
                                    )
                                "
                            />
                        </template>
                    </div>
                    <div
                        v-for="feature in features"
                        :key="`feature-${feature.id}`"
                        :title="feature.label"
                        class="absolute border border-dashed border-purple-500 bg-purple-400/10"
                        :style="boxStyle(feature)"
                    />
                    <div
                        v-if="drawBox"
                        class="absolute border border-sky-500 bg-sky-400/20"
                        :style="drawBoxStyle()"
                    />
                </div>
            </div>
            <div
                v-else
                class="flex h-full items-center justify-center text-sm text-stone-500 dark:text-stone-400"
            >
                No image available for this witness.
            </div>
        </div>
        <div
            v-if="image"
            class="flex items-center justify-between text-sm text-stone-600 dark:text-stone-400"
        >
            <span>fol. {{ image.folio_label }}</span>
            <div class="flex items-center gap-2">
                <button
                    type="button"
                    class="rounded border border-stone-300 px-2 py-0.5 dark:border-stone-700"
                    @click="zoom(-0.2)"
                >
                    −
                </button>
                <button
                    type="button"
                    class="rounded border border-stone-300 px-2 py-0.5 dark:border-stone-700"
                    @click="zoom(0.2)"
                >
                    +
                </button>
                <button
                    type="button"
                    class="rounded border border-stone-300 px-2 py-0.5 dark:border-stone-700"
                    @click="reset"
                >
                    Reset
                </button>
            </div>
        </div>
    </div>
</template>
