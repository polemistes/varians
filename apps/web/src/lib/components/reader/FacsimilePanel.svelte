<script lang="ts">
  /**
   * The facsimile beside the text: the page of the chosen witness that holds
   * the first lit word (the open entry's reading in that witness, else the
   * first word of the witness on screen), found through the zones API, with
   * the zones of the lit words lit. A plain notice where there is no image.
   */
  import X from '@lucide/svelte/icons/x';
  import type { ZoneGeometry } from '@varians/core';
  import { Select, Spinner } from '$lib/components/ui';
  import type { FacsimileApi, FacsimileSource, FacsimileZone } from '$lib/facsimile/types';
  import type { ReaderSiglum } from '$lib/reader/types';
  import { reader as r } from '$lib/strings/reader';
  import type { WitnessTexts } from './witness-texts.svelte';

  interface Props {
    sigla: ReaderSiglum[];
    siglum: string | null;
    texts: WitnessTexts;
    /** Segments on screen, in order: their words are loaded to find a page when nothing is lit. */
    segmentIds: string[];
    /** Witness tokens lit by the open entry. */
    lit: string[];
    onselect: (siglum: string) => void;
    onclose: () => void;
  }

  let { sigla, siglum, texts, segmentIds, lit, onselect, onclose }: Props = $props();

  const current = $derived(sigla.find((x) => x.siglum === siglum) ?? null);
  const transcriptionId = $derived(current?.transcriptionId ?? null);

  type ZoneRow = { id: string; pageId: string; geometry: ZoneGeometry; tokenIds: string[]; feature: unknown };
  type PageRow = { id: string; label: string; width: number | null; height: number | null; source: FacsimileSource | null };
  type State =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'none' }
    | { kind: 'failed' }
    | { kind: 'no-image'; label: string | null }
    | { kind: 'image'; pageId: string; label: string; source: FacsimileSource; zones: FacsimileZone[] };

  let view = $state<State>({ kind: 'idle' });
  /** The page shown, so that moving within one page fetches nothing. */
  let shownFor = '';

  // The words on screen in this witness, so that a page can be found before anything is lit.
  $effect(() => {
    if (transcriptionId && segmentIds.length) void texts.load(transcriptionId, segmentIds.slice(0, 3));
  });

  const target = $derived.by(() => {
    if (!transcriptionId) return null;
    if (lit.length) return lit[0]!;
    for (const id of segmentIds) {
      const first = texts.firstToken(transcriptionId, id);
      if (first) return first;
    }
    return null;
  });

  async function json<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(response.statusText);
    return (await response.json()) as T;
  }

  $effect(() => {
    const tid = transcriptionId;
    const token = target;
    if (!tid || !token) {
      view = { kind: tid ? 'idle' : 'none' };
      shownFor = '';
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const base = `/api/transcriptions/${encodeURIComponent(tid)}/zones`;
        const byToken = await json<{ zones: ZoneRow[]; pages: PageRow[] }>(`${base}?tokens=${encodeURIComponent(token)}`);
        const pageId = byToken.zones[0]?.pageId ?? texts.pageOf(tid, token);
        if (cancelled) return;
        if (!pageId) {
          view = { kind: 'none' };
          shownFor = '';
          return;
        }
        const key = `${tid}|${pageId}`;
        if (key === shownFor && view.kind === 'image') return;
        if (view.kind !== 'image') view = { kind: 'loading' };
        const page = await json<{ zones: ZoneRow[]; pages: PageRow[] }>(`${base}?page=${encodeURIComponent(pageId)}`);
        if (cancelled) return;
        const row = page.pages.find((p) => p.id === pageId);
        shownFor = key;
        if (!row || !row.source) {
          view = { kind: 'no-image', label: row?.label ?? null };
          return;
        }
        view = {
          kind: 'image',
          pageId,
          label: row.label,
          source: row.source,
          zones: page.zones.map((z) => ({
            id: z.id,
            geometry: z.geometry,
            tokenIds: z.tokenIds,
            kind: z.feature ? 'feature' : z.tokenIds.length > 1 ? 'line' : 'word',
          })),
        };
      } catch {
        if (!cancelled) view = { kind: 'failed' };
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const litSet = $derived(new Set(lit));
  const litZones = $derived(view.kind === 'image' ? view.zones.filter((z) => z.tokenIds.some((id) => litSet.has(id))).map((z) => z.id) : []);

  // OpenSeadragon needs the window: the viewer is loaded in the browser, when the panel first shows an image.
  let Viewer = $state<typeof import('$lib/components/facsimile/FacsimileViewer.svelte').default | null>(null);
  $effect(() => {
    if (view.kind === 'image' && !Viewer) {
      void import('$lib/components/facsimile/FacsimileViewer.svelte').then((m) => {
        Viewer = m.default;
      });
    }
  });

  let api = $state.raw<FacsimileApi | null>(null);
  $effect(() => {
    const zone = litZones[0];
    if (api && zone) api.fitTo(zone);
  });
</script>

<section class="panel" aria-labelledby="facsimile-panel-title">
  <header class="panel-header">
    <h2 id="facsimile-panel-title" class="panel-title">{r.panels.facsimile}</h2>
    {#if sigla.length}
      <Select
        value={siglum ?? undefined}
        onchange={(event) => onselect((event.currentTarget as HTMLSelectElement).value)}
        aria-label={r.panels.chooseWitness}
        class="ml-2 w-36"
        options={sigla.map((x) => ({ value: x.siglum, label: `${x.siglum}  ${x.witnessName}` }))}
      />
    {/if}
    <button type="button" class="panel-close" aria-label={r.panels.close(r.toolbar.facsimile)} title={r.panels.close(r.toolbar.facsimile)} onclick={onclose}>
      <X class="size-4" aria-hidden="true" />
    </button>
  </header>

  <div class="stage">
    {#if !transcriptionId}
      <p class="notice">{r.panels.noTranscription}</p>
    {:else if view.kind === 'loading' || (view.kind === 'idle' && texts.loading > 0)}
      <div class="grid h-40 place-items-center"><Spinner label={r.panels.facsimileLoading} class="text-ink-muted" /></div>
    {:else if view.kind === 'idle'}
      <p class="notice">{r.panels.facsimileHint}</p>
    {:else if view.kind === 'none'}
      <p class="notice">{r.panels.noImage}</p>
    {:else if view.kind === 'failed'}
      <p class="notice">{r.panels.facsimileFailed}</p>
    {:else if view.kind === 'no-image'}
      <p class="notice">{view.label ? r.panels.noImageOfPage(view.label) : r.panels.noImage}</p>
    {:else if view.kind === 'image'}
      <div class="viewer">
        {#if Viewer}
          <Viewer
            source={view.source}
            zones={view.zones}
            highlighted={litZones}
            mode="pan"
            editable={false}
            labels={r.panels.viewer}
            class="h-full"
            onviewready={(ready) => {
              api = ready;
              if (litZones[0]) ready.fitTo(litZones[0]);
            }}
          />
        {:else}
          <div class="grid h-full place-items-center"><Spinner label={r.panels.facsimileLoading} class="text-ink-muted" /></div>
        {/if}
        <span class="page-label">{r.panels.page(view.label)}</span>
      </div>
    {/if}
  </div>
</section>

<style>
  .panel {
    border: 1px solid var(--color-line);
    border-radius: 0.5rem;
    background: var(--color-surface);
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem 0.5rem 1rem;
  }

  .panel-title {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
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

  .notice {
    padding: 0.25rem 1rem 1rem;
    font-size: 0.875rem;
    color: var(--color-ink-muted);
  }

  .viewer {
    position: relative;
    height: min(32rem, 55dvh);
    border-top: 1px solid var(--color-line);
  }

  .page-label {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--color-surface) 85%, transparent);
    padding: 0.1rem 0.4rem;
    font-size: 0.75rem;
    color: var(--color-ink-soft);
  }
</style>
