<script lang="ts">
  /**
   * The transcription workbench: the text one page at
   * a time with its segment gutter and the bar above it, the facsimile or
   * the other form or the history or the pages beside it, on the side the
   * editor chooses, the toolbar under a selection, and the status line.
   * Edits are saved by the workbench's session as they are made.
   */
  import { onMount, tick as nextTick, untrack } from 'svelte';
  import { beforeNavigate, replaceState } from '$app/navigation';
  import type { Id, Token } from '@varians/core';
  import TextEditor from '$lib/components/editor/TextEditor.svelte';
  import { Splitter } from '$lib/components/ui';
  import { PaneSize } from '$lib/layout/pane-size.svelte';
  import ConflictNotice from '$lib/components/workbench/ConflictNotice.svelte';
  import CopyDialog from '$lib/components/registry/CopyDialog.svelte';
  import { registry } from '$lib/strings/registry';
  import ImportDialog from '$lib/components/workbench/ImportDialog.svelte';
  import NumberLinesDialog from '$lib/components/workbench/NumberLinesDialog.svelte';
  import ProposalsDialog from '$lib/components/workbench/ProposalsDialog.svelte';
  import SegmentPopover from '$lib/components/workbench/SegmentPopover.svelte';
  import DiacriticChooser from '$lib/components/workbench/DiacriticChooser.svelte';
  import SelectionToolbar from '$lib/components/workbench/SelectionToolbar.svelte';
  import SettingsDialog from '$lib/components/workbench/SettingsDialog.svelte';
  import CorrectionDialog from '$lib/components/workbench/CorrectionDialog.svelte';
  import VariantDialog from '$lib/components/workbench/VariantDialog.svelte';
  import SidePane from '$lib/components/workbench/SidePane.svelte';
  import StatusLine from '$lib/components/workbench/StatusLine.svelte';
  import TextBar from '$lib/components/workbench/TextBar.svelte';
  import WorkbenchHeader from '$lib/components/workbench/WorkbenchHeader.svelte';
  import { pageOf, UNPLACED, WHOLE } from '$lib/workbench/pages';
  import { Workbench } from '$lib/components/workbench/workbench.svelte';
  import { uncheckedIn } from '$lib/workbench/normalization';
  import type { CorrectionAttrs, CorrectionFound, VariantAttrs } from '$lib/editor/marks';
  import { handLabel } from '$lib/workbench/hands';
  import { workbench as t } from '$lib/strings/workbench';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // One workbench for the page's life: later loads (none are asked for) would not replace the text being edited.
  const wb = untrack(() => new Workbench(data));

  // An address of a word (/id/<token>) arrives with ?word=<id>: once the editor is there, the word is selected and in view.
  let wordShown = false;
  $effect(() => {
    const api = wb.api;
    if (!api || wordShown) return;
    const word = new URL(location.href).searchParams.get('word');
    wordShown = true;
    if (!word || !wb.stream.items.some((i) => i.id === word)) return;
    api.selectTokens(word, word);
    api.scrollToToken(word);
  });

  let paneOpen = $state(true);
  // A witness with neither pages nor text opens on its pages: that is where its transcription begins.
  let sideTab = $state(
    untrack(() => (wb.pages.length === 0 && wb.stream.items.length === 0 ? 'pages' : 'facsimile')),
  );
  let importOpen = $state(false);
  let settingsOpen = $state(false);
  let copyOpen = $state(false);
  let numberOpen = $state(false);
  let proposalsOpen = $state(false);
  let segmentRequest = $state<{ tokenId: Id; current: string | null } | null>(null);
  let variantOpen = $state(false);
  let variantWords = $state('');
  let variantInitial = $state<VariantAttrs | null>(null);
  let correctionOpen = $state(false);
  let correctionInitial = $state<CorrectionFound | null>(null);

  /** The name of a hand as the marks record it, for the editor's tooltips. */
  const nameHand = (value: string) =>
    handLabel(value, wb.witness.hands, {
      scribe: t.hands.scribe.toLowerCase(),
      other: t.hands.other.toLowerCase(),
    }) ?? value;
  let editorArea = $state<HTMLDivElement>();
  let tick = $state(0);
  /** The selection toolbar keeps out of the way while a selection is made with the pointer, and after Escape. */
  let selecting = $state(false);
  let dismissed = $state(false);

  /** The view is remembered once the one remembered from before has been taken. */
  let viewRestored = $state(false);

  onMount(() => {
    wb.restoreView();
    viewRestored = true;
    wb.start();
    return () => wb.stop();
  });

  // A list's Settings… and Make a Copy… lead here with the window to open (?settings=1, ?copy=1).
  onMount(() => {
    const url = new URL(location.href);
    const settings = url.searchParams.get('settings') === '1';
    const copy = url.searchParams.get('copy') === '1';
    if (!settings && !copy) return;
    if (settings && wb.canEdit) settingsOpen = true;
    else if (copy && data.user) copyOpen = true;
    url.searchParams.delete('settings');
    url.searchParams.delete('copy');
    replaceState(url, {});
  });

  $effect(() => {
    void wb.view;
    if (viewRestored) untrack(() => wb.rememberView());
  });

  /** In the whole text, a double-click opens the word's page with the word selected. */
  async function openWord(tokenId: Id) {
    const at = pageOf(wb.stream, tokenId);
    if (!at) return;
    wb.goTo(at === UNPLACED ? UNPLACED : at);
    await nextTick();
    requestAnimationFrame(() => {
      wb.api?.selectTokens(tokenId, tokenId);
      wb.api?.scrollToToken(tokenId);
      wb.api?.focus();
    });
  }

  /** The selection toolbar's Segment…: the segment that begins at the first selected word. */
  function segmentOfSelection() {
    const first = wb.selection.ids[0] ?? wb.selection.caret;
    if (!first) return;
    const item = wb.stream.items.find((i) => i.id === first);
    const start = item && item.kind !== 'break' ? item.segment : undefined;
    requestSegment(
      first,
      start
        ? start.segmentId === null
          ? null
          : (wb.segmentLabels[start.segmentId] ?? null)
        : null,
    );
  }

  // The zones of the page shown, for the facsimile and the unmapped count.
  $effect(() => {
    const id = wb.pageId;
    const page = wb.witnessPage;
    if (id && page?.source) untrack(() => void wb.loadZones(id));
  });

  /** Highlights the editor draws: the words of a zone under the pointer, the unmapped words when asked. */
  const tokenClasses = $derived.by(() => {
    const out: Record<string, string> = {};
    if (wb.showUnmapped) for (const id of wb.unmapped) out[id] = 'wb-unmapped';
    for (const id of wb.litTokens) out[id] = out[id] ? `${out[id]} wb-lit` : 'wb-lit';
    for (const [id, choice] of wb.diacriticChoices) {
      const name = choice.reason === 'unknown' ? 'wb-unknown' : 'wb-choose';
      out[id] = out[id] ? `${out[id]} ${name}` : name;
    }
    return out;
  });

  /** The selection toolbar measures again after the editor has drawn. */
  function remeasure() {
    requestAnimationFrame(() => tick++);
  }

  function selection(ids: Id[], caret: Id | null) {
    wb.editorSelection(ids, caret);
    remeasure();
  }

  function onToolbar(event: Event): boolean {
    return (
      event.target instanceof Element && event.target.closest('[data-selection-toolbar]') !== null
    );
  }

  function pointerdown(event: PointerEvent) {
    if (onToolbar(event)) return;
    selecting = true;
    dismissed = false;
  }

  function pointerup() {
    selecting = false;
    remeasure();
  }

  function keyup(event: KeyboardEvent) {
    if (event.key !== 'Escape' && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))
      dismissed = false;
    remeasure();
  }

  function requestSegment(tokenId: Id, current: string | null) {
    if (!wb.canEdit || wb.view === WHOLE) return;
    segmentRequest = { tokenId, current };
  }

  function map() {
    paneOpen = true;
    sideTab = 'facsimile';
    wb.mapRequested = true;
  }

  function showPages() {
    paneOpen = true;
    sideTab = 'pages';
  }

  /** Ask for the variant of the selected words; one they are exactly the words of is changed. */
  function openVariant() {
    const api = wb.api;
    if (!api) return;
    const ids = new Set(api.selectedTokens());
    variantWords = wb.stream.items
      .filter((item): item is Token => item.kind === 'token' && ids.has(item.id))
      .map((token) => (wb.editorForm === 'written' ? token.form : (token.norm ?? token.form)))
      .join(' ');
    const found = api.variantAtSelection();
    variantInitial = found?.exact
      ? { reading: found.reading, place: found.place, ...(found.hand ? { hand: found.hand } : {}) }
      : null;
    variantOpen = true;
  }

  function saveVariant(variant: VariantAttrs) {
    wb.api?.setVariant(variant);
    wb.api?.focus();
  }

  /** Ask for the hand and stage of the deletions and additions the selected words carry. */
  function openCorrection() {
    const found = wb.api?.correctionAtSelection();
    if (!found) return;
    correctionInitial = found;
    correctionOpen = true;
  }

  function saveCorrection(attrs: CorrectionAttrs) {
    wb.api?.setCorrection(attrs);
    wb.api?.focus();
  }

  function showUnchecked() {
    const first = uncheckedIn(wb.pageStream)[0];
    if (first && wb.api) {
      wb.api.selectToken(first.id);
      wb.api.focus();
    }
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') dismissed = true;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void wb.flush();
      return;
    }
    if (event.altKey && !mod && (event.key === 'PageDown' || event.key === 'PageUp')) {
      const target = event.key === 'PageDown' ? wb.neighbours.next : wb.neighbours.previous;
      if (target !== null || event.key === 'PageUp') {
        event.preventDefault();
        if (target !== null) wb.goTo(target);
      }
    }
  }

  function beforeunload(event: BeforeUnloadEvent) {
    if (!wb.unsaved) return;
    void wb.flush();
    event.preventDefault();
    event.returnValue = t.status.leaveWarning;
  }

  beforeNavigate(({ willUnload }) => {
    if (!willUnload) void wb.flush();
  });

  // The side pane's width, which the divider changes and the browser remembers.
  let splitArea = $state<HTMLElement | null>(null);
  const sidePane = new PaneSize('workbench.side', {
    min: 300,
    max: 1800,
    fallback: 560,
    initial: () => window.innerWidth * 0.44,
  });
  onMount(() => sidePane.restore());

  // Which side the pane stands on (C4), remembered in the browser beside its width.
  const PLACEMENT_KEY = 'varians.pane.workbench.placement';
  let paneLeft = $state(false);
  onMount(() => {
    try {
      paneLeft = window.localStorage.getItem(PLACEMENT_KEY) === 'left';
    } catch {
      // The right, as by default.
    }
  });

  function placePane(left: boolean) {
    paneLeft = left;
    try {
      window.localStorage.setItem(PLACEMENT_KEY, left ? 'left' : 'right');
    } catch {
      // Not remembered.
    }
  }
