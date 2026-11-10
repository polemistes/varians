<script lang="ts">
  /**
   * The apparatus at the foot of a block of lines, or beside it: the entries
   * of the segments that begin in the block, the conjectures no site took,
   * and the editor's notes; the interpretative variants in a tier of their
   * own when the conventions in force say so.
   */
  import { splitEntries, type ApparatusConventions, type Attachment } from '@varians/core';
  import type { KeyedEntry, SegmentPart } from '$lib/reader/sites';
  import type { ReaderNote } from '$lib/reader/types';
  import { reader as r } from '$lib/strings/reader';
  import ApparatusEntryView from './ApparatusEntryView.svelte';

  interface Props {
    segmentIds: string[];
    /** The entries by the segment each variant stands in. */
    entries: Map<string, KeyedEntry[]>;
    /** What belongs to each segment as a whole, by segment id. */
    segments: Record<string, SegmentPart<Attachment, ReaderNote>>;
    labelOf: Record<string, string>;
    conventions: ApparatusConventions;
    /** Beside the text, where the column is wide enough. */
    side: boolean;
  }

  let { segmentIds, entries, segments, labelOf, conventions, side }: Props = $props();

  const range = $derived.by(() => {
    const first = labelOf[segmentIds[0] ?? ''] ?? '';
    const last = labelOf[segmentIds[segmentIds.length - 1] ?? ''] ?? '';
    return first === last ? first : `${first}–${last}`;
  });

  const split = $derived(
    new Map(
      segmentIds.map((id) => [id, splitEntries(entries.get(id) ?? [], conventions)] as const),
    ),
  );
  const anyInterpretative = $derived([...split.values()].some((s) => s.interpretative.length > 0));
</script>

<div class={['apparatus', side && 'side']} role="group" aria-label={r.text.apparatus(range)}>
  <div class="entries">
    {#each segmentIds as segmentId (segmentId)}
      {#each split.get(segmentId)?.main ?? [] as entry (entry.siteIndex)}
        <ApparatusEntryView
          {entry}
          {conventions}
          siteKey={(entry as KeyedEntry).key}
          layout={side ? 'stacked' : 'inline'}
        />
      {/each}
      {#each segments[segmentId]?.unplaced ?? [] as attachment (attachment.id)}
        <span class={['unplaced', side && 'stacked']} dir="auto"
          ><b class="label">{labelOf[segmentId]}</b>{' '}{#if attachment.text}<span class="reading"
              >{attachment.text}</span
            >{' '}{/if}<span class="name">{attachment.name}</span>{#if attachment.source}{' '}<span
              class="source">{attachment.source}</span
            >{/if}</span
        >
      {/each}
    {/each}
  </div>
  {#if anyInterpretative}
    <div class="entries interpretative" role="group" aria-label={r.text.interpretative}>
      <span class="tier">{r.text.interpretative}</span>
      {#each segmentIds as segmentId (segmentId)}
        {#each split.get(segmentId)?.interpretative ?? [] as entry (entry.siteIndex)}
          <ApparatusEntryView
            {entry}
            {conventions}
            siteKey={(entry as KeyedEntry).key}
            layout={side ? 'stacked' : 'inline'}
          />
        {/each}
      {/each}
    </div>
  {/if}
  {#each segmentIds as segmentId (segmentId)}
    {#each segments[segmentId]?.notes ?? [] as note (note.id)}
      <p class="note" dir="auto">
        <b class="label">{labelOf[segmentId]}</b>
        {note.text}{#if note.cites?.length}{' '}({note.cites.join(
            '; ',
          )}){/if}{#if note.author}{' '}<span class="author">{r.text.noteBy(note.author)}</span
          >{/if}
      </p>
    {/each}
  {/each}
</div>

<style>
  /* Smaller than the text, in the interface face, set off by a hairline. */
  .apparatus {
    margin: 0.7em 0 1.5em;
    margin-inline-start: var(--label-column);
    border-top: 1px solid var(--color-line);
    padding-top: 0.5em;
    font-family: var(--font-sans);
    font-size: calc(var(--reader-size) * 0.72);
    line-height: 1.6;
    color: var(--color-ink-soft);
  }

  .entries :global(.entry),
  .unplaced {
    margin-inline-end: 1.1em;
  }

  .entries :global(.entry-stacked),
  .unplaced.stacked {
    display: block;
    margin-inline-end: 0;
  }

  .interpretative {
    margin-top: 0.4em;
    border-top: 1px dashed var(--color-line);
    padding-top: 0.35em;
  }

  .tier {
    margin-inline-end: 0.8em;
    font-size: 0.8em;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }

  .side .tier {
    display: block;
  }

  .label {
    font-weight: 600;
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
    color: var(--color-ink);
  }

  .reading {
    font-family: var(--font-serif);
    font-size: 1.08em;
    color: var(--color-ink);
  }

  .source,
  .author {
    color: var(--color-ink-muted);
  }

  .note {
    margin-top: 0.45em;
    font-family: var(--font-serif);
    font-size: 1.05em;
    line-height: 1.5;
    color: var(--color-ink-soft);
  }

  .note .label {
    font-family: var(--font-sans);
  }

  /* Beside the text, where the column is wide enough; the reading column sets the grid. */
  @container (min-width: 50rem) {
    .apparatus.side {
      margin: 0.3em 0 0;
      border-top: 0;
      border-inline-start: 1px solid var(--color-line);
      padding: 0 0 0 1rem;
    }
  }

  @media print {
    .apparatus,
    .apparatus.side {
      margin: 0.5em 0 1.2em;
      margin-inline-start: var(--label-column);
      border: 0;
      border-top: 0.5pt solid #000;
      padding: 0.3em 0 0;
      font-size: 8.5pt;
      line-height: 1.4;
      break-before: avoid;
      break-inside: avoid;
    }

    .entries :global(.entry-stacked),
    .unplaced.stacked {
      display: inline;
      margin-inline-end: 1.1em;
    }

    .source,
    .author,
    .note,
    .tier {
      color: inherit;
    }

    .interpretative {
      border-top: 0.5pt dashed #000;
    }

    .side .tier {
      display: inline;
    }
  }
</style>
