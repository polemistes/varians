<script lang="ts">
  /**
   * The words of a line with what happened to them marked in the colour of
   * who did it: added underlined on a tint, removed struck through where they
   * stood, re-spelt faintly underlined with the old spelling in the title,
   * moved with a small arrow. Null cells are clipped stretches (an ellipsis).
   * In the run of a prose paragraph the label of a segment stands before the
   * word it begins at.
   */
  import type { Id } from '@varians/core';
  import type { Cell } from '$lib/history/types';
  import { cellText, spaceAfter } from '$lib/history/placement';
  import { historyStrings as t } from '$lib/strings/history';

  interface Props {
    cells: (Cell | null)[];
    /** The labels of the segments that begin in the run, by the id of the item each begins at. */
    labels?: Map<Id, string>;
    /** The CSS colour of a person's marks. */
    colorOf: (userId: string | null) => string;
    nameOf: (userId: string | null) => string;
    form?: 'written' | 'read';
    /** One colour for every mark, as on a review card, where one person made the whole change. */
    color?: string;
    /** The person who made every mark, when the cells do not say. */
    author?: string | null;
  }

  let { cells, labels, colorOf, nameOf, form = 'written', color, author }: Props = $props();

  function who(cell: Cell): string {
    return nameOf(cell.author ?? author ?? null);
  }

  function changedTitle(cell: Cell): string {
    const parts: string[] = [];
    for (const field of cell.fields) {
      if (field === 'form' && cell.was) parts.push(t.was(cell.was.form));
      else if (field === 'norm' && cell.was) parts.push(t.wasRead(cell.was.norm ?? cell.was.form));
      else if (t.fieldChanged[field]) parts.push(t.fieldChanged[field]!);
    }
    parts.push(t.changedBy(who(cell)));
    return parts.join('. ');
  }

  function title(cell: Cell): string {
    if (cell.removed)
      return cell.item.kind === 'break'
        ? `${t.removedBreak}. ${t.removedBy(who(cell))}`
        : t.removedBy(who(cell));
    if (cell.added)
      return cell.item.kind === 'break'
        ? `${t.addedBreak}. ${t.addedBy(who(cell))}`
        : t.addedBy(who(cell));
    if (cell.changed)
      return cell.moved ? `${t.movedTitle}. ${changedTitle(cell)}` : changedTitle(cell);
    return t.movedBy(who(cell));
  }
</script>

{#each cells as cell, i (cell ? `${cell.removed ? '-' : ''}${cell.item.id}` : `…${i}`)}
  {#if cell === null}
    <span class="text-ink-muted" aria-hidden="true">…</span>{' '}
  {:else}
    {@const text = cellText(cell.item, form)}
    {@const tint = color ?? colorOf(cell.author ?? author ?? null)}
    {#if !cell.removed && labels?.has(cell.item.id)}<sup class="seg-label"
        >{labels.get(cell.item.id)}</sup
      >{/if}{#if cell.removed}
      <del class="mark-removed" style:--c={tint} title={title(cell)}
        ><span class="sr-only">{t.markRemoved}: </span>{text}</del
      >
    {:else if cell.added}
      <ins class="mark-added" style:--c={tint} title={title(cell)}
        ><span class="sr-only">{t.markAdded}: </span>{text}</ins
      >
    {:else if cell.away && !cell.changed}
      <span class="mark-away" style:--c={tint} title={t.movedAwayBy(who(cell))}
        ><span class="sr-only">{t.markMovedAway}: </span>{text}</span
      >
    {:else if cell.changed || cell.moved}
      <span class={cell.changed ? 'mark-changed' : undefined} style:--c={tint} title={title(cell)}
        >{#if cell.moved}<span class="mark-arrow" aria-hidden="true">↷</span><span class="sr-only"
            >{t.markMoved}:
          </span>{/if}{#if cell.changed}<span class="sr-only"
            >{t.markChanged}:
          </span>{/if}{text}</span
      >
    {:else}
      <span class={cell.item.kind === 'token' ? undefined : 'text-ink-soft'}>{text}</span>
    {/if}{#if spaceAfter(cell, cells[i - 1])}{' '}{/if}
  {/if}
{/each}

<style>
  .seg-label {
    margin-inline: 0.15em 0.2em;
    font-family: var(--font-sans);
    font-size: 0.6em;
    font-variant-numeric: tabular-nums;
    color: var(--color-ink-muted);
    user-select: none;
  }

  .mark-added {
    text-decoration: underline;
    text-decoration-color: var(--c);
    text-decoration-thickness: 0.09em;
    text-underline-offset: 0.2em;
    background-color: color-mix(in oklab, var(--c) 15%, transparent);
    border-radius: 2px;
  }

  .mark-removed {
    color: color-mix(in oklab, var(--c) 70%, var(--color-ink-muted));
    text-decoration: line-through;
    text-decoration-color: var(--c);
    text-decoration-thickness: 0.08em;
  }

  .mark-changed {
    text-decoration: underline dotted;
    text-decoration-color: color-mix(in oklab, var(--c) 85%, transparent);
    text-decoration-thickness: 0.09em;
    text-underline-offset: 0.22em;
  }

  .mark-away {
    color: color-mix(in oklab, var(--c) 55%, var(--color-ink-muted));
    text-decoration: line-through dashed;
    text-decoration-color: color-mix(in oklab, var(--c) 70%, transparent);
    text-decoration-thickness: 0.07em;
  }

  .mark-arrow {
    margin-right: 0.1em;
    color: var(--c);
    font-family: var(--font-sans);
    font-size: 0.7em;
    vertical-align: 0.35em;
  }
</style>
