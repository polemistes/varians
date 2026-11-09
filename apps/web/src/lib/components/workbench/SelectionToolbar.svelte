<script lang="ts">
  /**
   * The toolbar under a selection (PLAN 6.2, PLAN-3 C5, C7): the marks of
   * the editor's toolbar, with the workbench's own actions beside them: move
   * the words to a page, set their segment, map them, confirm their read
   * forms, note a variant the manuscript gives for them. Shown only while
   * text is selected. Breaks and objects are made at the caret, from the
   * Insert menu, not here.
   */
  import { DropdownMenu } from 'bits-ui';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import EditorToolbar from '$lib/components/editor/EditorToolbar.svelte';
  import { UNPLACED } from '$lib/workbench/pages';
  import { floatingPosition } from '$lib/workbench/view';
  import { uncheckedIn } from '$lib/workbench/normalization';
  import { workbench as t } from '$lib/strings/workbench';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    /** The element the toolbar is placed in (position: relative). */
    container: HTMLElement | undefined;
    /** Bumped by the owner whenever the selection or the scroll may have moved. */
    tick: number;
    /** Kept out of the way while a new selection is being made, or after Escape. */
    hidden?: boolean;
    onmap: () => void;
    /** Note a variant for the selected words, or change the one they carry. */
    onvariant: () => void;
    /** Give the deletions and additions of the selected words a hand and a stage. */
    oncorrection: () => void;
    /** Set the segment that begins at the first selected word. */
    onsegment: () => void;
  }

  let { wb, container, tick, hidden = false, onmap, onvariant, oncorrection, onsegment }: Props = $props();

  /** The places the words can go, besides the proposed page: Not on a page and every other page. */
  const targets = $derived([
    ...(wb.view !== UNPLACED ? [{ id: null as string | null, label: t.pages.unplaced, text: wb.unplacedWords > 0 }] : []),
    ...wb.pages.filter((p) => p.id !== wb.view).map((p) => ({ id: p.id as string | null, label: p.label, text: wb.textOnPages.has(p.id) })),
  ]);

  const menuItem =
    'flex w-full cursor-default items-center gap-2 rounded px-2 py-1 text-left text-ink outline-none select-none data-highlighted:bg-sunken';

  let width = $state(0);
  let height = $state(0);
  let at = $state<{ top: number; left: number } | null>(null);

  $effect(() => {
    void tick;
    void width;
    void height;
    const api = wb.api;
    if (!api || !container) {
      at = null;
      return;
    }
    const rect = api.selectionRect();
    wb.hasRange = rect !== null;
    if (!rect) {
      at = null;
      return;
    }
    const box = container.getBoundingClientRect();
    // Hidden while the selection is scrolled out of view.
    if (rect.bottom < box.top || rect.top > box.bottom) {
      at = null;
      return;
    }
    at = floatingPosition(rect, { top: box.top, left: box.left, width: box.width, height: box.height }, { width: width || 480, height: height || 40 });
  });

  const unchecked = $derived(wb.keepsWrittenForm ? uncheckedIn(wb.stream, wb.selection.ids).length : 0);

  /** The variant the selected words carry, read again whenever the selection or the text moves. */
  const variant = $derived.by(() => {
    void tick;
    void wb.stream;
    void wb.selection;
    return wb.api?.variantAtSelection() ?? null;
  });

  /** The deletions and additions the selected words carry, if any. */
  const correction = $derived.by(() => {
    void tick;
    void wb.stream;
    void wb.selection;
    return wb.api?.correctionAtSelection() ?? null;
  });

  function removeVariant() {
    wb.api?.removeVariant();
  }

  function keepFocus(event: Event) {
    event.preventDefault();
  }
</script>

{#if at && !hidden}
  <!-- The frame lets the pointer through to the text; only the buttons take it. -->
  <div
    data-selection-toolbar
    class="pointer-events-none absolute z-30 flex w-[min(64rem,calc(100%-1rem))] flex-nowrap items-stretch gap-1"
    style:top="{at.top}px"
    style:left="{at.left}px"
    bind:clientWidth={width}
    bind:clientHeight={height}
    role="group"
    aria-label={t.toolbar.label}
  >
    <div
      class="pointer-events-auto flex shrink-0 flex-col items-stretch justify-center gap-0.5 rounded-[0.4rem] border border-line bg-surface px-1.5 py-[0.3rem] font-sans text-[0.78rem] shadow-pop"
      role="toolbar"
      aria-label={t.toolbar.actions}
    >
      {#if wb.pages.length > 0}
        <div class="flex items-stretch">
          {#if wb.proposedPage}
            {@const proposed = wb.proposedPage}
            <button type="button" class="wb-tool flex-1 text-left" title={t.move.toTitle} onpointerdown={keepFocus} onclick={() => wb.moveSelection(proposed)}>
              {t.move.to(wb.viewLabel(proposed))}
            </button>
          {/if}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger class="inline-flex items-center gap-0.5 rounded-[0.3rem] px-1.5 py-[0.2rem] leading-[1.3] text-ink hover:bg-sunken" title={t.move.otherTitle} aria-label={t.move.other}>
              {#if !wb.proposedPage}{t.move.other}{/if}
              <ChevronDown class="size-3 text-ink-muted" aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={4}
                class="z-50 max-h-[60vh] min-w-44 overflow-y-auto rounded-md border border-line bg-surface p-1 font-sans text-sm shadow-pop outline-none"
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                {#each targets as target (target.id ?? UNPLACED)}
                  <DropdownMenu.Item class={menuItem} onSelect={() => wb.moveSelection(target.id)}>
                    <span class="flex-1">{target.label}</span>
                    {#if target.text}<span class="text-xs text-ink-muted" title={t.pages.hasText} aria-label={t.pages.hasText}>●</span>{/if}
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      {/if}
      <button type="button" class="wb-tool" title={t.toolbar.segmentTitle} onpointerdown={keepFocus} onclick={onsegment}>{t.toolbar.segment}</button>
      <button
        type="button"
        class="wb-tool disabled:opacity-50"
        title={wb.onPage ? t.toolbar.mapTitle : t.move.notMappable}
        disabled={!wb.onPage}
        onpointerdown={keepFocus}
        onclick={onmap}>{t.toolbar.map}</button
      >
      {#if unchecked > 0}
        <button
          type="button"
          class="wb-tool"
          title={t.toolbar.confirmTitle}
          onpointerdown={keepFocus}
          onclick={() => wb.confirm(wb.selection.ids)}
        >
          {t.toolbar.confirm} ({unchecked})
        </button>
      {/if}
      <button type="button" class="wb-tool" title={t.toolbar.variantTitle} onpointerdown={keepFocus} onclick={onvariant}>
        {variant?.exact ? t.toolbar.editVariant : t.toolbar.variant}
      </button>
      {#if variant}
        <button type="button" class="wb-tool" title={t.toolbar.removeVariantTitle} onpointerdown={keepFocus} onclick={removeVariant}>
          {t.toolbar.removeVariant}
        </button>
      {/if}
      {#if correction}
        <button type="button" class="wb-tool" title={t.toolbar.correctionTitle} onpointerdown={keepFocus} onclick={oncorrection}>
          {t.toolbar.correction}
        </button>
      {/if}
    </div>
    <EditorToolbar api={wb.api} inserts={false} segments={false} class="pointer-events-auto min-w-0 flex-1 shadow-pop" />
  </div>
{/if}

<style>
  .wb-tool {
    border-radius: 0.3rem;
    padding: 0.2rem 0.5rem;
    line-height: 1.3;
    color: var(--color-ink);
  }

  .wb-tool:hover {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
</style>
