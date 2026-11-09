<script lang="ts">
  /**
   * The transcription workbench (PLAN 6.2): the text one page at a time with
   * its segment gutter, the facsimile or the other form or the history
   * beside it, the toolbar under a selection, and the status line. Edits are
   * saved by the workbench's session as they are made.
   */
  import { onMount, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import type { Id, Token } from '@varians/core';
  import TextEditor from '$lib/components/editor/TextEditor.svelte';
  import { Splitter } from '$lib/components/ui';
  import { PaneSize } from '$lib/layout/pane-size.svelte';
  import ConflictNotice from '$lib/components/workbench/ConflictNotice.svelte';
  import DeleteDialog from '$lib/components/workbench/DeleteDialog.svelte';
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
  import WorkbenchHeader from '$lib/components/workbench/WorkbenchHeader.svelte';
  import { Workbench } from '$lib/components/workbench/workbench.svelte';
  import { uncheckedIn } from '$lib/workbench/normalization';
  import type { CorrectionAttrs, CorrectionFound, VariantAttrs } from '$lib/editor/marks';
  import { handLabel } from '$lib/workbench/hands';
  import { workbench as t } from '$lib/strings/workbench';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // One workbench for the page's life: later loads (none are asked for) would not replace the text being edited.
  const wb = untrack(() => new Workbench(data));

  let paneOpen = $state(true);
  let sideTab = $state('facsimile');
  let importOpen = $state(false);
  let settingsOpen = $state(false);
  let deleteOpen = $state(false);
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
  const nameHand = (value: string) => handLabel(value, wb.witness.hands, { scribe: t.hands.scribe.toLowerCase(), other: t.hands.other.toLowerCase() }) ?? value;
  let editorArea = $state<HTMLDivElement>();
  let tick = $state(0);
  /** The selection toolbar keeps out of the way while a selection is made with the pointer, and after Escape. */
  let selecting = $state(false);
  let dismissed = $state(false);

  onMount(() => {
    wb.start();
    return () => wb.stop();
  });

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
    return event.target instanceof Element && event.target.closest('[data-selection-toolbar]') !== null;
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
    if (event.key !== 'Escape' && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) dismissed = false;
    remeasure();
  }

  function requestSegment(tokenId: Id, current: string | null) {
    if (!wb.canEdit) return;
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
    variantInitial = found?.exact ? { reading: found.reading, place: found.place, ...(found.hand ? { hand: found.hand } : {}) } : null;
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
  const sidePane = new PaneSize('workbench.side', { min: 300, max: 1800, fallback: 560, initial: () => window.innerWidth * 0.44 });
  onMount(() => sidePane.restore());
</script>

<svelte:window onkeydown={keydown} onbeforeunload={beforeunload} onresize={remeasure} onpointerup={pointerup} />

<div class="workbench flex h-[calc(100dvh-3.5rem-1px)] min-h-[28rem] flex-col">
  <WorkbenchHeader
    {wb}
    {paneOpen}
    ontogglepane={() => (paneOpen = !paneOpen)}
    onimport={() => (importOpen = true)}
    onsettings={() => (settingsOpen = true)}
    ondelete={() => (deleteOpen = true)}
    onnumber={() => (numberOpen = true)}
    oncopy={data.user ? () => (copyOpen = true) : undefined}
    onpages={showPages}
  />
  {#if wb.setAside}
    <ConflictNotice ops={wb.setAside} ondismiss={() => (wb.setAside = null)} />
  {/if}
  <div
    class={[
      'grid min-h-0 flex-1',
      paneOpen ? 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_auto_min(var(--wb-pane),70%)] lg:grid-rows-1' : 'grid-cols-1',
    ]}
    bind:this={splitArea}
    style:--wb-pane="{sidePane.value}px"
  >
    <div
      class="relative min-h-0 bg-surface"
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
        readonly={!wb.canEdit}
        page={wb.page}
        segmentLabels={wb.segmentLabels}
        pageLabels={wb.pageLabels}
        {tokenClasses}
        handLabel={nameHand}
        bind:api={wb.api}
        onops={(ops, next) => wb.editorOps(ops, next)}
        onselection={selection}
        ontokenhover={(id) => (wb.hoveredToken = id)}
        onrequestsegment={requestSegment}
      />
      {/key}
      {#if wb.canEdit}
        <SelectionToolbar {wb} container={editorArea} {tick} hidden={selecting || dismissed || variantOpen || correctionOpen} onmap={map} onvariant={openVariant} oncorrection={openCorrection} />
        <SegmentPopover {wb} request={segmentRequest} root={editorArea} onclose={() => (segmentRequest = null)} />
        <DiacriticChooser {wb} root={editorArea} />
      {/if}
    </div>
    {#if paneOpen}
      <Splitter class="hidden lg:block" pane={sidePane} axis="x" side="after" container={splitArea} label={t.pane.resize} />
      <aside class="min-h-0 border-t border-line lg:border-t-0" aria-label={t.pane.label}>
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
  <VariantDialog bind:open={variantOpen} words={variantWords} hands={wb.witness.hands} initial={variantInitial} onsave={saveVariant} oncancel={() => wb.api?.focus()} />
  <CorrectionDialog bind:open={correctionOpen} hands={wb.witness.hands} initial={correctionInitial} onsave={saveCorrection} oncancel={() => wb.api?.focus()} />
{/if}
{#if wb.canDelete}
  <DeleteDialog {wb} bind:open={deleteOpen} />
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
