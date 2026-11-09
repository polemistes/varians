<script lang="ts">
  /**
   * The facsimile of the page shown, with its zones (PLAN 5.6). The caret's
   * and the selection's words light their zones; the pointer on a zone
   * lights its words; a click on a zone selects them. Tools: map the
   * selected words to a drawn shape, map whole lines through one guide box
   * divided by the lines found on the image and the letters of the words,
   * edit the boxes of the selected words together (move them, stretch
   * them, resize one and let the rest of its line follow, move the boundary
   * between two words), undo such edits, mark a feature, delete a zone.
   * Words are mapped on their own page only: in Not on a page the pane
   * shows a page chosen in a chooser of its own (by default the page Move
   * to Page… proposes), with the mapping tools disabled (PLAN-3 C5).
   */
  import { onMount, tick, untrack } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ImageUp from '@lucide/svelte/icons/image-up';
  import { rectOf, type Id, type Rect, type ZoneGeometry } from '@varians/core';
  import FacsimileViewer from '$lib/components/facsimile/FacsimileViewer.svelte';
  import BoxGroup from '$lib/components/facsimile/BoxGroup.svelte';
  import ImageCredit from '$lib/components/facsimile/ImageCredit.svelte';
  import PageImageDialog, { type ImageChoice, type ImageRequest } from '$lib/components/pages/PageImageDialog.svelte';
  import { Button, Checkbox, Dialog, EmptyState, Menu, MenuItem, MenuSeparator, Select, Spinner, toasts } from '$lib/components/ui';
  import { UNPLACED } from '$lib/workbench/pages';
  import { failureMessage, megabytes, uploadToAction } from '$lib/components/pages/client';
  import { ACCEPT_IMAGES, isImageFile } from '$lib/components/pages/files';
  import { pageStrings } from '$lib/strings/pages';
  import type { FacsimileMode, FacsimileZone } from '$lib/facsimile/types';
  import {
    divideGuideBox,
    groupBoxes,
    isWordBox,
    lineTokens,
    replacedZones,
    selectedLines,
    zonesOfTokens,
  } from '$lib/workbench/mapping';
  import { workbench as t } from '$lib/strings/workbench';
  import { afterRedo, afterUndo, emptyHistory, nextRedo, nextUndo, recordAction, type ZoneAction } from '$lib/workbench/zone-history';
  import { linesInBox } from './detect';
  import FeatureDialog from './FeatureDialog.svelte';
  import type { Workbench, Zone } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    /** Show the Pages tab. */
    onpages?: () => void;
  }

  let { wb, onpages }: Props = $props();

  type Intent = 'selection' | 'lines' | 'feature' | 'area';

  let browser = $state(false);
  let shape = $state<'rect' | 'polygon'>('rect');
  let intent = $state<Intent | null>(null);
  let selectedZone = $state<string | null>(null);
  let message = $state<string | null>(null);
  let busy = $state(false);
  let featureOpen = $state(false);
  let pendingFeature: ZoneGeometry | null = null;

  /** Draw every word box, not only those lit, pointed at or selected: remembered in this browser. */
  const OUTLINES_KEY = 'varians.facsimile.outlines';
  let outlines = $state(false);

  onMount(() => {
    browser = true;
    try {
      outlines = window.localStorage.getItem(OUTLINES_KEY) === '1';
    } catch {
      // Not remembered.
    }
  });

  function setOutlines(value: boolean) {
    outlines = value;
    try {
      window.localStorage.setItem(OUTLINES_KEY, value ? '1' : '0');
    } catch {
      // Not remembered.
    }
  }

  const page = $derived(wb.witnessPage);
  /** Words can be mapped here: an editor, on a page's own view. */
  const mapping = $derived(wb.canEdit && wb.onPage);
  const unmappableTitle = $derived(wb.view === UNPLACED ? t.move.notMappable : t.move.notMappableWhole);
  const facsimileOptions = $derived(wb.pages.map((p) => ({ value: p.id, label: wb.textOnPages.has(p.id) ? `${p.label} ●` : p.label })));
  const zones = $derived<Zone[]>(wb.pageZones ?? []);
  /** The boxes of a group as a drag has them, before they are saved. */
  let preview = $state.raw<Map<string, ZoneGeometry> | null>(null);
  const viewerZones = $derived<FacsimileZone[]>(
    zones.map((z) => ({ id: z.id, geometry: preview?.get(z.id) ?? z.geometry, tokenIds: z.tokenIds, kind: z.feature ? 'feature' : 'word' })),
  );
  /** The image's height over its width, once the viewer has it; turning boxes keeps their shape in pixels. */
  let imageSize = $state<{ width: number; height: number } | null>(null);
  const aspect = $derived(
    imageSize && imageSize.width > 0 ? imageSize.height / imageSize.width : page?.width && page.height ? page.height / page.width : 1,
  );
  const mode = $derived<FacsimileMode>(intent ? shape : 'pan');
  const selectedWords = $derived(wb.hasRange ? wb.selection.ids : []);
  /** The boxes lit: of the words selected in the text, and of the word the pointer is on there. Not the caret's word. */
  const highlighted = $derived(zonesOfTokens(zones, [...(wb.hasRange ? wb.selection.ids : []), ...(wb.hoveredToken ? [wb.hoveredToken] : [])]));

  /**
   * The boxes chosen. By default the boxes of the words selected in the
   * text; Select all, Select area and Shift-clicks on the image choose boxes
   * by hand instead, words or none, until the text selection changes again.
   */
  let handPicked = $state.raw<string[] | null>(null);
  const wordBoxIds = $derived(zones.filter(isWordBox).map((z) => z.id));
  const picked = $derived.by(() => {
    if (handPicked) return handPicked.filter((id) => wordBoxIds.includes(id));
    return wb.hasRange ? zonesOfTokens(zones.filter(isWordBox), wb.selection.ids) : [];
  });

  // A new selection in the text chooses again.
  $effect(() => {
    void wb.selection;
    void wb.hasRange;
    untrack(() => (handPicked = null));
  });

  /** The chosen boxes, edited together when there are two or more. */
  const group = $derived.by(() => {
    if (!wb.canEdit || picked.length < 2) return null;
    const boxes = groupBoxes(wb.facsimileStream, zones, picked, aspect);
    return boxes.length >= 2 ? boxes : null;
  });

  function pickByHand(ids: string[]) {
    handPicked = ids;
    selectedZone = ids.length === 1 ? ids[0]! : null;
    if (ids.length > 1) void focusGroup();
  }

  // A new page: nothing is selected or armed there.
  $effect(() => {
    void wb.pageId;
    selectedZone = null;
    intent = null;
    message = null;
    preview = null;
    handPicked = null;
  });

  // A group takes over from a single box selected on the image.
  $effect(() => {
    if (group) untrack(() => (selectedZone = null));
  });

  // Undo and redo of what is done to the boxes: made, moved, resized, deleted.
  let history = $state.raw(emptyHistory());
  const undoable = $derived(nextUndo(history, wb.pageId));
  const redoable = $derived(nextRedo(history, wb.pageId));

  function record(action: ZoneAction) {
    history = recordAction(history, action);
  }

  /** A zone as it is sent to be made again, under its own id. */
  const remake = (z: Zone) => ({ id: z.id, geometry: z.geometry, tokenIds: z.tokenIds, feature: z.feature ?? null });

  /** Save new shapes for some zones of the page shown. */
  async function reshape(changes: { id: string; geometry: ZoneGeometry }[], done: 'move' | 'resize' | 'turn' = 'move'): Promise<boolean> {
    const pageId = wb.pageId;
    if (!pageId || changes.length === 0) return false;
    const old = changes
      .map((c) => zones.find((z) => z.id === c.id))
      .filter((z): z is Zone => !!z)
      .map((z) => ({ id: z.id, geometry: z.geometry }));
    const saved = await wb.updateZones(pageId, changes);
    if (!saved) {
      message = t.facsimile.failed;
      return false;
    }
    record({
      pageId,
      label: t.facsimile.history[done](changes.length),
      undo: () => wb.updateZones(pageId, old),
      redo: () => wb.updateZones(pageId, changes),
    });
    return true;
  }

  /** Make zones on the page, in place of the zones `replace` names. */
  async function make(pageId: string, inputs: { geometry: ZoneGeometry; tokenIds: Id[]; feature?: { kind: string; description?: string } | null }[], replace: string[] = []): Promise<Zone[] | null> {
    const replaced = zones.filter((z) => replace.includes(z.id));
    const made = await wb.createZones(pageId, inputs, replace);
    if (!made) {
      if (replaced.length) record(removal(pageId, replaced));
      return null;
    }
    const ids = made.map((z) => z.id);
    record({
      pageId,
      label: t.facsimile.history.made(made.length),
      undo: async () => (await wb.deleteZones(pageId, ids)) && (replaced.length === 0 || !!(await wb.createZones(pageId, replaced.map(remake)))),
      redo: async () => !!(await wb.createZones(pageId, made.map(remake), replaced.map((z) => z.id))),
    });
    return made;
  }

  function removal(pageId: string, gone: Zone[]): ZoneAction {
    const ids = gone.map((z) => z.id);
    return {
      pageId,
      label: t.facsimile.history.deleted(gone.length),
      undo: async () => !!(await wb.createZones(pageId, gone.map(remake))),
      redo: () => wb.deleteZones(pageId, ids),
    };
  }

  /** Delete zones of the page shown. */
  async function remove(ids: string[]): Promise<boolean> {
    const pageId = wb.pageId;
    if (!pageId || ids.length === 0) return false;
    const gone = zones.filter((z) => ids.includes(z.id));
    selectedZone = null;
    wb.litTokens = [];
    const done = await wb.deleteZones(pageId, ids);
    if (!done) {
      message = t.facsimile.failed;
      return false;
    }
    record(removal(pageId, gone));
    message = t.facsimile.deletedMessage(gone.length);
    return true;
  }

  async function undo() {
    const action = undoable;
    if (!action || busy) return;
    busy = true;
    const done = await action.undo();
    busy = false;
    if (done) history = afterUndo(history, action);
    message = done ? t.facsimile.history.undone(action.label) : t.facsimile.failed;
  }

  async function redo() {
    const action = redoable;
    if (!action || busy) return;
    busy = true;
    const done = await action.redo();
    busy = false;
    if (done) history = afterRedo(history, action);
    message = done ? t.facsimile.history.redone(action.label) : t.facsimile.failed;
  }

  function groupChanged(shapes: Map<string, ZoneGeometry>, done: 'move' | 'resize' | 'turn') {
    void reshape([...shapes].map(([id, geometry]) => ({ id, geometry })), done);
  }

  let pane = $state<HTMLElement>();

  /** Give the keys to the selected boxes: Delete, the arrows and Ctrl+Z then act on them, not on the text. */
  async function focusGroup() {
    await tick();
    pane?.querySelector<HTMLElement>('.group-layer .frame')?.focus({ preventScroll: true });
  }

  /** Select the words of the caret's line in the text, and so their boxes. */
  function selectLine() {
    const caret = wb.selection.caret ?? wb.selection.ids[0];
    if (!caret || !wb.api) return;
    const tokens = lineTokens(wb.facsimileStream, caret);
    if (tokens.length) wb.api.selectTokens(tokens[0]!, tokens[tokens.length - 1]!);
    void focusGroup();
  }

  const groupLabels = {
    group: t.facsimile.group.label,
    keys: t.facsimile.group.keys,
    resize: t.facsimile.group.resize,
    boundary: t.facsimile.group.boundary,
    side: t.facsimile.group.side,
    turn: t.facsimile.group.turn,
  };

  /** The word boxes whose middle lies in a box drawn on the image. */
  function boxesIn(area: Rect): string[] {
    return zones
      .filter(isWordBox)
      .filter((z) => {
        const r = z.geometry.rect!;
        return inside([r.x + r.w / 2, r.y + r.h / 2], area);
      })
      .map((z) => z.id);
  }

  // The selection toolbar's "Map": draw around the selected words. The request is taken once.
  $effect(() => {
    if (!wb.mapRequested) return;
    wb.mapRequested = false;
    if (untrack(() => mapping)) untrack(() => arm(selectedWords.length ? 'selection' : 'lines'));
  });

  function arm(next: Intent) {
    if (!page?.source) return;
    if (intent === next) {
      intent = null;
      message = null;
      return;
    }
    intent = next;
    if (next === 'selection') message = t.facsimile.drawPrompt.selection(selectedWords.length);
    else if (next === 'area') message = t.facsimile.drawPrompt.area;
    else if (next === 'lines') {
      const lines = selectedLines(wb.facsimileStream, wb.focusTokens, wb.stream);
      message = lines.length ? t.facsimile.drawPrompt.lines(lines.length) : t.facsimile.drawPrompt.noLines;
      if (!lines.length) intent = null;
    } else message = t.facsimile.drawPrompt.feature;
  }

  async function created(geometry: ZoneGeometry) {
    const pageId = wb.pageId;
    if (!pageId) return;
    const kind: Intent = intent ?? (selectedWords.length ? 'selection' : 'feature');
    intent = null;
    if (kind === 'area') {
      const area = rectOf(geometry);
      const ids = area ? boxesIn(area) : [];
      message = t.facsimile.picked(ids.length);
      pickByHand(ids);
      return;
    }
    if (kind === 'lines') await mapLines(pageId, geometry);
    else if (kind === 'selection' && selectedWords.length) await mapSelection(pageId, geometry);
    else {
      pendingFeature = geometry;
      featureOpen = true;
    }
  }

  async function mapSelection(pageId: string, geometry: ZoneGeometry) {
    busy = true;
    try {
      const tokenIds = [...selectedWords];
      const made = await make(pageId, [{ geometry, tokenIds }], replacedZones(zones, tokenIds));
      message = made ? t.facsimile.mapped(made.length) : t.facsimile.failed;
    } finally {
      busy = false;
    }
  }

  function centre(zone: Zone): [number, number] | null {
    const r = rectOf(zone.geometry);
    return r ? [r.x + r.w / 2, r.y + r.h / 2] : null;
  }

  function inside(point: [number, number] | null, box: Rect): boolean {
    return !!point && point[0] >= box.x && point[0] <= box.x + box.w && point[1] >= box.y && point[1] <= box.y + box.h;
  }

  async function mapLines(pageId: string, geometry: ZoneGeometry) {
    const box = rectOf(geometry);
    const lines = selectedLines(wb.facsimileStream, wb.focusTokens, wb.stream);
    if (!box || lines.length === 0) {
      message = t.facsimile.drawPrompt.noLines;
      return;
    }
    busy = true;
    message = t.facsimile.detecting;
    try {
      const detected = await linesInBox(page?.image ?? null, box);
      const inputs = divideGuideBox(box, lines, detected ? { detected } : {});
      const tokenIds = new Set(inputs.flatMap((z) => z.tokenIds));
      // Zones of these words standing in the box are replaced; a divided word's part on another line stays.
      const replace = replacedZones(zones, tokenIds).filter((id) => inside(centre(zones.find((z) => z.id === id)!), box));
      const made = await make(pageId, inputs, replace);
      message = made
        ? `${t.facsimile.linesFound(detected?.length ?? 0, lines.length)} ${t.facsimile.mapped(made.length)}`
        : t.facsimile.failed;
    } finally {
      busy = false;
    }
  }

  async function saveFeature(feature: { kind: string; description?: string }) {
    const pageId = wb.pageId;
    const geometry = pendingFeature;
    pendingFeature = null;
    if (!pageId || !geometry) return;
    const made = await make(pageId, [{ geometry, tokenIds: [], feature }]);
    message = made ? t.facsimile.mapped(made.length) : t.facsimile.failed;
  }

  /**
   * A zone clicked on the image selects its words in the text, and that
   * box alone. With Shift, the box is added to the chosen boxes, or taken
   * out of them; the text stays as it is, so boxes without words can be
   * chosen too.
   */
  function selectZone(id: string | null, extend = false) {
    const zone = id ? zones.find((z) => z.id === id) : null;
    if (extend && zone) {
      const current = picked.length ? picked : selectedZone ? [selectedZone] : [];
      pickByHand(current.includes(zone.id) ? current.filter((z) => z !== zone.id) : [...current, zone.id]);
      return;
    }
    selectedZone = id;
    if (!zone || !wb.api) return;
    const present = wb.pageStream.items.filter((item) => zone.tokenIds.includes(item.id)).map((item) => item.id);
    if (present.length) wb.api.selectTokens(present[0]!, present[present.length - 1]!);
    // After the text selection has settled: this box alone, also when it has no words.
    void tick().then(() => {
      handPicked = [zone.id];
      selectedZone = zone.id;
    });
  }

  /** Let go of the chosen boxes, and of the words selected in the text that chose them. */
  function clearPicked() {
    if (!handPicked && wb.hasRange) wb.api?.clearSelection();
    handPicked = [];
    selectedZone = null;
  }

  function hoverZone(id: string | null) {
    wb.litTokens = id ? (zones.find((z) => z.id === id)?.tokenIds ?? []) : [];
  }

  /**
   * What "Delete" removes: the selected boxes; else the box selected on the
   * image; else the boxes of the words selected in the text.
   */
  const deletable = $derived.by(() => {
    if (group) return group.map((b) => b.id);
    if (selectedZone) return [selectedZone];
    if (handPicked) return picked;
    return wb.hasRange ? zonesOfTokens(zones.filter((z) => !z.feature), wb.selection.ids) : [];
  });
  /** Boxes whose words are no longer in the text. */
  const orphans = $derived.by(() => {
    const live = new Set(wb.stream.items.map((i) => i.id));
    return zones.filter((z) => !z.feature && z.tokenIds.length > 0 && !z.tokenIds.some((id) => live.has(id))).map((z) => z.id);
  });
  const wordBoxes = $derived(zones.filter((z) => !z.feature).map((z) => z.id));
  let confirmAll = $state(false);

  function editing(target: EventTarget | null): boolean {
    const element = target instanceof Element ? target : null;
    return !!element?.closest('input, textarea, select, [contenteditable="true"], .cm-editor');
  }

  /**
   * The keys act on the boxes only while the focus is in this pane, on the
   * image or its tools; in the text they keep their meaning there.
   */
  function keydown(event: KeyboardEvent) {
    if (!mapping) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-facsimile-pane]') || editing(target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z') {
      event.preventDefault();
      void (event.shiftKey ? redo() : undo());
      return;
    }
    if (mod && key === 'y') {
      event.preventDefault();
      void redo();
      return;
    }
    if (event.key === 'Escape' && (picked.length || selectedZone)) {
      clearPicked();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && deletable.length) {
      event.preventDefault();
      void remove(deletable);
    }
  }

  // An image for a page that has none, given right here by a maintainer of the witness

  let fileInput = $state<HTMLInputElement | null>(null);
  let upload = $state<{ progress: number; processing: boolean } | null>(null);
  let dropping = $state(false);

  function chosenFile(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (file) void giveImage(file);
  }

  function dragover(event: DragEvent) {
    if (!wb.canMaintainWitness || upload || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dropping = true;
  }

  function dragleave(event: DragEvent) {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as Node).contains(next)) dropping = false;
  }

  function dropped(event: DragEvent) {
    if (!wb.canMaintainWitness || upload) return;
    event.preventDefault();
    dropping = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) void giveImage(file);
  }

  /** A file for a page without an image, waiting for its rights statement when the witness has no default. */
  let imageRequest = $state<ImageRequest | null>(null);

  function giveImage(file: File) {
    const target = page;
    if (!target || !wb.canMaintainWitness) return;
    const defaults = wb.imageDefaults;
    if (defaults.rights) {
      void sendImage(target.id, { file, rights: defaults.rights, attribution: defaults.attribution ?? '', imageSource: '' });
      return;
    }
    imageRequest = { id: target.id, label: target.label, imageKind: null, zones: 0, rights: null, attribution: null, file };
  }

  async function sendImage(pageId: string, choice: ImageChoice) {
    const { file } = choice;
    if (!isImageFile(file)) {
      toasts.error(pageStrings.upload.notImage);
      return;
    }
    if (file.size > wb.maxUploadBytes) {
      toasts.error(pageStrings.upload.tooLarge(megabytes(wb.maxUploadBytes)));
      return;
    }
    const body = new FormData();
    body.append('pageId', pageId);
    body.append('file', file);
    body.append('rights', choice.rights);
    body.append('attribution', choice.attribution);
    body.append('imageSource', choice.imageSource);
    upload = { progress: 0, processing: false };
    const result = await uploadToAction('replaceImage', body, (fraction) => (upload = { progress: fraction, processing: fraction >= 1 }), wb.pagesBase).result;
    if (result.type === 'success') {
      await wb.refreshPages();
      const message = (result.data as { message?: string } | undefined)?.message;
      if (message) toasts.success(message);
    } else {
      toasts.error(failureMessage(result));
    }
    upload = null;
  }

  const toolClass = (on: boolean) =>
    [
      'inline-flex h-7 items-center rounded-md px-2 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
      on ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-sunken',
    ].join(' ');
