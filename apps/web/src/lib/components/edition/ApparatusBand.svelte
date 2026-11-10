<script lang="ts">
  /**
   * The apparatus at the foot of the edition editor: for the segments on
   * screen, each variant as the reader's window lists it (the edition's
   * words, the witnesses that are there, a row for each reading), with what
   * an editor does to it: the reading of a row is the button that adopts it,
   * and the variant has its kind, minor, a conjecture and keeping the text.
   * A siglum shows the witness beside the text.
   */
  import type { Site } from '@varians/core';
  import { Button } from '$lib/components/ui';
  import PlaceWords from '$lib/components/variant/PlaceWords.svelte';
  import VariantRows from '$lib/components/variant/VariantRows.svelte';
  import VariantThere from '$lib/components/variant/VariantThere.svelte';
  import { keyOfSite, needsReview, type SegmentForAdoption } from '$lib/edition/adopt-client';
  import type { ActiveSite, SegmentViewClient } from '$lib/edition/types';
  import { siteKey } from '$lib/reader/sites';
  import {
    variantsOf,
    whereText,
    type RowOrigin,
    type Variant,
    type VariantContext,
  } from '$lib/reader/variant';
  import { editor as s } from '$lib/strings/editor';

  /** What adopting a row takes: a witness's reading, a reported reading or a conjecture. */
  export type Choice = RowOrigin;

  interface Props {
    segments: SegmentViewClient[];
    active: ActiveSite | null;
    /** Reviewed site keys by segment id. */
    reviewed: Record<string, string[]>;
    canEdit: boolean;
    /** What a variant reads: the conspectus, the edition's groups and words, the labels of the segments and where witnesses order lines otherwise. */
    context: VariantContext;
    /** The language of the work, for the quoted words. */
    lang: string;
    /** Segments whose last edit is still being saved and collated: shown dimmed, their buttons disabled. */
    busy?: string[];
    onadopt?: (segmentId: string, site: Site, choice: Choice) => void;
    onkeep?: (segmentId: string, site: Site, reviewed: boolean) => void;
    /** Call the site textual or interpretative, the other of what it is. */
    onkind?: (segmentId: string, site: Site) => void;
    /** Judge the variant minor, or not. */
    onminor?: (segmentId: string, site: Site) => void;
    onregister?: (segmentId: string, site: Site) => void;
    /** Bring the text to a variant: to its words, or, for a variant over whole lines (no site), to the first of them. */
    onfocus?: (segmentId: string, site: Site | null) => void;
    /** A siglum was activated: the siglum of the conspectus. */
    onwitness?: (siglum: string) => void;
    onnote?: (segmentId: string) => void;
    ondeletenote?: (segmentId: string, noteId: string) => void;
    /** Take a witness's current reading for words taken from it that it now reads otherwise. */
    ontakecurrent?: (segmentId: string, drift: Drift[]) => void;
  }

  type Drift = NonNullable<SegmentViewClient['drift']>[number];

  let {
    segments,
    active,
    reviewed,
    canEdit,
    context,
    lang,
    busy = [],
    onadopt,
    onkeep,
    onkind,
    onminor,
    onregister,
    onfocus,
    onwitness,
    onnote,
    ondeletenote,
    ontakecurrent,
  }: Props = $props();

  function formOf(segment: SegmentViewClient, tokenId: string): string {
    return segment.baseUnits.find((u) => u.tokenIds.includes(tokenId))?.text ?? '';
  }

  /** Drift with a reading to take, by siglum, for the "take all" button. */
  function takeable(segment: SegmentViewClient): Map<string, Drift[]> {
    const out = new Map<string, Drift[]>();
    for (const d of segment.drift ?? [])
      if (d.now) out.set(d.siglum, [...(out.get(d.siglum) ?? []), d]);
    return out;
  }

  const busySet = $derived(new Set(busy));

  const reviewedSets = $derived(
    new Map(Object.entries(reviewed).map(([id, keys]) => [id, new Set(keys)] as const)),
  );

  function isActive(segmentId: string, site: Site): boolean {
    return active?.segmentId === segmentId && active.siteIndex === site.index;
  }

  /** The sites listed: those where a witness differs or something is attached, and the active one. */
  function shows(segment: SegmentViewClient, site: Site): boolean {
    if (isActive(segment.segmentId, site)) return true;
    if ((segment.attachments[site.index] ?? []).length) return true;
    return site.readings.some((r) => !r.base);
  }

  const lists = $derived.by(() => {
    const shown = new Set<string>();
    const byId: Record<string, SegmentViewClient> = {};
    for (const segment of segments) {
      byId[segment.segmentId] = segment;
      for (const site of segment.collation.sites)
        if (shows(segment, site)) shown.add(siteKey(segment.segmentId, site.index));
    }
    const groups = variantsOf(
      segments.map((segment) => segment.segmentId),
      byId,
      shown,
      context,
    );
    // The collation's order, in which a variant lying within another stands before it (so that the
    // first found for a word is the narrowest); a variant over the order of lines stands last.
    for (const group of groups) {
      const sites = byId[group.segmentId]?.collation.sites ?? [];
      const at = new Map(sites.map((site, k) => [site.index, k] as const));
      const rank = (place: Variant) =>
        place.siteIndex < 0 ? sites.length : (at.get(place.siteIndex) ?? 0);
      group.places.sort((a, b) => rank(a) - rank(b));
    }
    return new Map(groups.map((group) => [group.segmentId, group] as const));
  });

  function siteOf(segment: SegmentViewClient, variant: Variant): Site | null {
    return segment.collation.sites.find((site) => site.index === variant.siteIndex) ?? null;
  }

  function forAdoption(segment: SegmentViewClient): SegmentForAdoption {
    return {
      segmentId: segment.segmentId,
      collation: segment.collation,
      baseUnits: segment.baseUnits,
      attachments: segment.attachments,
      ...(segment.unprinted ? { unprinted: segment.unprinted } : {}),
    };
  }

  function isReviewed(segment: SegmentViewClient, site: Site): boolean {
    return reviewedSets.get(segment.segmentId)?.has(keyOfSite(forAdoption(segment), site)) ?? false;
  }

  function pending(segment: SegmentViewClient, site: Site): boolean {
    return needsReview(
      forAdoption(segment),
      site,
      reviewedSets.get(segment.segmentId) ?? new Set(),
    );
  }

  // Keep the active variant in view when the active one changes.
  let band = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!active || !band) return;
    band.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
