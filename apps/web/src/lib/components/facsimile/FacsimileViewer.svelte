<script lang="ts">
  /**
   * The facsimile: a page image in OpenSeadragon with zones drawn and edited
   * through Annotorious. Zones come in as fractions of the image
   * and go out the same way; the `zones` prop is the record, the overlay
   * follows it. Everything the owner needs to drive the view is handed over
   * through `onviewready` and to the children snippet as a FacsimileApi.
   */
  import { onMount, type Snippet } from 'svelte';
  import type OpenSeadragon from 'openseadragon';
  import type {
    AnnotationState,
    DrawingStyle,
    ImageAnnotation,
    OpenSeadragonAnnotator,
  } from '@annotorious/openseadragon';
  import '@annotorious/openseadragon/annotorious-openseadragon.css';
  import { Maximize, ZoomIn, ZoomOut } from '@lucide/svelte';
  import type { Rect, ZoneGeometry } from '@varians/core';
  import { rectOf } from '@varians/core';
  import type {
    FacsimileApi,
    FacsimileMode,
    FacsimileSource,
    FacsimileZone,
    ImageSize,
  } from '$lib/facsimile/types';
  import {
    clamp01,
    expandRect,
    geometryEquals,
    selectorToGeometry,
    zoneToAnnotation,
  } from '$lib/facsimile/geometry';
  import { DEFAULT_COLORS, resolveToken } from '$lib/facsimile/color';

  interface Labels {
    zoomIn: string;
    zoomOut: string;
    fit: string;
    controls: string;
  }

  /** Owners pass the strings from $lib/strings; these are the fallbacks. */
  const DEFAULT_LABELS: Labels = {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit the page',
    controls: 'Zoom',
  };

  interface Props {
    source: FacsimileSource;
    zones?: FacsimileZone[];
    /** Ids of zones to light up (the caret's word, a hovered list entry). */
    highlighted?: string[];
    selected?: string | null;
    /** `pan` navigates; `rect` and `polygon` draw new zones when `editable`. */
    mode?: FacsimileMode;
    /** Whether zones may be drawn, moved and resized. */
    editable?: boolean;
    /**
     * Draw every word box. Otherwise a word box shows only while it is lit,
     * pointed at or selected; it can still be pointed at and clicked.
     * Features are always drawn.
     */
    outlines?: boolean;
    labels?: Partial<Labels>;
    class?: string;
    onzonecreate?: (geometry: ZoneGeometry) => void;
    onzonechange?: (id: string, geometry: ZoneGeometry) => void;
    /** A zone clicked, or the selection cleared; `extend` when Shift was held, to add to what is selected. */
    onzoneselect?: (id: string | null, extend: boolean) => void;
    onzonehover?: (id: string | null) => void;
    /** A click (not a drag) on the image beside every zone, while panning. */
    onbackgroundclick?: () => void;
    onviewready?: (api: FacsimileApi) => void;
    /** Rendered over the image once it is open, with the api; for overlays such as WordDividers. */
    children?: Snippet<[FacsimileApi]>;
  }

  let {
    source,
    zones = [],
    highlighted = [],
    selected = null,
    mode = 'pan',
    editable = false,
    outlines = false,
    labels: labelOverrides,
    class: className = '',
    onzonecreate,
    onzonechange,
    onzoneselect,
    onzonehover,
    onbackgroundclick,
    onviewready,
    children,
  }: Props = $props();

  const labels = $derived({ ...DEFAULT_LABELS, ...labelOverrides });

  let root = $state<HTMLDivElement>();
  let stage = $state<HTMLDivElement>();

  // The viewer and the annotator live outside Svelte's reactivity; `api` is
  // set when an image is open and is what the effects below wait for.
  let OSD: typeof OpenSeadragon | null = null;
  let viewer: OpenSeadragon.Viewer | null = null;
  let anno: OpenSeadragonAnnotator | null = null;
  let selectActions: { EDIT: unknown; SELECT: unknown } | null = null;
  let api = $state.raw<FacsimileApi | null>(null);

  let highlightSet = new Set<string>();
  let colors: { accent: string; line: string; feature: string } = { ...DEFAULT_COLORS };
  let openedKey = '';
  let syncing = false;
  /** The id Annotorious gave a shape just drawn, until the zones prop has taken it over. */
  let pendingCreated: string | null = null;
  let unsubscribeSelection: (() => void) | null = null;
  /** Whether Shift was held at the last press on the image. */
  let shiftHeld = false;
  /** The zone under the pointer, if any. */
  let pointed: string | null = null;
  let appliedSelectAction: unknown = null;

  type Store = OpenSeadragonAnnotator['state']['store'];
  type Origin = NonNullable<Parameters<Store['bulkDeleteAnnotations']>[1]>;
  type SelectionValue = { selected: { id: string; editable?: boolean }[] } | undefined;
  type SelectionStore = { subscribe: (listener: (value: SelectionValue) => void) => () => void };
  /** Changes we make to the store are "remote": no lifecycle events, nothing on the undo stack. */
  const REMOTE = 'REMOTE' as unknown as Origin;

  function sourceKey(s: FacsimileSource): string {
    return JSON.stringify(s);
  }

  /** The OpenSeadragon tile source for a source: a URL to fetch, or an inline image source. */
  function tileSourceFor(s: FacsimileSource): string | object {
    switch (s.kind) {
      case 'dzi':
        return s.url;
      case 'iiif':
        return s.infoUrl;
      case 'image':
        return { type: 'image', url: s.url, buildPyramid: true };
    }
  }

  function makeStyle() {
    const lit = highlightSet;
    const palette = colors;
    const always = outlines;
    return (annotation: ImageAnnotation, state?: AnnotationState): DrawingStyle => {
      const kind = String(annotation.properties?.kind ?? 'word');
      const color = (
        kind === 'line' ? palette.line : kind === 'feature' ? palette.feature : palette.accent
      ) as DrawingStyle['stroke'];
      const isLit = lit.has(annotation.id);
      // Lines are drawn lighter than words; a lit zone gets a filled tint.
      let fillOpacity = kind === 'line' ? (isLit ? 0.16 : 0) : isLit ? 0.3 : 0.05;
      let strokeOpacity = kind === 'line' ? 0.55 : 0.9;
      let strokeWidth = kind === 'line' ? 1 : 1.5;
      // A resting word box is not drawn unless asked for.
      if (kind !== 'feature' && !always && !isLit && !state?.hovered && !state?.selected) {
        return { fill: color, fillOpacity: 0, stroke: color, strokeOpacity: 0, strokeWidth };
      }
      if (state?.hovered) fillOpacity = Math.max(fillOpacity, 0.18);
      if (state?.selected) {
        strokeWidth = 2.5;
        strokeOpacity = 1;
        fillOpacity = Math.max(fillOpacity, 0.12);
      }
      return { fill: color, fillOpacity, stroke: color, strokeOpacity, strokeWidth };
    };
  }

  function createApi(
    v: OpenSeadragon.Viewer,
    osd: typeof OpenSeadragon,
    imageSize: ImageSize,
  ): FacsimileApi {
    const { width: W, height: H } = imageSize;
    const zoomTo = (rect: Rect) => {
      const r = expandRect(rect, 0.25);
      const bounds = v.viewport.imageToViewportRectangle(
        new osd.Rect(r.x * W, r.y * H, r.w * W, r.h * H),
      );
      v.viewport.fitBoundsWithConstraints(bounds);
    };
    return {
      viewer: v,
      imageSize,
      zoomTo,
      fitTo(zoneId) {
        const zone = zones.find((z) => z.id === zoneId);
        const rect = zone ? rectOf(zone.geometry) : null;
        if (rect) zoomTo(rect);
      },
      fit() {
        v.viewport.goHome();
      },
      zoomIn() {
        v.viewport.zoomBy(1.5);
        v.viewport.applyConstraints();
      },
      zoomOut() {
        v.viewport.zoomBy(1 / 1.5);
        v.viewport.applyConstraints();
      },
      toElement([x, y]) {
        const p = v.viewport.imageToViewerElementCoordinates(new osd.Point(x * W, y * H));
        return { x: p.x, y: p.y };
      },
      fromElement({ x, y }) {
        const p = v.viewport.viewerElementToImageCoordinates(new osd.Point(x, y));
        return [clamp01(p.x / W), clamp01(p.y / H)];
      },
      onViewportChange(listener) {
        const events = [
          'animation',
          'animation-finish',
          'viewport-change',
          'resize',
          'rotate',
        ] as const;
        for (const e of events) v.addHandler(e, listener);
        return () => {
          for (const e of events) v.removeHandler(e, listener);
        };
      },
    };
  }

  /** Makes the overlay match the `zones` prop: adds, updates and removes, with no events. */
  function syncZones() {
    const current = api;
    if (!anno || !current) return;
    const store = anno.state.store;
    const size = current.imageSize;
    const desired = new Map<string, ImageAnnotation>();
    for (const zone of zones) {
      const annotation = zoneToAnnotation(zone, size);
      if (annotation) desired.set(zone.id, annotation);
    }
    const existing = store.all();
    const toDelete = existing.filter((a) => !desired.has(a.id)).map((a) => a.id);
    const toAdd: ImageAnnotation[] = [];
    const toUpdate: ImageAnnotation[] = [];
    const byId = new Map(existing.map((a) => [a.id, a]));
    for (const [id, annotation] of desired) {
      const old = byId.get(id);
      if (!old) {
        toAdd.push(annotation);
      } else {
        const sameKind = String(old.properties?.kind) === String(annotation.properties?.kind);
        const sameShape = geometryEquals(
          selectorToGeometry(old.target.selector, size),
          selectorToGeometry(annotation.target.selector, size),
        );
        if (!sameKind || !sameShape) toUpdate.push(annotation);
      }
    }
    syncing = true;
    try {
      if (toDelete.length > 0) store.bulkDeleteAnnotations(toDelete, REMOTE);
      if (toUpdate.length > 0) store.bulkUpdateAnnotations(toUpdate, REMOTE);
      if (toAdd.length > 0) store.bulkAddAnnotations(toAdd, false, REMOTE);
    } finally {
      syncing = false;
    }
    if (pendingCreated && !desired.has(pendingCreated)) pendingCreated = null;
    applySelection();
  }

  function currentSelection(): string | null {
    return anno?.getSelected()[0]?.id ?? null;
  }

  function applySelection() {
    if (!anno || !api) return;
    const wanted = selected && anno.state.store.getAnnotation(selected) ? selected : null;
    if (wanted === currentSelection()) return;
    syncing = true;
    try {
      if (wanted) anno.setSelected(wanted, editable);
      else anno.setSelected();
    } finally {
      syncing = false;
    }
  }

  function applyMode() {
    if (!anno || !selectActions) return;
    if (mode === 'rect') {
      anno.setDrawingTool('rectangle');
      anno.setDrawingMode('drag');
    } else if (mode === 'polygon') {
      anno.setDrawingTool('polygon');
      anno.setDrawingMode('click');
    }
    anno.setDrawingEnabled(editable && mode !== 'pan');
    const action = editable ? selectActions.EDIT : selectActions.SELECT;
    if (action !== appliedSelectAction) {
      appliedSelectAction = action;
      // Annotorious re-applies the current selection here; keep that from echoing.
      syncing = true;
      try {
        anno.setUserSelectAction(action as never);
      } finally {
        syncing = false;
      }
    }
  }

  function handleOpen() {
    if (!viewer || !OSD) return;
    const item = viewer.world.getItemAt(0);
    if (!item) return;
    const size = item.getContentSize();
    const next = createApi(viewer, OSD, { width: size.x, height: size.y });
    api = next;
    syncZones();
    onviewready?.(next);
  }

  function handleCreate(annotation: ImageAnnotation) {
    const size = api?.imageSize;
    if (!size) return;
    // Annotorious selects the new shape itself; that must not override the owner's choice.
    pendingCreated = annotation.id;
    const geometry = selectorToGeometry(annotation.target.selector, size);
    if (geometry) onzonecreate?.(geometry);
    // Whatever the owner did with it, the overlay follows the zones prop.
    queueMicrotask(syncZones);
  }

  function handleUpdate(annotation: ImageAnnotation) {
    const size = api?.imageSize;
    if (!size) return;
    const geometry = selectorToGeometry(annotation.target.selector, size);
    const zone = zones.find((z) => z.id === annotation.id);
    if (geometry && !(zone && geometryEquals(zone.geometry, geometry))) {
      onzonechange?.(annotation.id, geometry);
    }
    queueMicrotask(syncZones);
  }

  function handleSelection(selection: { id: string }[]) {
    if (syncing) return;
    const id = selection[0]?.id ?? null;
    if (pendingCreated && (id === pendingCreated || id === null)) return;
    if (id === selected && !shiftHeld) return;
    onzoneselect?.(id, shiftHeld);
  }

  onMount(() => {
    let disposed = false;
    (async () => {
      const [osdModule, annotorious] = await Promise.all([
        import('openseadragon'),
        import('@annotorious/openseadragon'),
      ]);
      if (disposed || !stage || !root) return;
      OSD = osdModule.default;
      selectActions = annotorious.UserSelectAction;
      colors = {
        accent: resolveToken(root, '--color-accent', DEFAULT_COLORS.accent),
        line: resolveToken(root, '--color-muted', DEFAULT_COLORS.line),
        feature: resolveToken(root, '--color-warning', DEFAULT_COLORS.feature),
      };

      openedKey = sourceKey(source);
      const v = new OSD.Viewer({
        element: stage,
        tileSources: tileSourceFor(source) as OpenSeadragon.Options['tileSources'],
        showNavigationControl: false,
        showNavigator: false,
        animationTime: 0.4,
        zoomPerScroll: 1.3,
        zoomPerClick: 2,
        minZoomImageRatio: 0.6,
        maxZoomPixelRatio: 3,
        visibilityRatio: 0.7,
        constrainDuringPan: true,
        // IIIF servers must send CORS headers; with them tiles can go to WebGL untainted.
        crossOriginPolicy: 'Anonymous',
        gestureSettingsMouse: {
          clickToZoom: false,
          dblClickToZoom: true,
          scrollToZoom: true,
          dragToPan: true,
          flickEnabled: true,
        },
        gestureSettingsTouch: { dblClickToZoom: true, pinchToZoom: true, flickEnabled: true },
      });
      viewer = v;
      v.addHandler('open', handleOpen);
      v.addHandler('open-failed', (event) => {
        console.warn('Facsimile: the image could not be opened', event);
      });

      const a = annotorious.createOSDAnnotator(v, {
        drawingEnabled: false,
        style: makeStyle(),
        // 'auto' reads pixels from the canvas to pick a theme; a manuscript page is light.
        theme: 'light',
      });
      anno = a;
      a.on('createAnnotation', handleCreate);
      a.on('updateAnnotation', handleUpdate);
      // The lifecycle's selectionChanged event is delivered deferred, so our
      // own calls could not be told from the user's; the store itself notifies
      // synchronously, which is what the `syncing` guard relies on.
      const selectionStore = a.state.selection as unknown as SelectionStore;
      unsubscribeSelection = selectionStore.subscribe((value) => {
        handleSelection(value?.selected ?? []);
      });
      a.on('mouseEnterAnnotation', (annotation) => {
        pointed = annotation.id;
        onzonehover?.(annotation.id);
      });
      a.on('mouseLeaveAnnotation', () => {
        pointed = null;
        onzonehover?.(null);
      });
      v.addHandler('canvas-click', (event) => {
        if (event.quick && !pointed && mode === 'pan') onbackgroundclick?.();
      });
      applyMode();
    })();

    return () => {
      disposed = true;
      api = null;
      unsubscribeSelection?.();
      unsubscribeSelection = null;
      anno?.destroy();
      anno = null;
      viewer?.destroy();
      viewer = null;
    };
  });

  // Open another image when the source changes.
  $effect(() => {
    const key = sourceKey(source);
    if (viewer && key !== openedKey) {
      openedKey = key;
      api = null;
      viewer.open({ tileSource: tileSourceFor(source) });
    }
  });

  $effect(() => {
    void zones;
    if (api) syncZones();
  });

  $effect(() => {
    highlightSet = new Set(highlighted);
    void outlines;
    if (anno) anno.setStyle(makeStyle());
  });

  $effect(() => {
    void selected;
    void editable;
    if (api) applySelection();
  });

  $effect(() => {
    void mode;
    void editable;
    if (api) applyMode();
  });
