<script lang="ts">
  /**
   * The apparatus at the foot of the edition editor: for the segments on
   * screen, each variant as the reader's window lists it (the edition's
   * words, the witnesses that are there, a row for each reading), with what
   * an editor does to it: the reading of a row is the button that adopts it,
   * and the variant has its kind, minor, a conjecture and keeping the text.
   * A siglum shows the witness beside the text. A variant stands in the
   * section of the segment its words begin in, whichever passage gave it.
   */
  import type { Site } from '@varians/core';
  import { Button } from '$lib/components/ui';
  import PlaceWords from '$lib/components/variant/PlaceWords.svelte';
  import VariantRows from '$lib/components/variant/VariantRows.svelte';
  import VariantThere from '$lib/components/variant/VariantThere.svelte';
  import { keyOfSite, needsReview, type SegmentForAdoption } from '$lib/edition/adopt-client';
  import type { ActiveSite, SegmentViewClient } from '$lib/edition/types';
  import { passageIndex } from '$lib/reader/passages';
  import { siteKey } from '$lib/reader/sites';
  import {
    variantsOf,
    whereText,
    type RowOrigin,
    type SegmentVariants,
    type Variant,
    type VariantContext,
  } from '$lib/reader/variant';
  import { editor as s } from '$lib/strings/editor';
  import { recordActions as ra } from '$lib/strings/record-actions';

  /** What adopting a row takes: a witness's reading, a reported reading or a conjecture. */
  export type Choice = RowOrigin;

  interface Props {
    /** The segments on screen, in the order of the text. */
    segmentIds: string[];
    /** The passages that hold them, by their first segment. */
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
    /** The site's passage, by its first segment, and the site. */
    onadopt?: (passageId: string, site: Site, choice: Choice) => void;
    onkeep?: (passageId: string, site: Site, reviewed: boolean) => void;
    /** Call the site textual or interpretative, the other of what it is. */
    onkind?: (passageId: string, site: Site) => void;
    /** Judge the variant minor, or not. */
    onminor?: (passageId: string, site: Site) => void;
    onregister?: (passageId: string, site: Site) => void;
    /** Bring the text to a variant: to its words (by its passage), or, for a variant over whole segments (no site), to the first of them (by its segment). */
    onfocus?: (id: string, site: Site | null) => void;
    /** A siglum was activated: the siglum of the conspectus. */
    onwitness?: (siglum: string) => void;
    /** A note on a segment. */
    onnote?: (segmentId: string) => void;
    ondeletenote?: (segmentId: string, noteId: string) => void;
    /** Take a witness's current reading for words taken from it that it now reads otherwise. */
    ontakecurrent?: (segmentId: string, drift: Drift[]) => void;
  }

  type Drift = NonNullable<SegmentViewClient['drift']>[number];

  let {
    segmentIds,
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

  const byId = $derived(Object.fromEntries(segments.map((p) => [p.segmentId, p] as const)));
  const passageOf = $derived(passageIndex(segments));

  function formOf(segment: SegmentViewClient, tokenId: string): string {
    return segment.baseUnits.find((u) => u.tokenIds.includes(tokenId))?.text ?? '';
  }

  /** The words of the passage that have drifted, of those that stand in one segment of it. */
  function driftIn(segment: SegmentViewClient, segmentId: string): Drift[] {
    const part = segment.segments.find((p) => p.segmentId === segmentId);
    if (!part) return [];
    const here = new Set(segment.baseUnits.slice(part.from, part.to).flatMap((u) => u.tokenIds));
    return (segment.drift ?? []).filter((d) => here.has(d.tokenId));
  }

  /** Drift with a reading to take, by siglum, for the "take all" button. */
  function takeable(drift: Drift[]): Map<string, Drift[]> {
    const out = new Map<string, Drift[]>();
    for (const d of drift) if (d.now) out.set(d.siglum, [...(out.get(d.siglum) ?? []), d]);
    return out;
  }

  const busySet = $derived(new Set(busy));

  const reviewedSets = $derived(
    new Map(Object.entries(reviewed).map(([id, keys]) => [id, new Set(keys)] as const)),
  );

  function isActive(passageId: string, site: Site): boolean {
    return active?.segmentId === passageId && active.siteIndex === site.index;
  }

  /** The sites listed: those where a witness differs or something is attached, and the active one. */
  function shows(segment: SegmentViewClient, site: Site): boolean {
    if (isActive(segment.segmentId, site)) return true;
    if ((segment.attachments[site.index] ?? []).length) return true;
    return site.readings.some((r) => !r.base);
  }

  /** The sections: each segment on screen, and after it the segments its passage holds that the edition does not print, with the variants that stand in each. */
  const sections = $derived.by(() => {
    const shown = new Set<string>();
    for (const segment of segments)
      for (const site of segment.collation.sites)
        if (shows(segment, site)) shown.add(siteKey(segment.segmentId, site.index));
    const groups = variantsOf(segmentIds, byId, shown, context);
    // The collation's order, in which a variant lying within another stands before it (so that the
    // first found for a word is the narrowest); a variant over the order of lines stands last.
    for (const group of groups) {
      const sites = (group.passage ? byId[group.passage]?.collation.sites : undefined) ?? [];
      const at = new Map(sites.map((site, k) => [site.index, k] as const));
      const rank = (place: Variant) =>
        place.siteIndex < 0 ? sites.length : (at.get(place.siteIndex) ?? 0);
      group.places.sort((a, b) => rank(a) - rank(b));
    }
    const listed = new Map(groups.map((g) => [g.segmentId, g] as const));
    // A variant is listed once, under the segment it begins in: the other segments its words lie in name it.
    const reaching = new Map<string, string[]>();
    for (const group of groups)
      for (const place of group.places) {
        if (place.siteIndex < 0) continue;
        for (const id of byId[place.segmentId]?.siteSegments[place.siteIndex] ?? [])
          if (id !== group.segmentId) reaching.set(id, [...(reaching.get(id) ?? []), place.label]);
      }
    const out: {
      segmentId: string;
      label: string;
      passage: SegmentViewClient | undefined;
      unprinted: boolean;
      list: SegmentVariants | undefined;
      /** The labels of the variants begun in another segment whose words lie in this one too. */
      reaching: string[];
    }[] = [];
    const seen = new Set<string>();
    for (const id of segmentIds) {
      const passage = byId[passageOf.get(id) ?? ''];
      const parts = passage?.segments ?? [];
      const at = parts.findIndex((p) => p.segmentId === id);
      const ids = [id];
      for (let k = at + 1; at >= 0 && k < parts.length && !parts[k]!.printed; k++)
        ids.push(parts[k]!.segmentId);
      for (const segmentId of ids) {
        if (seen.has(segmentId)) continue;
        seen.add(segmentId);
        const part = parts.find((p) => p.segmentId === segmentId);
        const list = listed.get(segmentId);
        // A segment the edition does not print has a section only where its variant shows.
        if (part && !part.printed && !list) continue;
        out.push({
          segmentId,
          label: part?.label ?? context.labelOf?.[segmentId] ?? segmentId,
          passage,
          unprinted: part ? !part.printed : false,
          list,
          reaching: [...new Set(reaching.get(segmentId) ?? [])],
        });
      }
    }
    return out;
  });

  function siteOf(variant: Variant): Site | null {
    return (
      byId[variant.segmentId]?.collation.sites.find((site) => site.index === variant.siteIndex) ??
      null
    );
  }

  function forAdoption(segment: SegmentViewClient): SegmentForAdoption {
    return {
      segmentId: segment.segmentId,
      collation: segment.collation,
      baseUnits: segment.baseUnits,
      attachments: segment.attachments,
    };
  }

  /** The review keys kept under the segments of a passage. */
  function reviewedIn(segment: SegmentViewClient): Set<string> {
    return new Set(
      segment.segments.flatMap((p) => [...(reviewedSets.get(p.segmentId) ?? new Set<string>())]),
    );
  }

  function isReviewed(segment: SegmentViewClient, site: Site): boolean {
    return reviewedIn(segment).has(keyOfSite(forAdoption(segment), site));
  }

  function pending(segment: SegmentViewClient, site: Site): boolean {
    return needsReview(forAdoption(segment), site, reviewedIn(segment));
  }

  /** A section is busy while an edit of its passage is saved and collated again. */
  function isBusy(passage: SegmentViewClient | undefined, segmentId: string): boolean {
    if (busySet.has(segmentId)) return true;
    return passage?.segments.some((p) => busySet.has(p.segmentId)) ?? false;
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
  {#if sections.length === 0}
    <p class="px-4 py-3 text-ink-muted">{s.noSegments}</p>
  {:else}
    {#each sections as section (section.segmentId)}
      {@const segment = section.passage}
      {@const places = section.list?.places ?? []}
      {@const sectionBusy = isBusy(segment, section.segmentId)}
      {@const drift = segment ? driftIn(segment, section.segmentId) : []}
      <section
        class={[
          'border-b border-line px-4 py-2 last:border-b-0',
          sectionBusy && 'pointer-events-none opacity-60',
        ]}
        aria-busy={sectionBusy}
        data-segment={section.segmentId}
        data-unprinted={section.unprinted ? '' : undefined}
      >
        <div class="flex items-baseline gap-3">
          <h3 class="w-14 shrink-0 font-sans text-xs font-semibold text-ink-soft">
            {section.label}
          </h3>
          {#if section.reaching.length}
            <p class="text-ink-muted">{s.variantAt(section.reaching.join(', '))}</p>
          {:else if places.length === 0}
            <p class="text-ink-muted">{s.noSites}</p>
          {/if}
          <span class="ml-auto flex items-baseline gap-3">
            {#if sectionBusy}<span class="text-xs text-ink-muted">{s.saving}</span>{/if}
            {#if segment?.absent.length}
              <span class="text-xs text-ink-muted">{s.absent(segment.absent.join(' '))}</span>
            {/if}
            {#if canEdit}
              <button
                type="button"
                class="text-xs text-ink-soft hover:text-ink"
                onclick={() => onnote?.(section.segmentId)}>{s.note}</button
              >
            {/if}
          </span>
        </div>
        {#each places as place (place.key)}
          {@const site = siteOf(place)}
          {@const passage = byId[place.segmentId]}
          {@const activeHere = site !== null && isActive(place.segmentId, site)}
          {@const done = site !== null && passage !== undefined && isReviewed(passage, site)}
          <div
            class={[
              'entry mt-1.5 rounded-md py-1 pr-2 pl-5 sm:pl-14 text-[0.8125rem] leading-normal transition-colors',
              activeHere && 'bg-accent-soft',
              !activeHere &&
                site &&
                passage &&
                pending(passage, site) &&
                'border-l-2 border-warning',
              place.minor && 'border-l-2 border-dashed border-line-strong bg-sunken',
            ]}
            data-site={site ? place.key : undefined}
            data-order={site ? undefined : place.key}
            data-active={activeHere ? '' : undefined}
          >
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <button
                type="button"
                class="rounded text-left text-base text-ink hover:underline"
                onclick={() => onfocus?.(site ? place.segmentId : place.stands, site)}
              >
                {#if whereText(place)}
                  <PlaceWords variant={place} {lang} kinds={!canEdit} />
                {:else}
                  {place.label}
                {/if}
              </button>
              {#if site && place.label !== section.label}
                <span class="text-xs text-ink-muted">{place.label}</span>
              {/if}
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
                    onclick={() => onkind?.(place.segmentId, site)}
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
                    onclick={() => onminor?.(place.segmentId, site)}>{s.minor}</Button
                  >
                  <Button
                    size="sm"
                    class="h-6! px-2! text-xs!"
                    variant="ghost"
                    onclick={() => onregister?.(place.segmentId, site)}>{s.register}</Button
                  >
                  <Button
                    size="sm"
                    class="h-6! px-2! text-xs!"
                    variant={done ? 'ghost' : 'secondary'}
                    onclick={() => onkeep?.(place.segmentId, site, !done)}
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
                  ? (origin) => onadopt?.(place.segmentId, site, origin)
                  : undefined}
                adoptTitle={s.adopt}
                adoptedLabel={s.adopted}
              />
            </div>
          </div>
        {/each}
        {#if segment}
          {#each drift as d (d.tokenId)}
            <div
              class="mt-1 flex flex-wrap items-baseline gap-2 pl-5 sm:pl-14 text-xs text-ink-soft"
            >
              <span class="text-warning" aria-hidden="true">≈</span>
              <span>{s.drift(formOf(segment, d.tokenId), d.siglum, d.now)}</span>
              {#if canEdit && d.now}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => ontakecurrent?.(section.segmentId, [d])}
                  >{s.takeCurrent(d.siglum)}</Button
                >
              {/if}
            </div>
          {/each}
          {#if canEdit}
            {#each [...takeable(drift)].filter(([, taken]) => taken.length > 1) as [siglum, taken] (siglum)}
              <div class="mt-1 pl-5 sm:pl-14">
                <Button
                  size="sm"
                  variant="secondary"
                  onclick={() => ontakecurrent?.(section.segmentId, taken)}
                  >{s.takeAllCurrent(siglum, taken.length)}</Button
                >
              </div>
            {/each}
          {/if}
          {#each segment.notes.filter((n) => (n.segmentId ?? segment.segmentId) === section.segmentId) as note (note.id)}
            <div class="mt-1 flex items-baseline gap-2 pl-5 sm:pl-14 text-xs text-ink-soft">
              <span class="font-serif text-sm text-ink">{note.text}</span>
              {#if note.cites?.length}<span class="text-ink-soft">({note.cites.join('; ')})</span
                >{/if}
              {#if note.author}<span class="text-ink-muted">{note.author}</span>{/if}
              {#if canEdit}
                <button
                  type="button"
                  class="ml-auto text-ink-muted hover:text-danger"
                  aria-label={ra.note.deleteOf(section.label)}
                  onclick={() => ondeletenote?.(section.segmentId, note.id)}
                  >{ra.note.delete}</button
                >
              {/if}
            </div>
          {/each}
        {/if}
        {#if section.list && section.list.unplaced.length}
          <div class="mt-1 pl-5 sm:pl-14 text-[0.8125rem] leading-normal text-ink-soft">
            <VariantRows rows={section.list.unplaced} {lang} {onwitness} />
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</div>