</script>

<svelte:window onkeydown={keydown} />

<div class="flex h-full min-h-0 flex-col" data-facsimile-pane bind:this={pane}>
  {#if wb.view === UNPLACED && wb.pages.length > 0}
    <label class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5 font-sans text-xs text-ink-soft">
      <span>{t.move.facsimilePage}</span>
      <Select class="h-7 w-auto py-0 text-sm" value={wb.pageId ?? ''} options={facsimileOptions} onchange={(event) => wb.chooseFacsimilePage((event.currentTarget as HTMLSelectElement).value)} />
    </label>
  {/if}
  {#if !page}
    <div class="p-4">
      <EmptyState description={t.facsimile.noPage}>
        {#if onpages}<Button size="sm" onclick={onpages}>{t.facsimile.allPages}</Button>{/if}
      </EmptyState>
    </div>
  {:else if !page.source}
    <div class="p-4" ondragenter={dragover} ondragover={dragover} ondragleave={dragleave} ondrop={dropped} role="presentation">
      <EmptyState
        title={t.facsimile.noImage(page.label)}
        description={wb.canMaintainWitness ? t.facsimile.addImageHint(megabytes(wb.maxUploadBytes)) : undefined}
        class={dropping ? 'border-accent bg-accent-soft' : undefined}
      >
        {#if dropping}
          <p class="text-sm font-medium text-accent">{t.facsimile.dropHere}</p>
        {:else if upload}
          <div class="flex items-center gap-2 text-sm text-ink-soft" role="status">
            <Spinner size="sm" />
            <span>{upload.processing ? t.facsimile.processing : t.facsimile.uploading(Math.round(upload.progress * 100))}</span>
          </div>
        {:else}
          {#if wb.canMaintainWitness}
            <Button size="sm" variant="primary" onclick={() => fileInput?.click()}>
              <ImageUp class="size-4" aria-hidden="true" />
              {t.facsimile.addImage}
            </Button>
          {/if}
          {#if onpages}<Button size="sm" onclick={onpages}>{t.facsimile.allPages}</Button>{/if}
        {/if}
      </EmptyState>
      {#if wb.canMaintainWitness}
        <input bind:this={fileInput} type="file" accept={ACCEPT_IMAGES} class="hidden" tabindex="-1" aria-hidden="true" onchange={chosenFile} />
      {/if}
    </div>
  {:else}
    {#if wb.canEdit}
      <fieldset class="contents" disabled={!mapping} title={mapping ? undefined : unmappableTitle}>
      <div class="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5 font-sans" role="toolbar" aria-label={t.facsimile.tools}>
        <div class="inline-flex rounded-md border border-line p-0.5" role="group" aria-label={t.facsimile.shape}>
          <button type="button" aria-pressed={shape === 'rect'} class={toolClass(shape === 'rect')} onclick={() => (shape = 'rect')}>
            {t.facsimile.rect}
          </button>
          <button
            type="button"
            aria-pressed={shape === 'polygon'}
            class={toolClass(shape === 'polygon')}
            onclick={() => (shape = 'polygon')}
          >
            {t.facsimile.polygon}
          </button>
        </div>
        <button
          type="button"
          class={toolClass(intent === 'selection')}
          aria-pressed={intent === 'selection'}
          title={t.facsimile.mapSelectionHint}
          disabled={busy || selectedWords.length === 0}
          onclick={() => arm('selection')}
        >
          {t.facsimile.mapSelection}
        </button>
        <button
          type="button"
          class={toolClass(intent === 'lines')}
          aria-pressed={intent === 'lines'}
          title={t.facsimile.mapLinesHint}
          disabled={busy || wb.focusTokens.length === 0}
          onclick={() => arm('lines')}
        >
          {t.facsimile.mapLines}
        </button>
        <button
          type="button"
          class={toolClass(intent === 'feature')}
          aria-pressed={intent === 'feature'}
          title={t.facsimile.featureHint}
          disabled={busy}
          onclick={() => arm('feature')}
        >
          {t.facsimile.feature}
        </button>
        <Menu label={t.facsimile.delete.label} triggerSize="sm" triggerClass="h-7 px-2 text-xs" align="start">
          {#snippet trigger()}{t.facsimile.delete.label}<ChevronDown class="size-3.5 text-ink-muted" aria-hidden="true" />{/snippet}
          <MenuItem disabled={busy || deletable.length === 0} onSelect={() => void remove(deletable)}>
            {t.facsimile.delete.selected(deletable.length)}
          </MenuItem>
          {#if orphans.length}
            <MenuItem disabled={busy} onSelect={() => void remove(orphans)}>{t.facsimile.delete.orphans(orphans.length)}</MenuItem>
          {/if}
          <MenuSeparator />
          <MenuItem danger disabled={busy || wordBoxes.length === 0} onSelect={() => (confirmAll = true)}>
            {t.facsimile.delete.all(wordBoxes.length)}
          </MenuItem>
        </Menu>
        <Menu label={t.facsimile.select.label} triggerSize="sm" triggerClass="h-7 px-2 text-xs" align="start">
          {#snippet trigger()}{t.facsimile.select.label}<ChevronDown class="size-3.5 text-ink-muted" aria-hidden="true" />{/snippet}
          <MenuItem disabled={busy || !(wb.selection.caret ?? wb.selection.ids[0])} onSelect={selectLine}>{t.facsimile.select.line}</MenuItem>
          <MenuItem disabled={busy || wordBoxIds.length === 0} onSelect={() => pickByHand([...wordBoxIds])}>
            {t.facsimile.select.all(wordBoxIds.length)}
          </MenuItem>
          <MenuItem disabled={busy || wordBoxIds.length === 0} onSelect={() => arm('area')}>{t.facsimile.select.area}</MenuItem>
          <MenuSeparator />
          <MenuItem disabled={!picked.length && !selectedZone} onSelect={clearPicked}>{t.facsimile.select.none}</MenuItem>
        </Menu>
        <button
          type="button"
          class={toolClass(false)}
          title={undoable ? t.facsimile.history.undoTitle(undoable.label) : t.facsimile.history.nothing}
          disabled={busy || !undoable}
          onclick={undo}
        >
          {t.facsimile.undo}
        </button>
        <button
          type="button"
          class={toolClass(false)}
          title={redoable ? t.facsimile.history.redoTitle(redoable.label) : t.facsimile.history.nothingRedo}
          disabled={busy || !redoable}
          onclick={redo}
        >
          {t.facsimile.redo}
        </button>
        <div class="ml-auto flex flex-wrap items-center gap-x-3">
          <Checkbox class="text-xs" checked={outlines} onchange={(event) => setOutlines((event.currentTarget as HTMLInputElement).checked)}>
            {t.facsimile.showBoxes}
          </Checkbox>
          <Checkbox class="text-xs" bind:checked={wb.showUnmapped}>{t.facsimile.showUnmapped}</Checkbox>
        </div>
      </div>
      </fieldset>
    {/if}
    {#if message}
      <p class="border-b border-line bg-sunken px-3 py-1 font-sans text-xs text-ink-soft" role="status">{message}</p>
    {/if}
    {#if group}
      <p class="border-b border-line bg-sunken px-3 py-1 font-sans text-xs text-ink-soft">{t.facsimile.group.hint(group.length)}</p>
    {/if}
    <div class="relative min-h-0 flex-1">
      {#if browser}
        <FacsimileViewer
          source={page.source}
          zones={viewerZones}
          {highlighted}
          selected={group ? null : selectedZone}
          {mode}
          editable={mapping}
          {outlines}
          labels={t.facsimile.controls}
          onzonecreate={created}
          onzonechange={(id, geometry) => void reshape([{ id, geometry }])}
          onzoneselect={selectZone}
          onviewready={(view) => (imageSize = view.imageSize)}
          onzonehover={hoverZone}
          onbackgroundclick={clearPicked}
        >
          {#snippet children(view)}
            {#if group}
              <BoxGroup
                api={view}
                boxes={group}
                labels={groupLabels}
                onpreview={(shapes) => (preview = shapes)}
                onchange={groupChanged}
                onpick={(id, extend) => selectZone(id, extend)}
              />
            {/if}
          {/snippet}
        </FacsimileViewer>
      {/if}
    </div>
    <ImageCredit rights={page.rights} attribution={page.attribution} class="shrink-0 truncate border-t border-line px-3 py-1" />
  {/if}
</div>

{#if wb.canMaintainWitness}
  <PageImageDialog
    bind:request={imageRequest}
    defaults={wb.imageDefaults}
    maxBytes={wb.maxUploadBytes}
    onconfirm={(request, choice) => void sendImage(request.id, choice)}
  />
{/if}

<Dialog bind:open={confirmAll} title={t.facsimile.delete.confirmTitle} description={t.facsimile.delete.confirmBody(wordBoxes.length, page?.label ?? '')} size="sm">
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmAll = false)}>{t.facsimile.delete.cancel}</Button>
    <Button
      variant="danger"
      onclick={() => {
        confirmAll = false;
        void remove(wordBoxes);
      }}>{t.facsimile.delete.confirm(wordBoxes.length)}</Button
    >
  {/snippet}
</Dialog>

<FeatureDialog bind:open={featureOpen} onsave={saveFeature} oncancel={() => (pendingFeature = null)} />
