<script lang="ts">
  /**
   * Development page for the facsimile side: draw zones on a sample page,
   * find lines with the projection profile, divide a line into words and
   * drag the dividers. Strings are inline because this page is for us.
   */
  import FacsimileViewer from '$lib/components/facsimile/FacsimileViewer.svelte';
  import WordDividers from '$lib/components/facsimile/WordDividers.svelte';
  import type { FacsimileApi, FacsimileMode, FacsimileSource, FacsimileZone, ZoneKind } from '$lib/facsimile/types';
  import { detectLines, divideLine } from '$lib/facsimile/layout';
  import { applyBoundary, type Direction } from '$lib/facsimile/dividers';
  import { rectOf, type Rect, type ZoneGeometry } from '@varians/core';

  interface DevZone extends FacsimileZone {
    /** For word zones: the line they were divided from. */
    lineId?: string;
    text?: string;
  }

  const SAMPLE: FacsimileSource = { kind: 'image', url: '/dev/sample.jpg', width: 1600, height: 2286 };

  let source = $state<FacsimileSource>(SAMPLE);
  let sourceInput = $state('');
  let zones = $state<DevZone[]>([]);
  let highlighted = $state<string[]>([]);
  let hoveredOnImage = $state<string | null>(null);
  let selected = $state<string | null>(null);
  let mode = $state<FacsimileMode>('pan');
  let editable = $state(true);
  let newKind = $state<ZoneKind>('feature');
  let direction = $state<Direction>('ltr');
  let wordsText = $state('καὶ τὸν ἄνδρα μοι ἔννεπε Μοῦσα');
  let threshold = $state(1.05);
  let status = $state('');
  let api = $state.raw<FacsimileApi | null>(null);
  let counter = 0;

  const nextId = (prefix: string) => `${prefix}-${++counter}`;
  const r4 = (v: number) => Math.round(v * 10000) / 10000;

  function describe(geometry: ZoneGeometry): string {
    if (geometry.polygon) return `polygon, ${geometry.polygon.length} points`;
    const r = rectOf(geometry);
    return r ? `x ${r4(r.x)}  y ${r4(r.y)}  w ${r4(r.w)}  h ${r4(r.h)}` : 'empty';
  }

  function zoneCreated(geometry: ZoneGeometry) {
    const id = nextId(newKind);
    zones = [...zones, { id, geometry, tokenIds: [], kind: newKind }];
    selected = id;
  }

  function zoneChanged(id: string, geometry: ZoneGeometry) {
    zones = zones.map((z) => (z.id === id ? { ...z, geometry } : z));
  }

  function remove(id: string) {
    zones = zones.filter((z) => z.id !== id && z.lineId !== id);
    if (selected === id) selected = null;
  }

  function clear() {
    zones = [];
    selected = null;
    status = '';
  }

  const selectedZone = $derived(zones.find((z) => z.id === selected) ?? null);
  const selectedLine = $derived.by(() => {
    if (!selectedZone) return null;
    if (selectedZone.kind === 'line') return selectedZone;
    if (selectedZone.lineId) return zones.find((z) => z.id === selectedZone.lineId) ?? null;
    return null;
  });
  const lineRect = $derived(selectedLine ? rectOf(selectedLine.geometry) : null);
  const lineWords = $derived(
    selectedLine
      ? zones
          .filter((z) => z.lineId === selectedLine.id && z.geometry.rect)
          .map((z) => ({ id: z.id, rect: z.geometry.rect as Rect }))
      : [],
  );

  function divideSelectedLine() {
    if (!selectedLine || !lineRect) return;
    const words = wordsText
      .split(/\s+/)
      .filter(Boolean)
      .map((text) => ({ text }));
    const rects = divideLine(lineRect, words, direction);
    const lineId = selectedLine.id;
    zones = [
      ...zones.filter((z) => z.lineId !== lineId),
      ...rects.map((rect, i) => ({
        id: nextId('word'),
        geometry: { rect },
        tokenIds: [],
        kind: 'word' as const,
        lineId,
        text: words[i].text,
      })),
    ];
  }

  function boundaryMoved(wordId: string, neighbourId: string, x: number) {
    const a = zones.find((z) => z.id === wordId);
    const b = zones.find((z) => z.id === neighbourId);
    if (!a?.geometry.rect || !b?.geometry.rect) return;
    const [ra, rb] = applyBoundary(a.geometry.rect, b.geometry.rect, x, direction);
    zones = zones.map((z) =>
      z.id === wordId ? { ...z, geometry: { rect: ra } } : z.id === neighbourId ? { ...z, geometry: { rect: rb } } : z,
    );
  }

  /** Runs the projection profile on a downscaled copy of the sample, inside the selected zone if there is one. */
  async function detect() {
    if (source.kind !== 'image') {
      status = 'Line detection on this page reads the sample image only.';
      return;
    }
    status = 'Reading the image...';
    const img = new Image();
    img.src = source.url;
    await img.decode();
    const width = 800;
    const height = Math.round((img.naturalHeight / img.naturalWidth) * width);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height);
    const region = selectedZone ? (rectOf(selectedZone.geometry) ?? undefined) : undefined;
    const started = performance.now();
    const lines = detectLines(data, { region, threshold });
    const ms = Math.round(performance.now() - started);
    zones = [
      ...zones.filter((z) => z.kind !== 'line' || zones.some((w) => w.lineId === z.id)),
      ...lines.map((rect) => ({ id: nextId('line'), geometry: { rect }, tokenIds: [], kind: 'line' as const })),
    ];
    status = `${lines.length} lines found${region ? ' inside the selected zone' : ' on the whole image'} in ${ms} ms`;
  }

  function loadSource() {
    const url = sourceInput.trim();
    if (!url) {
      source = SAMPLE;
      return;
    }
    source = url.endsWith('.dzi') ? { kind: 'dzi', url } : { kind: 'iiif', infoUrl: url };
    zones = [];
    selected = null;
  }