</script>

<div
  bind:this={band}
  class="apparatus-band h-full overflow-y-auto font-sans text-sm"
  role="region"
  aria-label={s.apparatus}
>
  {#if segments.length === 0}
    <p class="px-4 py-3 text-ink-muted">{s.noSegments}</p>
  {:else}
    {#each segments as segment (segment.segmentId)}
      {@const list = lists.get(segment.segmentId)}
      {@const places = list?.places ?? []}
      {@const isBusy = busySet.has(segment.segmentId)}
      <section
        class={[
          'border-b border-line px-4 py-2 last:border-b-0',
          isBusy && 'pointer-events-none opacity-60',
        ]}
        aria-busy={isBusy}
        data-segment={segment.segmentId}
        data-unprinted={segment.unprinted ? '' : undefined}
      >
        <div class="flex items-baseline gap-3">
          <h3 class="w-14 shrink-0 font-sans text-xs font-semibold text-ink-soft">
            {segment.label}
          </h3>
          {#if places.length === 0}
            <p class="text-ink-muted">{s.noSites}</p>
          {/if}
          <span class="ml-auto flex items-baseline gap-3">
            {#if isBusy}<span class="text-xs text-ink-muted">{s.saving}</span>{/if}
            {#if segment.absent.length}
              <span class="text-xs text-ink-muted">{s.absent(segment.absent.join(' '))}</span>
            {/if}
            {#if canEdit}
              <button
                type="button"
                class="text-xs text-ink-soft hover:text-ink"
                onclick={() => onnote?.(segment.segmentId)}>{s.note}</button
              >
            {/if}
          </span>
        </div>
        {#each places as place (place.key)}
          {@const site = siteOf(segment, place)}
          {@const activeHere = site !== null && isActive(segment.segmentId, site)}
          {@const done = site !== null && isReviewed(segment, site)}
          <div
            class={[
              'entry mt-1.5 rounded-md py-1 pr-2 pl-5 sm:pl-14 text-[0.8125rem] leading-normal transition-colors',
              activeHere && 'bg-accent-soft',
              !activeHere && site && pending(segment, site) && 'border-l-2 border-warning',
              place.minor && 'border-l-2 border-dashed border-line-strong bg-sunken',
            ]}
            data-site={site ? site.index : undefined}
            data-order={site ? undefined : place.key}
            data-active={activeHere ? '' : undefined}
          >
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <button
                type="button"
                class="rounded text-left text-base text-ink hover:underline"
                onclick={() => onfocus?.(segment.segmentId, site)}
              >
                {#if whereText(place)}
                  <PlaceWords variant={place} {lang} kinds={!canEdit} />
                {:else}
                  {place.label}
                {/if}
              </button>
              <VariantThere variant={place} {onwitness} />
              {#if canEdit && site}
                <span class="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    class={[
                      'rounded px-1.5 py-0.5 text-xs hover:bg-sunken',
                      site.kindByEditor ? 'text-accent' : 'text-ink-muted',
                      site.kind === 'interpretative' && 'italic',
                    ]}
                    title={s.kindTitle(site.kind, site.kindByEditor ?? false)}
                    aria-label={s.kindTitle(site.kind, site.kindByEditor ?? false)}
                    onclick={() => onkind?.(segment.segmentId, site)}
                  >
                    {site.kind === 'interpretative'
                      ? s.interpretative
                      : s.textual}{site.kindByEditor ? '*' : ''}
                  </button>
                  <Button
                    size="sm"
                    class="h-6! px-2! text-xs!"
                    variant={site.minor ? 'secondary' : 'ghost'}
                    title={s.minorTitle}
                    aria-pressed={site.minor === true}
                    onclick={() => onminor?.(segment.segmentId, site)}>{s.minor}</Button
                  >
                  <Button
                    size="sm"
                    class="h-6! px-2! text-xs!"
                    variant="ghost"
                    onclick={() => onregister?.(segment.segmentId, site)}>{s.register}</Button
                  >
                  <Button
                    size="sm"
                    class="h-6! px-2! text-xs!"
                    variant={done ? 'ghost' : 'secondary'}
                    onclick={() => onkeep?.(segment.segmentId, site, !done)}
                    title={done ? s.unreview : s.keep}
                  >
                    {done ? s.kept : s.keep}
                  </Button>
                </span>
              {/if}
            </div>
            <div class="mt-1">
              <VariantRows
                rows={place.rows}
                {lang}
                {onwitness}
                onadopt={canEdit && site
                  ? (origin) => onadopt?.(segment.segmentId, site, origin)
                  : undefined}
                adoptTitle={s.adopt}
                adoptedLabel={s.adopted}
              />
            </div>
          </div>
        {/each}
        {#each segment.drift ?? [] as d (d.tokenId)}
          <div class="mt-1 flex flex-wrap items-baseline gap-2 pl-5 sm:pl-14 text-xs text-ink-soft">
            <span class="text-warning" aria-hidden="true">≈</span>
            <span>{s.drift(formOf(segment, d.tokenId), d.siglum, d.now)}</span>
            {#if canEdit && d.now}
              <Button
                size="sm"
                variant="ghost"
                onclick={() => ontakecurrent?.(segment.segmentId, [d])}
                >{s.takeCurrent(d.siglum)}</Button
              >
            {/if}
          </div>
        {/each}
        {#if canEdit}
          {#each [...takeable(segment)].filter(([, taken]) => taken.length > 1) as [siglum, taken] (siglum)}
            <div class="mt-1 pl-5 sm:pl-14">
              <Button
                size="sm"
                variant="secondary"
                onclick={() => ontakecurrent?.(segment.segmentId, taken)}
                >{s.takeAllCurrent(siglum, taken.length)}</Button
              >
            </div>
          {/each}
        {/if}
        {#each segment.notes as note (note.id)}
          <div class="mt-1 flex items-baseline gap-2 pl-5 sm:pl-14 text-xs text-ink-soft">
            <span class="font-serif text-sm text-ink">{note.text}</span>
            {#if note.cites?.length}<span class="text-ink-soft">({note.cites.join('; ')})</span
              >{/if}
            {#if note.author}<span class="text-ink-muted">{note.author}</span>{/if}
            {#if canEdit}
              <button
                type="button"
                class="ml-auto text-ink-muted hover:text-danger"
                onclick={() => ondeletenote?.(segment.segmentId, note.id)}>{s.removeNote}</button
              >
            {/if}
          </div>
        {/each}
        {#if list && list.unplaced.length}
          <div class="mt-1 pl-5 sm:pl-14 text-[0.8125rem] leading-normal text-ink-soft">
            <VariantRows rows={list.unplaced} {lang} {onwitness} />
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</div>