</script>

<svelte:window
  onkeydown={keydown}
  onbeforeunload={beforeunload}
  onresize={remeasure}
  onpointerup={pointerup}
/>

<div class="workbench flex h-[calc(100dvh-3.5rem-1px)] min-h-[28rem] flex-col">
  <WorkbenchHeader
    {wb}
    rights={{ signedIn: !!data.user, edit: wb.canEdit, delete: wb.canDelete }}
    {paneOpen}
    ontogglepane={() => (paneOpen = !paneOpen)}
    onsettings={() => (settingsOpen = true)}
    oncopy={() => (copyOpen = true)}
    {paneLeft}
    onpaneleft={placePane}
  />
  {#if wb.setAside}
    <ConflictNotice ops={wb.setAside} ondismiss={() => (wb.setAside = null)} />
  {/if}
  <div
    class={[
      'grid min-h-0 flex-1',
      paneOpen
        ? paneLeft
          ? 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[min(var(--wb-pane),70%)_auto_minmax(0,1fr)] lg:grid-rows-1'
          : 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_auto_min(var(--wb-pane),70%)] lg:grid-rows-1'
        : 'grid-cols-1',
    ]}
    bind:this={splitArea}
    style:--wb-pane="{sidePane.value}px"
  >
    <div class={['flex min-h-0 flex-col bg-surface', paneOpen && paneLeft && 'lg:order-3']}>
      <TextBar
        {wb}
        onpages={showPages}
        onimport={() => (importOpen = true)}
        onnumber={() => (numberOpen = true)}
      />
      <div
        class="relative min-h-0 flex-1 bg-surface"
        bind:this={editorArea}
        onkeyup={keyup}
        onpointerdowncapture={pointerdown}
        onscrollcapture={remeasure}
        role="presentation"
      >
        {#key wb.generation}
          <TextEditor
            stream={wb.stream}
            form={wb.editorForm}
            readonly={!wb.canEdit || wb.view === WHOLE}
            page={wb.page}
            pageOrder={wb.pageOrder}
            segmentLabels={wb.segmentLabels}
            pageLabels={wb.pageLabels}
            {tokenClasses}
            handLabel={nameHand}
            bind:api={wb.api}
            onops={(ops, next) => wb.editorOps(ops, next)}
            onselection={selection}
            ontokenhover={(id) => (wb.hoveredToken = id)}
            onrequestsegment={requestSegment}
            oncut={(cut) => wb.editorCut(cut)}
            oncopy={() => wb.editorCopy()}
            onpaste={(text) => wb.editorPaste(text)}
            onworddblclick={(id) => void openWord(id)}
          />
        {/key}
        {#if wb.canEdit && wb.view !== WHOLE}
          <SelectionToolbar
            {wb}
            container={editorArea}
            {tick}
            hidden={selecting || dismissed || variantOpen || correctionOpen}
            onmap={map}
            onvariant={openVariant}
            oncorrection={openCorrection}
            onsegment={segmentOfSelection}
          />
          <SegmentPopover
            {wb}
            request={segmentRequest}
            root={editorArea}
            onclose={() => (segmentRequest = null)}
          />
          <DiacriticChooser {wb} root={editorArea} />
        {/if}
      </div>
    </div>
    {#if paneOpen}
      <Splitter
        class={paneLeft ? 'hidden lg:order-2 lg:block' : 'hidden lg:block'}
        pane={sidePane}
        axis="x"
        side={paneLeft ? 'before' : 'after'}
        container={splitArea}
        label={t.pane.resize}
      />
      <aside
        class={['min-h-0 border-t border-line lg:border-t-0', paneLeft && 'lg:order-1']}
        aria-label={t.pane.label}
      >
        <SidePane {wb} bind:tab={sideTab} />
      </aside>
    {/if}
  </div>
  <StatusLine {wb} onproposals={() => (proposalsOpen = true)} onunchecked={showUnchecked} />
</div>

{#if wb.canEdit}
  <ImportDialog {wb} bind:open={importOpen} />
  <SettingsDialog {wb} bind:open={settingsOpen} />
  <NumberLinesDialog {wb} bind:open={numberOpen} />
  <ProposalsDialog {wb} bind:open={proposalsOpen} />
  <VariantDialog
    bind:open={variantOpen}
    words={variantWords}
    hands={wb.witness.hands}
    initial={variantInitial}
    onsave={saveVariant}
    oncancel={() => wb.api?.focus()}
  />
  <CorrectionDialog
    bind:open={correctionOpen}
    hands={wb.witness.hands}
    initial={correctionInitial}
    onsave={saveCorrection}
    oncancel={() => wb.api?.focus()}
  />
{/if}
{#if data.user}
  <CopyDialog
    bind:open={copyOpen}
    title={registry.copy.transcriptionTitle}
    description={registry.copy.transcriptionBody}
    proposed={registry.copy.proposed(wb.name)}
    action="?/copy"
    label={registry.copy.name}
  />
{/if}

<style>
  /* Highlights the workbench puts on words in the editors. */
  .workbench :global(.wb-lit) {
    background: color-mix(in srgb, var(--color-accent) 22%, transparent);
    border-radius: 0.15em;
  }

  /* Words left to choose after Normalize diacritics, and words the analyser does not know. */
  .workbench :global(.wb-choose) {
    box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--color-accent) 70%, transparent);
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }

  .workbench :global(.wb-unknown) {
    box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--color-danger) 55%, transparent);
  }

  .workbench :global(.wb-unmapped) {
    background: color-mix(in srgb, var(--color-warning) 16%, transparent);
    box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--color-warning) 55%, transparent);
  }
</style>