</script>

<svelte:head>
  <title>Facsimile dev</title>
</svelte:head>

<div class="dev">
  <div class="viewer">
    <FacsimileViewer
      {source}
      {zones}
      highlighted={hoveredOnImage ? [...highlighted, hoveredOnImage] : highlighted}
      {selected}
      {mode}
      {editable}
      onzonecreate={zoneCreated}
      onzonechange={zoneChanged}
      onzoneselect={(id) => (selected = id)}
      onzonehover={(id) => (hoveredOnImage = id)}
      onviewready={(ready) => (api = ready)}
    >
      {#snippet children(view)}
        {#if lineRect && lineWords.length > 1}
          <WordDividers api={view} line={lineRect} words={lineWords} {direction} onchange={boundaryMoved} />
        {/if}
      {/snippet}
    </FacsimileViewer>
  </div>

  <aside class="panel">
    <h1>Facsimile</h1>

    <section>
      <h2>Source</h2>
      <label>
        DZI or IIIF info.json URL
        <input type="text" bind:value={sourceInput} placeholder="/media/tiles/<pageId>/image.dzi" />
      </label>
      <div class="row">
        <button type="button" onclick={loadSource}>Load</button>
        <button type="button" onclick={() => { sourceInput = ''; source = SAMPLE; }}>Sample</button>
      </div>
      <p class="muted">{source.kind}: {source.kind === 'iiif' ? source.infoUrl : source.url}</p>
    </section>

    <section>
      <h2>Mode</h2>
      <div class="row" role="group" aria-label="Mode">
        {#each ['pan', 'rect', 'polygon'] as m (m)}
          <button type="button" class:active={mode === m} onclick={() => (mode = m as FacsimileMode)}>{m}</button>
        {/each}
      </div>
      <div class="row">
        <label><input type="checkbox" bind:checked={editable} /> editable</label>
        <label>
          new zones are
          <select bind:value={newKind}>
            <option value="feature">features (a text area to detect in)</option>
            <option value="line">lines</option>
            <option value="word">words</option>
          </select>
        </label>
      </div>
    </section>

    <section>
      <h2>Lines</h2>
      <div class="row">
        <button type="button" onclick={detect}>Detect lines{selectedZone ? ' in the selected zone' : ''}</button>
        <label>threshold <input type="number" step="0.01" min="0.5" max="2" bind:value={threshold} /></label>
      </div>
      <p class="muted">Draw a rectangle around the text and select it first; the whole plate is mostly white page.</p>
      {#if status}<p>{status}</p>{/if}
    </section>

    <section>
      <h2>Words</h2>
      <label>
        words of the selected line
        <textarea rows="2" bind:value={wordsText}></textarea>
      </label>
      <div class="row">
        <label>
          <select bind:value={direction}>
            <option value="ltr">left to right</option>
            <option value="rtl">right to left</option>
          </select>
        </label>
        <button type="button" disabled={!selectedLine} onclick={divideSelectedLine}>Divide line</button>
      </div>
      {#if lineWords.length > 1}
        <p class="muted">Drag the dividers on the image, or focus one and use the arrow keys.</p>
      {/if}
    </section>

    <section>
      <h2>Zones ({zones.length})</h2>
      <div class="row">
        <button type="button" onclick={clear} disabled={zones.length === 0}>Clear</button>
      </div>
      <ul class="zones">
        {#each zones as zone (zone.id)}
          <li
            class:selected={zone.id === selected}
            class:hovered={zone.id === hoveredOnImage}
            onmouseenter={() => (highlighted = [zone.id])}
            onmouseleave={() => (highlighted = [])}
          >
            <button
              type="button"
              class="link"
              onclick={() => {
                selected = zone.id;
                api?.fitTo(zone.id);
              }}
            >
              <strong>{zone.id}</strong>
              <span class="kind">{zone.kind}</span>
              {#if zone.text}<span class="text">{zone.text}</span>{/if}
              <span class="geom">{describe(zone.geometry)}</span>
            </button>
            <button type="button" class="small" aria-label="Remove {zone.id}" onclick={() => remove(zone.id)}>x</button>
          </li>
        {/each}
      </ul>
    </section>
  </aside>
</div>

<style>
  .dev {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 22rem;
    /* The shell's header takes the rest of the viewport. */
    height: calc(100dvh - 4rem);
    font-family: var(--font-sans, system-ui, sans-serif);
    font-size: 0.875rem;
  }

  .viewer {
    min-height: 0;
    height: 100%;
  }

  .panel {
    overflow: auto;
    padding: 0.75rem 1rem;
    border-left: 1px solid var(--color-border, #e4e4e7);
    background: var(--color-surface, #ffffff);
    color: var(--color-ink, #18181b);
  }

  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.125rem;
  }

  h2 {
    margin: 1rem 0 0.25rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted, #71717a);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin: 0.25rem 0;
  }

  label {
    display: block;
  }

  input[type='text'],
  textarea {
    width: 100%;
    font: inherit;
    font-family: var(--font-serif, Georgia, serif);
    padding: 0.25rem 0.375rem;
    border: 1px solid var(--color-border, #d4d4d8);
    border-radius: 0.25rem;
  }

  input[type='number'] {
    width: 4.5rem;
  }

  button {
    font: inherit;
    padding: 0.25rem 0.625rem;
    border: 1px solid var(--color-border, #d4d4d8);
    border-radius: 0.375rem;
    background: var(--color-surface, #ffffff);
    cursor: pointer;
  }

  button.active {
    background: var(--color-accent, #2563eb);
    border-color: var(--color-accent, #2563eb);
    color: #ffffff;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .muted {
    color: var(--color-muted, #71717a);
    margin: 0.25rem 0;
  }

  .zones {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .zones li {
    display: flex;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 0.25rem 0.375rem;
    border-radius: 0.25rem;
  }

  .zones li:hover,
  .zones li.hovered {
    background: var(--color-surface-hover, #f4f4f5);
  }

  .zones li.selected {
    outline: 1px solid var(--color-accent, #2563eb);
  }

  .zones .link {
    flex: 1;
    display: grid;
    gap: 0.125rem;
    text-align: left;
    padding: 0;
    border: 0;
    background: none;
  }

  .zones .kind {
    color: var(--color-muted, #71717a);
  }

  .zones .text {
    font-family: var(--font-serif, Georgia, serif);
  }

  .zones .geom {
    font-variant-numeric: tabular-nums;
    color: var(--color-muted, #71717a);
  }

  .zones .small {
    padding: 0 0.375rem;
    line-height: 1.4;
  }
</style>
