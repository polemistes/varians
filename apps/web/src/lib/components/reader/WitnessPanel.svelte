<script lang="ts">
  /**
   * The witnesses beside the text: the conspectus siglorum (each siglum, its
   * witness and description, where it is absent), and the text of the chosen
   * witness for the segments on screen, with the words of the open entry lit.
   */
  import X from '@lucide/svelte/icons/x';
  import type { Item } from '@varians/core';
  import { Select, Spinner } from '$lib/components/ui';
  import { absentRanges, formatRanges } from '$lib/reader/blocks';
  import { gapSign, LEIDEN_SIGLA, printLine, type Printed } from '$lib/reader/marks';
  import type { ReaderSiglum } from '$lib/reader/types';
  import { reader as r } from '$lib/strings/reader';
  import type { WitnessTexts } from './witness-texts.svelte';

  interface Props {
    sigla: ReaderSiglum[];
    /** The edition's groups of sigla, each standing for several witnesses together. */
    groups?: { siglum: string; members: string[]; note?: string }[];
    /** The edition's segments in order, with the sigla absent from each. */
    order: { label: string; absent: string[] }[];
    siglum: string | null;
    texts: WitnessTexts;
    /** Segments on screen, in order. */
    segmentIds: string[];
    labelOf: Record<string, string>;
    /** Witness tokens to light: the open entry's reading in this witness. */
    lit: Set<string>;
    onselect: (siglum: string) => void;
    onclose: () => void;
  }

  let {
    sigla,
    groups = [],
    order,
    siglum,
    texts,
    segmentIds,
    labelOf,
    lit,
    onselect,
    onclose,
  }: Props = $props();

  /** The groups whose members are all in the conspectus shown. */
  const shownGroups = $derived(
    groups.filter((g) => g.members.every((m) => sigla.some((x) => x.siglum === m))),
  );

  const current = $derived(sigla.find((x) => x.siglum === siglum) ?? null);
  const transcriptionId = $derived(current?.transcriptionId ?? null);
  const absences = $derived(
    new Map(sigla.map((x) => [x.siglum, formatRanges(absentRanges(order, x.siglum))] as const)),
  );

  let form = $state<'read' | 'written'>('read');
  const writtenAvailable = $derived(
    transcriptionId ? texts.keepsWrittenForm[transcriptionId] === true : false,
  );
  const shownForm = $derived(writtenAvailable ? form : 'read');

  $effect(() => {
    if (transcriptionId && segmentIds.length) void texts.load(transcriptionId, segmentIds);
  });

  /** A run's items split at line breaks into printed pieces; page breaks are marked as well. */
  function printRun(items: Item[]): { pieces: Printed[]; brk: 'line' | 'page' | null }[] {
    const lines: { items: Item[]; brk: 'line' | 'page' | null }[] = [{ items: [], brk: null }];
    for (const item of items) {
      if (item.kind === 'break')
        lines.push({
          items: [],
          brk: item.type === 'page' || item.type === 'column' ? 'page' : 'line',
        });
      else lines[lines.length - 1]!.items.push(item);
    }
    // A run ends where the next segment begins: the break before it belongs to neither.
    while (lines.length > 1 && lines[lines.length - 1]!.items.length === 0) lines.pop();
    return lines.map((line) => ({
      pieces: printLine(line.items, LEIDEN_SIGLA, shownForm),
      brk: line.brk,
    }));
  }
</script>

