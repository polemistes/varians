<script lang="ts">
  /** The editor's dev page: the same stream in both forms, the toolbar, the operations emitted. */
  import { applyOps, type Id, type Op, type Stream } from '@varians/core';
  import type { Direction, EditorApi } from '$lib/editor/editor';
  import { pageBreaks } from '$lib/editor/page';
  import TextEditor from '$lib/components/editor/TextEditor.svelte';
  import EditorToolbar from '$lib/components/editor/EditorToolbar.svelte';
  import { pageLabels, sampleStream, segmentLabels as initialLabels } from './sample';

  let stream = $state.raw<Stream>(sampleStream());
  let segmentLabels = $state.raw<Record<string, string>>({ ...initialLabels });
  let page = $state<string | null>(null);
  let direction = $state<Direction>('auto');
  let lineNumbers = $state(true);
  let readonly = $state(false);
  let log = $state<{ from: string; ops: Op[] }[]>([]);
  let selection = $state<{ ids: Id[]; caret: Id | null }>({ ids: [], caret: null });
  let hovered = $state<Id | null>(null);
  let writtenApi = $state<EditorApi | null>(null);
  let readApi = $state<EditorApi | null>(null);
  let active = $state<'written' | 'read'>('written');

  const pages = $derived(pageBreaks(stream));
  const activeApi = $derived(active === 'written' ? writtenApi : readApi);

  function record(from: string, ops: Op[], next: Stream) {
    stream = next;
    log = [{ from, ops }, ...log].slice(0, 30);
  }

  function requestSegment(tokenId: Id, current: string | null) {
    const label = window.prompt(
      'Segment label (empty: unassigned from here, "x": remove the start)',
      current ?? '',
    );
    if (label === null) return;
    let ops: Op[];
    if (label === 'x') ops = [{ t: 'set', id: tokenId, fields: { segment: undefined } }];
    else if (label === '')
      ops = [{ t: 'set', id: tokenId, fields: { segment: { segmentId: null } } }];
    else {
      const segmentId = `il.${label}`;
      segmentLabels = { ...segmentLabels, [segmentId]: label };
      ops = [{ t: 'set', id: tokenId, fields: { segment: { segmentId } } }];
    }
    record('parent', ops, applyOps(stream, ops).stream);
  }

  function reset() {
    stream = sampleStream();
    segmentLabels = { ...initialLabels };
    log = [];
  }
</script>

<svelte:head>
  <title>Editor dev</title>
</svelte:head>

<div class="dev">
  <header>
    <h1>Text editor</h1>
    <label>
      Page
      <select bind:value={page}>
        <option value={null}>whole stream</option>
        {#each pages as brk (brk.id)}
          <option value={brk.pageId}
            >{(brk.pageId && pageLabels[brk.pageId]) || brk.label || brk.pageId || brk.id}</option
          >
        {/each}
        {#if !pages.some((brk) => brk.pageId === 'p-13r')}
          <option value="p-13r">13r (no break yet)</option>
        {/if}
      </select>
    </label>
    <label>
      Direction
      <select bind:value={direction}>
        <option value="auto">auto</option>
        <option value="ltr">ltr</option>
        <option value="rtl">rtl</option>
      </select>
    </label>
    <label><input type="checkbox" bind:checked={lineNumbers} /> line numbers</label>
    <label><input type="checkbox" bind:checked={readonly} /> read only</label>
    <button type="button" onclick={reset}>reset</button>
    <span class="status">
      toolbar acts on: <strong>{active}</strong>
      · selection: {selection.ids.length} token{selection.ids.length === 1 ? '' : 's'}
      · caret: {selection.caret ?? '–'}
      · hover: {hovered ?? '–'}
    </span>
  </header>

  <EditorToolbar api={activeApi} />

  <div class="editors">
    <section onfocusin={() => (active = 'written')}>
      <h2>Written</h2>
      <TextEditor
        {stream}
        form="written"
        {page}
        {direction}
        {lineNumbers}
        {readonly}
        {segmentLabels}
        {pageLabels}
        bind:api={writtenApi}
        onops={(ops, next) => record('written', ops, next)}
        onselection={(ids, caret) => (selection = { ids, caret })}
        ontokenhover={(id) => (hovered = id)}
        onrequestsegment={requestSegment}
      />
    </section>
    <section onfocusin={() => (active = 'read')}>
      <h2>Read</h2>
      <TextEditor
        {stream}
        form="read"
        {page}
        {direction}
        {lineNumbers}
        {readonly}
        {segmentLabels}
        {pageLabels}
        bind:api={readApi}
        onops={(ops, next) => record('read', ops, next)}
        onselection={(ids, caret) => (selection = { ids, caret })}
        ontokenhover={(id) => (hovered = id)}
        onrequestsegment={requestSegment}
      />
    </section>
  </div>

  <section class="log">
    <h2>Operations ({log.length} latest first)</h2>
    {#each log as entry, i (i)}
      <pre><span class="from">{entry.from}</span> {JSON.stringify(entry.ops, null, 1)}</pre>
    {/each}
    <details>
      <summary>Stream ({stream.items.length} items)</summary>
      <pre>{JSON.stringify(stream, null, 1)}</pre>
    </details>
  </section>
</div>

<style>
  .dev {
    padding: 1rem 1.5rem;
    font-family: var(--font-sans, system-ui, sans-serif);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    font-size: 0.85rem;
  }

  h1 {
    font-size: 1.1rem;
    margin: 0;
  }

  h2 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-muted, var(--color-ink-muted, #6f6a62));
    margin: 0 0 0.25rem;
  }

  .status {
    color: var(--color-muted, var(--color-ink-muted, #6f6a62));
  }

  .editors {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .editors section {
    display: flex;
    flex-direction: column;
    height: 60vh;
    min-height: 0;
  }

  .editors section > :global(.varians-editor) {
    flex: 1;
    min-height: 0;
    border: 1px solid
      color-mix(in srgb, var(--color-muted, var(--color-ink-muted, #6f6a62)) 28%, transparent);
    border-radius: 0.4rem;
  }

  .log pre {
    font-size: 0.72rem;
    margin: 0 0 0.5rem;
    white-space: pre-wrap;
    background: color-mix(
      in srgb,
      var(--color-muted, var(--color-ink-muted, #6f6a62)) 8%,
      transparent
    );
    padding: 0.4rem 0.6rem;
    border-radius: 0.3rem;
  }

  .from {
    color: var(--color-accent, #2d4b86);
    font-weight: 600;
  }
</style>
