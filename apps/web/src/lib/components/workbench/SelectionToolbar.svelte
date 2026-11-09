<script lang="ts">
  /**
   * The toolbar under a selection (PLAN 6.2): the marks of the editor's
   * toolbar, with the workbench's own actions beside them: map the words,
   * confirm their read forms, note a variant the manuscript gives for them.
   * Shown only while text is selected. Breaks and objects are made at the
   * caret, from the Insert menu, not here.
   */
  import EditorToolbar from '$lib/components/editor/EditorToolbar.svelte';
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
  }

  let { wb, container, tick, hidden = false, onmap, onvariant, oncorrection }: Props = $props();

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
      <button type="button" class="wb-tool" title={t.toolbar.mapTitle} onpointerdown={keepFocus} onclick={onmap}>{t.toolbar.map}</button>
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
    <EditorToolbar api={wb.api} inserts={false} class="pointer-events-auto min-w-0 flex-1 shadow-pop" />
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