<section class="panel" aria-labelledby="witness-panel-title">
  <header class="panel-header">
    <h2 id="witness-panel-title" class="panel-title">{r.panels.conspectus}</h2>
    <button
      type="button"
      class="panel-close"
      aria-label={r.panels.close(r.toolbar.witnesses)}
      title={r.panels.close(r.toolbar.witnesses)}
      onclick={onclose}
    >
      <X class="size-4" aria-hidden="true" />
    </button>
  </header>

  {#if sigla.length === 0}
    <p class="px-4 pb-4 text-sm text-ink-muted">{r.panels.conspectusEmpty}</p>
  {:else}
    <ul class="conspectus" aria-label={r.panels.conspectus}>
      {#each sigla as entry (entry.siglum)}
        <li>
          <button
            type="button"
            class={['conspectus-row', entry.siglum === siglum && 'selected']}
            aria-pressed={entry.siglum === siglum}
            onclick={() => onselect(entry.siglum)}
          >
            <span class="siglum">{entry.siglum}</span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm text-ink">{entry.witnessName}</span>
              {#if entry.description}<span class="block text-xs text-ink-soft"
                  >{entry.description}</span
                >{/if}
              {#if absences.get(entry.siglum)}<span class="block text-xs text-ink-muted"
                  >{r.panels.absentFrom} {absences.get(entry.siglum)}</span
                >{/if}
              {#if !entry.transcriptionId}<span class="block text-xs text-ink-muted italic"
                  >{r.panels.reportedOnly}</span
                >{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if shownGroups.length}
      <h3 class="panel-title groups-title">{r.panels.groups}</h3>
      <ul class="conspectus" aria-label={r.panels.groups}>
        {#each shownGroups as group (group.siglum)}
          <li class="group-row">
            <span class="siglum">{group.siglum}</span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm text-ink">{group.members.join(' ')}</span>
              {#if group.note}<span class="block text-xs text-ink-soft">{group.note}</span>{/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#if sigla.length}
    <div class="witness-head">
      <h3 class="panel-title">{r.panels.witness}</h3>
      <Select
        value={siglum ?? undefined}
        onchange={(event) => onselect((event.currentTarget as HTMLSelectElement).value)}
        aria-label={r.panels.chooseWitness}
        class="w-40"
        options={sigla.map((x) => ({ value: x.siglum, label: `${x.siglum}  ${x.witnessName}` }))}
      />
      {#if writtenAvailable}
        <div
          class="ml-auto flex rounded-md border border-line bg-sunken p-0.5 text-xs"
          role="group"
          aria-label={r.panels.formLabel}
        >
          <button
            type="button"
            class={[
              'rounded px-1.5 py-0.5',
              form === 'read' ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft',
            ]}
            aria-pressed={form === 'read'}
            onclick={() => (form = 'read')}>{r.panels.readForm}</button
          >
          <button
            type="button"
            class={[
              'rounded px-1.5 py-0.5',
              form === 'written' ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft',
            ]}
            aria-pressed={form === 'written'}
            onclick={() => (form = 'written')}>{r.panels.writtenForm}</button
          >
        </div>
      {/if}
    </div>

    <div class="witness-text">
      {#if !current}
        <p class="text-sm text-ink-muted">{r.panels.conspectusEmpty}</p>
      {:else if !transcriptionId}
        <p class="text-sm text-ink-muted">{r.panels.noTranscription}</p>
      {:else if segmentIds.length === 0}
        <p class="text-sm text-ink-muted">{r.panels.nothingOnScreen}</p>
      {:else}
        {#if texts.failed}<p class="mb-2 text-sm text-danger">{r.panels.failed}</p>{/if}
        {#each segmentIds as segmentId (segmentId)}
          {@const segment = texts.get(transcriptionId, segmentId)}
          <div class="witness-segment">
            <span class="witness-label">{labelOf[segmentId] ?? ''}</span>
            <div class="min-w-0 flex-1 font-serif text-ink" dir="auto">
              {#if !segment}
                <Spinner size="sm" class="text-ink-muted" />
              {:else if segment.runs.length === 0}
                <span class="font-sans text-xs text-ink-muted italic">{r.panels.absent}</span>
              {:else}
                {#each segment.runs as run, k (k)}{#if k > 0}<span class="sep">
                      …
                    </span>{/if}{#each printRun(run.items) as line, l (l)}{#if line.brk === 'line' && l > 0}<span
                        class="sep"
                        aria-hidden="true"
                      >
                        |
                      </span>{:else if line.brk === 'page'}<span class="sep" aria-hidden="true">
                        ‖
                      </span>{/if}{#each line.pieces as piece (piece.id)}{#if piece.space}{' '}{/if}{#if piece.kind === 'token'}{piece.before}<span
                          class={['ww', lit.has(piece.id) && 'lit']}
                          data-witness-token={piece.id}
                          >{#each piece.parts as part, p (p)}{#if part.struck}<s>{part.text}</s
                              >{:else}{part.text}{/if}{/each}</span
                        >{piece.after}{:else if piece.kind === 'gap'}<span
                          class={['text-ink-muted', piece.untranscribed && 'italic']}
                          title={piece.untranscribed ? r.text.notTranscribed : undefined}
                          >{gapSign(piece)}</span
                        >{:else if piece.kind === 'paratext'}<span class="text-ink-soft italic"
                          >{piece.text}</span
                        >{:else if piece.kind === 'lacuna'}<span class="text-ink-muted"
                          >{piece.text}</span
                        >{/if}{/each}{/each}{/each}
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</section>

<style>
  .panel {
    border: 1px solid var(--color-line);
    border-radius: 0.5rem;
    background: var(--color-surface);
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem 0.4rem 1rem;
  }

  .panel-title {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }

  .groups-title {
    padding: 0.25rem 1rem 0.25rem;
  }

  .panel-close {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.375rem;
    color: var(--color-ink-muted);
  }

  .panel-close:hover {
    background: var(--color-sunken);
    color: var(--color-ink);
  }

  .conspectus {
    display: flex;
    flex-direction: column;
    padding: 0 0.5rem 0.5rem;
  }

  .conspectus-row {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.35rem 0.5rem;
    border-radius: 0.375rem;
    text-align: start;
  }

  .group-row {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.35rem 0.5rem;
  }

  .conspectus-row:hover {
    background: var(--color-sunken);
  }

  .conspectus-row.selected {
    background: var(--color-accent-soft);
  }

  .siglum {
    min-width: 1.75rem;
    font-family: var(--font-serif);
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--color-ink);
  }

  .witness-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    border-top: 1px solid var(--color-line);
    padding: 0.75rem 1rem 0.5rem;
  }

  .witness-text {
    padding: 0.25rem 1rem 1rem;
  }

  .witness-segment {
    display: flex;
    gap: 0.75rem;
    padding-block: 0.2rem;
    font-size: 1.05rem;
    line-height: 1.55;
  }

  .witness-label {
    flex-shrink: 0;
    width: 2.5rem;
    padding-top: 0.3rem;
    font-family: var(--font-sans);
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    color: var(--color-ink-muted);
  }

  .sep {
    font-family: var(--font-sans);
    font-size: 0.75rem;
    color: var(--color-ink-muted);
  }

  .ww {
    border-radius: 0.15em;
    transition: background-color 120ms ease-out;
  }

  .lit {
    background: var(--color-accent-soft);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent);
  }
</style>
