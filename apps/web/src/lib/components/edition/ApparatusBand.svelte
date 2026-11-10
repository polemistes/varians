<script lang="ts">
  /**
   * The apparatus at the foot of the edition editor: for the segments on
   * screen, every site with its readings as buttons. Clicking adopts.
   */
  import { trimPunctuation, type Attachment, type Reading, type Site } from '@varians/core';
  import { Button } from '$lib/components/ui';
  import { keyOfSite, needsReview, type SegmentForAdoption } from '$lib/edition/adopt-client';
  import type { ActiveSite, SegmentViewClient } from '$lib/edition/types';
  import { editor as s } from '$lib/strings/editor';

  export type Choice =
    | { kind: 'reading'; reading: Reading }
    | { kind: 'attachment'; attachment: Attachment };

  interface Props {
    segments: SegmentViewClient[];
    active: ActiveSite | null;
    /** Reviewed site keys by segment id. */
    reviewed: Record<string, string[]>;
    canEdit: boolean;
    baseSiglum?: string;
    /** Segments whose last edit is still being saved and collated: shown dimmed, their buttons disabled. */
    busy?: string[];
    /** Order statements by segment id: where witnesses have the segment elsewhere. */
    orderNotes?: Record<string, string[]>;
    onadopt?: (segmentId: string, site: Site, choice: Choice) => void;
    onkeep?: (segmentId: string, site: Site, reviewed: boolean) => void;
    /** Call the site textual or interpretative, the other of what it is. */
    onkind?: (segmentId: string, site: Site) => void;
    /** Leave the place out of the apparatus, or report it again. */
    onreport?: (segmentId: string, site: Site) => void;
    onregister?: (segmentId: string, site: Site) => void;
    onfocus?: (segmentId: string, site: Site) => void;
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
    baseSiglum = 'ed.',
    busy = [],
    orderNotes = {},
    onadopt,
    onkeep,
    onkind,
    onreport,
    onregister,
    onfocus,
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

  function sitesToShow(segment: SegmentViewClient): Site[] {
    return segment.collation.sites.filter((site) => {
      if (isActive(segment.segmentId, site)) return true;
      const others = site.readings.filter((r) => !r.base);
      const attached = segment.attachments[site.index] ?? [];
      if (attached.length) return true;
      return others.length > 0;
    });
  }

  function lemmaSigla(site: Site): string {
    const base = site.readings.find((r) => r.base);
    return base ? base.sigla.filter((x) => x !== baseSiglum).join(' ') : '';
  }

  function variantNote(reading: Reading, site: Site): string | null {
    const base = site.readings.find((r) => r.base);
    if (reading.lacunose && reading.text === '') return s.lacuna;
    if (reading.omission) return s.omitted;
    if (base && base.text === '' && reading.text !== '') return s.added;
    return null;
  }

  function attachmentNote(a: Attachment): string {
    switch (a.conjectureKind) {
      case 'deletion':
        return 'del.';
      case 'lacuna':
        return 'lac.';
      case 'supplement':
        return 'suppl.';
      case 'transposition':
        return 'transp.';
      default:
        return a.kind === 'reported' ? '' : 'coni.';
    }
  }

  function forAdoption(segment: SegmentViewClient): SegmentForAdoption {
    return {
      segmentId: segment.segmentId,
      collation: segment.collation,
      baseUnits: segment.baseUnits,
      attachments: segment.attachments,
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

  // Keep the active entry in view.
  let activeEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
</script>

<div
  class="apparatus-band h-full overflow-y-auto font-sans text-sm"
  role="region"
  aria-label={s.apparatus}
>
  {#if segments.length === 0}
    <p class="px-4 py-3 text-ink-muted">{s.noSegments}</p>
  {:else}
    {#each segments as segment (segment.segmentId)}
      {@const sites = sitesToShow(segment)}
      {@const isBusy = busySet.has(segment.segmentId)}
      <section
        class={[
          'border-b border-line px-4 py-2 last:border-b-0',
          isBusy && 'pointer-events-none opacity-60',
        ]}
        aria-busy={isBusy}
        data-segment={segment.segmentId}
      >
        <div class="flex items-baseline gap-3">
          <h3 class="w-14 shrink-0 font-sans text-xs font-semibold text-ink-soft">
            {segment.label}
          </h3>
          {#if sites.length === 0}
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
        {#each orderNotes[segment.segmentId] ?? [] as note (note)}
          <p class="mt-1 pl-14 text-xs text-ink-soft">
            <span class="mr-1 text-ink-muted">{s.order}</span>{note}
          </p>
        {/each}
        {#each sites as site (site.index)}
          {@const base = site.readings.find((r) => r.base)}
          {@const attached = segment.attachments[site.index] ?? []}
          {@const activeHere = isActive(segment.segmentId, site)}
          {@const done = isReviewed(segment, site)}
          <div
            class={[
              'entry mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md py-1 pr-2 pl-14 transition-colors',
              activeHere && 'bg-accent-soft',
              !activeHere && pending(segment, site) && 'border-l-2 border-warning',
              site.unreported && 'border-l-2 border-dashed border-line-strong bg-sunken',
            ]}
            data-site={site.index}
            bind:this={
              () => null,
              (el) => {
                if (activeHere) activeEl = el;
              }
            }
          >
            <button
              type="button"
              class="font-serif text-ink hover:underline"
              onclick={() => onfocus?.(segment.segmentId, site)}
            >
              {base && base.text !== '' ? trimPunctuation(base.text) : s.nothing}
            </button>
            {#if lemmaSigla(site)}<span class="text-xs tracking-wide text-ink-soft uppercase"
                >{lemmaSigla(site)}</span
              >{/if}
            {#each site.readings.filter((r) => !r.base) as reading, k (k)}
              {@const note = variantNote(reading, site)}
              {@const relation =
                segment.relations?.[site.index]?.[site.readings.indexOf(reading)] ?? null}
              <span class="text-ink-muted">:</span>
              {#if canEdit}
                <button
                  type="button"
                  class="group inline-flex items-baseline gap-1.5 rounded px-1 hover:bg-sunken"
                  title={s.adopt}
                  onclick={() => onadopt?.(segment.segmentId, site, { kind: 'reading', reading })}
                >
                  {#if reading.text}<span class="font-serif text-ink"
                      >{trimPunctuation(reading.text)}</span
                    >{/if}
                  {#if note}<span class="italic text-ink-soft">{note}</span>{/if}
                  <span class="text-xs tracking-wide text-ink-soft uppercase"
                    >{reading.sigla.join(' ')}</span
                  >
                  {#if relation}<span
                      class="text-xs text-ink-muted"
                      title={s.relationTitle[relation]}>{s.relation[relation]}</span
                    >{/if}
                </button>
              {:else}
                <span class="inline-flex items-baseline gap-1.5">
                  {#if reading.text}<span class="font-serif text-ink"
                      >{trimPunctuation(reading.text)}</span
                    >{/if}
                  {#if note}<span class="italic text-ink-soft">{note}</span>{/if}
                  <span class="text-xs tracking-wide text-ink-soft uppercase"
                    >{reading.sigla.join(' ')}</span
                  >
                  {#if relation}<span
                      class="text-xs text-ink-muted"
                      title={s.relationTitle[relation]}>{s.relation[relation]}</span
                    >{/if}
                </span>
              {/if}
            {/each}
            {#each attached as attachment (attachment.id)}
              <span class="text-ink-muted">:</span>
              {#if canEdit && !attachment.adopted}
                <button
                  type="button"
                  class="inline-flex items-baseline gap-1.5 rounded px-1 hover:bg-sunken"
                  title={s.adopt}
                  onclick={() =>
                    onadopt?.(segment.segmentId, site, { kind: 'attachment', attachment })}
                >
                  {#if attachment.text}<span class="font-serif text-ink">{attachment.text}</span
                    >{/if}
                  <span
                    class="text-ink-soft"
                    title={segment.cites?.[attachment.id]?.join('; ') || undefined}
                    >{attachment.name}{attachment.source ? ` ${attachment.source}` : ''}</span
                  >
                  {#if attachmentNote(attachment)}<span class="italic text-ink-muted"
                      >({attachmentNote(attachment)})</span
                    >{/if}
                </button>
              {:else}
                <span
                  class={[
                    'inline-flex items-baseline gap-1.5',
                    attachment.adopted && 'rounded bg-success-soft px-1',
                  ]}
                >
                  {#if attachment.text}<span class="font-serif text-ink">{attachment.text}</span
                    >{/if}
                  <span
                    class="text-ink-soft"
                    title={segment.cites?.[attachment.id]?.join('; ') || undefined}
                    >{attachment.name}{attachment.source ? ` ${attachment.source}` : ''}</span
                  >
                  {#if attachment.adopted}<span class="text-xs text-ink-muted">{s.adopted}</span
                    >{/if}
                </span>
              {/if}
            {/each}
            {#if !canEdit && site.unreported}
              <span class="ml-auto text-xs text-ink-muted italic">{s.notReported}</span>
            {:else if !canEdit && site.kind === 'interpretative'}
              <span class="ml-auto text-xs text-ink-muted italic">{s.interpretative}</span>
            {/if}
            {#if canEdit}
              <span class="ml-auto flex items-center gap-1">
                {#if site.unreported}
                  <span class="px-1.5 text-xs text-ink-muted italic">{s.notReported}</span>
                {:else}
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
                {/if}
                <Button
                  size="sm"
                  variant="ghost"
                  title={site.unreported ? s.reportTitle : s.leaveOutTitle}
                  onclick={() => onreport?.(segment.segmentId, site)}
                  >{site.unreported ? s.report : s.leaveOut}</Button
                >
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => onregister?.(segment.segmentId, site)}>{s.register}</Button
                >
                <Button
                  size="sm"
                  variant={done ? 'ghost' : 'secondary'}
                  onclick={() => onkeep?.(segment.segmentId, site, !done)}
                  title={done ? s.unreview : s.keep}
                >
                  {done ? s.kept : s.keep}
                </Button>
              </span>
            {/if}
          </div>
        {/each}
        {#each segment.drift ?? [] as d (d.tokenId)}
          <div class="mt-1 flex flex-wrap items-baseline gap-2 pl-14 text-xs text-ink-soft">
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
          {#each [...takeable(segment)].filter(([, list]) => list.length > 1) as [siglum, list] (siglum)}
            <div class="mt-1 pl-14">
              <Button
                size="sm"
                variant="secondary"
                onclick={() => ontakecurrent?.(segment.segmentId, list)}
                >{s.takeAllCurrent(siglum, list.length)}</Button
              >
            </div>
          {/each}
        {/if}
        {#each segment.notes as note (note.id)}
          <div class="mt-1 flex items-baseline gap-2 pl-14 text-xs text-ink-soft">
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
        {#if segment.unplaced.length}
          <p class="mt-1 pl-14 text-xs text-ink-muted">
            {#each segment.unplaced as a (a.id)}
              <span class="mr-3"><span class="font-serif text-ink">{a.text}</span> {a.name}</span>
            {/each}
          </p>
        {/if}
      </section>
    {/each}
  {/if}
</div>
