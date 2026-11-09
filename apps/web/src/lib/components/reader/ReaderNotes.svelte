<script lang="ts">
  /** The editor's notes on some words, as the popover and the list of variants show them. */
  import type { ReaderNote } from '$lib/reader/types';
  import { reader as r } from '$lib/strings/reader';

  interface Props {
    notes: ReaderNote[];
    compact?: boolean;
  }

  let { notes, compact = false }: Props = $props();
</script>

<div class={['notes', compact && 'compact']}>
  <p class="key">{r.entry.notes}</p>
  {#each notes as note (note.id)}
    <p class="note" dir="auto">{note.text}{#if note.cites?.length}{' '}({note.cites.join('; ')}){/if}{#if note.author}{' '}<span class="author">{r.text.noteBy(note.author)}</span>{/if}</p>
  {/each}
</div>

<style>
  .notes {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.2rem;
  }

  .key {
    font-family: var(--font-sans);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }

  .note {
    font-family: var(--font-serif);
    font-size: 0.98rem;
    line-height: 1.45;
    color: var(--color-ink-soft);
  }

  .compact .note {
    font-size: 0.92rem;
  }

  .author {
    font-family: var(--font-sans);
    font-size: 0.75rem;
    color: var(--color-ink-muted);
  }
</style>