</script>

<div class={`facsimile ${className}`} bind:this={root} onpointerdowncapture={(event) => (shiftHeld = event.shiftKey)}>
  <div class="facsimile-stage" bind:this={stage}></div>
  {#if api && children}
    <div class="facsimile-layer">{@render children(api)}</div>
  {/if}
  <div class="facsimile-controls" role="group" aria-label={labels.controls}>
    <button
      type="button"
      title={labels.zoomIn}
      aria-label={labels.zoomIn}
      disabled={!api}
      onclick={() => api?.zoomIn()}
    >
      <ZoomIn size={18} aria-hidden="true" />
    </button>
    <button
      type="button"
      title={labels.zoomOut}
      aria-label={labels.zoomOut}
      disabled={!api}
      onclick={() => api?.zoomOut()}
    >
      <ZoomOut size={18} aria-hidden="true" />
    </button>
    <button
      type="button"
      title={labels.fit}
      aria-label={labels.fit}
      disabled={!api}
      onclick={() => api?.fit()}
    >
      <Maximize size={18} aria-hidden="true" />
    </button>
  </div>
</div>

<style>
  .facsimile {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 16rem;
    overflow: hidden;
    background: var(--color-facsimile-bg, #2b2a28);
  }

  .facsimile-stage {
    position: absolute;
    inset: 0;
  }

  .facsimile-stage :global(.openseadragon-canvas:focus-visible) {
    outline: 2px solid var(--color-accent, #2563eb);
    outline-offset: -2px;
  }

  .facsimile-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .facsimile-controls {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-family: var(--font-sans, system-ui, sans-serif);
  }

  .facsimile-controls button {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid var(--color-border, #d4d4d8);
    border-radius: 0.375rem;
    background: var(--color-surface, #ffffff);
    color: var(--color-ink, #18181b);
    cursor: pointer;
  }

  .facsimile-controls button:hover:not(:disabled) {
    background: var(--color-surface-hover, #f4f4f5);
  }

  .facsimile-controls button:focus-visible {
    outline: 2px solid var(--color-accent, #2563eb);
    outline-offset: 1px;
  }

  .facsimile-controls button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
