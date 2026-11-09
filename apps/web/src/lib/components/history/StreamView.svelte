<script lang="ts">
  /**
   * A text as it stood, read-only: its lines as the layout gives them, labels
   * in a gutter, tokens as spans, and when a diff is given what changed
   * marked on it in the colour of who changed it (removed words put back
   * where they stood).
   */
  import type { Id, Stream } from '@varians/core';
  import { renderLines } from '$lib/history/placement';
  import type { SerializedDiff } from '$lib/history/types';
  import { historyStrings as t } from '$lib/strings/history';
  import MarkedCells from './MarkedCells.svelte';
  import './palette.css';

  interface Props {
    stream: Stream;
    diff?: SerializedDiff | null;
    /** Item id to the user who changed it, for the items in the diff. */
    authors?: Record<Id, string>;
    /** Segment id to label, for the gutter. */
    labelOf?: Record<string, string>;
    /** Print a label every n lines (verse). */
    numberEvery?: number;
    colorOf?: (userId: string | null) => string;
    nameOf?: (userId: string | null) => string;
    form?: 'written' | 'read';
    /** The accessible name of the text, when it stands on its own. */
    label?: string;
  }

  let {
    stream,
    diff = null,
    authors = {},
    labelOf = {},
    numberEvery = 1,
    colorOf = () => 'var(--author-none)',
    nameOf = () => t.unknownPerson,
    form = 'written',
    label,
  }: Props = $props();

  const lines = $derived(renderLines(stream, diff, (id) => labelOf[id] ?? '', { numberEvery }, authors));
  const empty = $derived(lines.every((line) => line.cells.length === 0 && !line.opener));
</script>

<div class="author-palette font-serif text-[0.9375rem] leading-[1.7] text-ink" role={label ? 'region' : undefined} aria-label={label}>
  {#if empty}
    <p class="font-sans text-sm text-ink-muted">{t.emptyText}</p>
  {:else}
    {#each lines as line (line.key)}
      <div class={['grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2', line.paragraph && 'mt-2.5']}>
        <span class="pt-[0.3em] text-right font-sans text-[0.6875rem] leading-normal text-ink-muted tabular-nums select-none">
          {line.label ?? ''}
        </span>
        <p class={['min-w-0 break-words', line.ghost && 'opacity-90']} dir="auto">
          {#if line.opener}
            {@const tint = colorOf(line.opener.author)}
            <span
              class={line.opener.added ? 'break-added' : 'break-moved'}
              style:--c={tint}
              title={`${line.opener.added ? t.addedBreak : t.movedTitle}. ${(line.opener.added ? t.addedBy : t.movedBy)(nameOf(line.opener.author))}`}
              ><span class="sr-only">{line.opener.added ? t.addedBreak : t.markMoved}</span><span aria-hidden="true"
                >{line.opener.added ? '¶' : '↷'}</span
              ></span
            >{' '}
          {/if}
          <MarkedCells cells={line.cells} {colorOf} {nameOf} {form} />
        </p>
      </div>
    {/each}
  {/if}
</div>

<style>
  .break-added,
  .break-moved {
    color: var(--c);
    font-family: var(--font-sans);
    font-size: 0.75em;
  }

  .break-added {
    border-radius: 2px;
    background-color: color-mix(in oklab, var(--c) 15%, transparent);
    padding-inline: 0.15em;
  }
</style>
