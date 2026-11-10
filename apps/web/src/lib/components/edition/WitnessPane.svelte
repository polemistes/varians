<script lang="ts">
  /**
   * The witness pane of the edition editor: one witness's text, or its
   * facsimile, for the segments on screen, with the words of the current
   * site lit. Clicking a word adopts that witness at the site covering it.
   * The image is the page the words stand on, mapped to it or not.
   */
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { Item, ZoneGeometry } from '@varians/core';
  import ImageCredit from '$lib/components/facsimile/ImageCredit.svelte';
  import { IconButton, Select, Spinner, Tabs, type Tab } from '$lib/components/ui';
  import type { FacsimileSource, FacsimileZone } from '$lib/facsimile/types';
  import type { SiglumClient, WitnessSegment } from '$lib/edition/types';
  import { editor as s } from '$lib/strings/editor';

  interface Props {
    sigla: SiglumClient[];
    /** Segment ids on screen, in order. */
    segmentIds: string[];
    labelOf: Record<string, string>;
    /** Witness token ids to light: the current site's reading of the chosen witness. */
    highlightTokenIds: string[];
    selected?: string | null;
    mode?: 'text' | 'image';
    onpick?: (segmentId: string, tokenId: string) => void;
    onhover?: (tokenId: string | null) => void;
  }

  let {
    sigla,
    segmentIds,
    labelOf,
    highlightTokenIds,
    selected = $bindable(null),
    mode = $bindable('text'),
    onpick,
    onhover,
  }: Props = $props();

  const current = $derived(sigla.find((x) => x.siglum === selected) ?? sigla[0] ?? null);
  $effect(() => {
    if (!selected && sigla.length) selected = sigla[0]!.siglum;
  });

  const tabs: Tab[] = [
    { value: 'text', label: s.witness.text },
    { value: 'image', label: s.witness.image },
  ];

  let form = $state<'read' | 'written'>('read');
  let keepsWrittenForm = $state(false);
  let loading = $state(false);
  let segments = $state<Record<string, WitnessSegment>>({});
  let loadedFor = $state('');

  // Fetch the segments of the chosen transcription when the witness or the window changes.
  $effect(() => {
    const transcriptionId = current?.transcriptionId;
    const ids = segmentIds.join(',');
    if (!transcriptionId || !ids) {
      segments = {};
      return;
    }
    const key = `${transcriptionId}|${ids}`;
    if (key === loadedFor) return;
    loading = true;
    fetch(`/api/transcriptions/${transcriptionId}/segments?ids=${encodeURIComponent(ids)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: { segments: Record<string, WitnessSegment>; keepsWrittenForm: boolean }) => {
        segments = data.segments;
        keepsWrittenForm = data.keepsWrittenForm;
        loadedFor = key;
      })
      .catch(() => {
        segments = {};
      })
      .finally(() => {
        loading = false;
      });
  });

  const lit = $derived(new Set(highlightTokenIds));

  // Facsimile: the page the words stand on, mapped or not: the page of the run holding the
  // first lit word, else of the first run on screen. The arrows browse the witness's pages; a new site
  // returns the pane to following the words.
  type Shown =
    | { kind: 'none' }
    | { kind: 'unplaced' }
    | { kind: 'no-image'; pageId: string; label: string }
    | {
        kind: 'image';
        pageId: string;
        label: string;
        source: FacsimileSource;
        zones: FacsimileZone[];
        rights: string | null;
        attribution: string | null;
      };
  let image = $state<Shown>({ kind: 'none' });
  let imageLoading = $state(false);
  let imageFor = $state('');
  /** A page chosen with the arrows, until the words move on. */
  let browsed = $state<string | null>(null);
  let witnessPages = $state<{ id: string; label: string }[]>([]);
  let pagesFor = '';

  $effect(() => {
    void highlightTokenIds.join(',');
    browsed = null;
  });

  // The witness's pages, for the arrows.
  $effect(() => {
    const witnessId = current?.witnessId;
    if (mode !== 'image' || !witnessId || witnessId === pagesFor) return;
    pagesFor = witnessId;
    fetch(`/api/witnesses/${encodeURIComponent(witnessId)}/pages`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: { pages: { id: string; label: string }[] }) => {
        witnessPages = data.pages.map((p) => ({ id: p.id, label: p.label }));
      })
      .catch(() => {
        witnessPages = [];
      });
  });

  /** The page the words stand on: undefined when no word of the witness is on screen, null when they are on no page. */
  const followed = $derived.by((): string | null | undefined => {
    const runs = segmentIds.flatMap((id) => segments[id]?.runs ?? []);
    for (const token of highlightTokenIds) {
      const run = runs.find((r) => r.items.some((i) => i.id === token));
      if (run) return pageWithin(run, token);
    }
    const first = runs.find((r) => r.items.some((i) => i.kind === 'token'));
    return first ? first.pageId : undefined;
  });

  /** The page a word stands on within a run: the run's page, or a page break inside the run before it. */
  function pageWithin(run: WitnessSegment['runs'][number], token: string): string | null {
    let page = run.pageId;
    for (const item of run.items) {
      if (item.kind === 'break' && item.type === 'page') page = item.pageId ?? page;
      if (item.id === token) break;
    }
    return page;
  }

  const shownPage = $derived(browsed ?? followed);

  $effect(() => {
    if (mode !== 'image' || !current?.transcriptionId) return;
    const transcriptionId = current.transcriptionId;
    const pageId = shownPage;
    if (pageId === undefined) {
      image = { kind: 'none' };
      imageFor = '';
      return;
    }
    if (pageId === null) {
      image = { kind: 'unplaced' };
      imageFor = '';
      return;
    }
    const key = `${transcriptionId}|${pageId}`;
    if (key === imageFor) return;
    imageLoading = true;
    fetch(`/api/transcriptions/${transcriptionId}/zones?page=${encodeURIComponent(pageId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then(
        (data: {
          zones: { id: string; geometry: ZoneGeometry; tokenIds: string[]; feature: unknown }[];
          pages: {
            id: string;
            label: string;
            source: FacsimileSource | null;
            rights?: string | null;
            attribution?: string | null;
          }[];
        }) => {
          const page = data.pages.find((p) => p.id === pageId);
          imageFor = key;
          if (!page) {
            image = { kind: 'none' };
            return;
          }
          if (!page.source) {
            image = { kind: 'no-image', pageId, label: page.label };
            return;
          }
          image = {
            kind: 'image',
            pageId,
            source: page.source,
            label: page.label,
            rights: page.rights ?? null,
            attribution: page.attribution ?? null,
            zones: data.zones.map((z) => ({
              id: z.id,
              geometry: z.geometry,
              tokenIds: z.tokenIds,
              kind: z.feature ? 'feature' : z.tokenIds.length > 1 ? 'line' : 'word',
            })),
          };
        },
      )
      .catch(() => {
        image = { kind: 'none' };
      })
      .finally(() => {
        imageLoading = false;
      });
  });

  /** The witness's pages before and after the one shown (from Not on a page, the first). */
  const step = $derived.by(() => {
    const at = shownPage ? witnessPages.findIndex((p) => p.id === shownPage) : -1;
    return {
      previous: at > 0 ? witnessPages[at - 1]!.id : null,
      next: at + 1 < witnessPages.length ? witnessPages[at + 1]!.id : null,
    };
  });

  const litZoneIds = $derived(
    image.kind === 'image'
      ? image.zones.filter((z) => z.tokenIds.some((id) => lit.has(id))).map((z) => z.id)
      : [],
  );

  function shown(item: Item): string {
    if (item.kind === 'token') return form === 'read' ? (item.norm ?? item.form) : item.form;
    if (item.kind === 'object') return item.type === 'gap' ? '[…]' : (item.text ?? '');
    return '';
  }

  let FacsimileViewer = $state<
    typeof import('$lib/components/facsimile/FacsimileViewer.svelte').default | null
  >(null);
  $effect(() => {
    if (mode === 'image' && !FacsimileViewer) {
      import('$lib/components/facsimile/FacsimileViewer.svelte').then((m) => {
        FacsimileViewer = m.default;
      });
    }
  });
</script>

<div class="witness-pane flex h-full flex-col font-sans text-sm">
  <div class="flex items-center gap-2 border-b border-line px-3 py-2">
    <Select
      value={selected ?? undefined}
      onchange={(event) => (selected = (event.currentTarget as HTMLSelectElement).value)}
      aria-label={s.witness.choose}
      class="w-44"
      options={sigla.map((x) => ({ value: x.siglum, label: `${x.siglum}  ${x.witnessName}` }))}
    />
    <Tabs {tabs} bind:value={mode} label={s.witness.title} />
    {#if mode === 'text' && keepsWrittenForm}
      <div
        class="ml-auto flex rounded-md border border-line bg-sunken p-0.5 text-xs"
        role="group"
        aria-label={s.witness.form}
      >
        {#each [{ value: 'read', label: s.witness.read }, { value: 'written', label: s.witness.written }] as option (option.value)}
          <button
            type="button"
            class={[
              'rounded px-1.5 py-0.5',
              form === option.value
                ? 'bg-surface text-ink shadow-sm'
                : 'text-ink-soft hover:text-ink',
            ]}
            aria-pressed={form === option.value}
            onclick={() => (form = option.value as 'read' | 'written')}>{option.label}</button
          >
        {/each}
      </div>
    {/if}
  </div>

  {#if !current?.transcriptionId}
    <p class="px-3 py-4 text-ink-muted">{s.witness.noTranscription}</p>
  {:else if mode === 'text'}
    <div
      class="flex-1 overflow-y-auto px-3 py-2 font-serif text-reading leading-relaxed text-ink"
      dir="auto"
    >
      {#if loading && Object.keys(segments).length === 0}
        <Spinner />
      {/if}
      {#each segmentIds as segmentId (segmentId)}
        {@const segment = segments[segmentId]}
        <div class="flex gap-3 py-1">
          <span class="w-12 shrink-0 pt-1 font-sans text-xs text-ink-soft"
            >{labelOf[segmentId] ?? ''}</span
          >
          <div class="min-w-0 flex-1">
            {#if !segment || segment.runs.length === 0}
              <span class="font-sans text-xs text-ink-muted">—</span>
            {:else}
              {#each segment.runs as run, r (r)}
                {#if r > 0}<span class="font-sans text-xs text-ink-muted"> … </span>{/if}
                {#each run.items as item (item.id)}
                  {#if item.kind === 'token'}
                    <button
                      type="button"
                      class={[
                        'rounded px-0.5 hover:bg-sunken',
                        lit.has(item.id) && 'bg-accent-soft text-ink',
                      ]}
                      title={s.witness.pick}
                      onclick={() => onpick?.(segmentId, item.id)}
                      onmouseenter={() => onhover?.(item.id)}
                      onmouseleave={() => onhover?.(null)}>{shown(item)}</button
                    >{' '}
                  {:else if item.kind === 'object'}
                    <span class="text-ink-muted">{shown(item)}</span>{' '}
                  {/if}
                {/each}
              {/each}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="relative flex-1">
      {#if imageLoading}
        <div class="absolute inset-0 grid place-items-center"><Spinner /></div>
      {:else if image.kind === 'unplaced'}
        <p class="px-3 py-4 text-ink-muted">{s.witness.unplaced}</p>
      {:else if image.kind === 'no-image'}
        <p class="px-3 py-4 text-ink-muted">{s.witness.noImageOf(image.label)}</p>
      {:else if image.kind === 'none'}
        <p class="px-3 py-4 text-ink-muted">{s.witness.noImage}</p>
      {:else if FacsimileViewer}
        <FacsimileViewer
          source={image.source}
          zones={image.zones}
          highlighted={litZoneIds}
          mode="pan"
          editable={false}
          class="h-full"
        />
        <span
          class="absolute top-2 right-2 rounded bg-surface/80 px-1.5 py-0.5 text-xs text-ink-soft"
          >{image.label}</span
        >
      {:else}
        <div class="absolute inset-0 grid place-items-center"><Spinner /></div>
      {/if}
      {#if witnessPages.length > 1}
        <div class="absolute bottom-2 left-2 flex gap-1">
          <IconButton
            label={s.witness.previousPage}
            size="sm"
            class="bg-surface/90"
            disabled={step.previous === null}
            onclick={() => (browsed = step.previous)}
          >
            <ChevronLeft aria-hidden="true" />
          </IconButton>
          <IconButton
            label={s.witness.nextPage}
            size="sm"
            class="bg-surface/90"
            disabled={step.next === null}
            onclick={() => (browsed = step.next)}
          >
            <ChevronRight aria-hidden="true" />
          </IconButton>
        </div>
      {/if}
    </div>
    {#if image.kind === 'image' && !imageLoading}
      <ImageCredit
        rights={image.rights}
        attribution={image.attribution}
        class="shrink-0 truncate border-t border-line px-3 py-1"
      />
    {/if}
  {/if}
</div>
