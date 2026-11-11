<script lang="ts">
  import Images from '@lucide/svelte/icons/images';
  import Plus from '@lucide/svelte/icons/plus';
  import { page } from '$app/state';
  import { PageFrame } from '$lib/components/shell';
  import { Button } from '$lib/components/ui';
  import {
    DescriptionItem,
    DescriptionList,
    EntryHeader,
    IdentifierList,
    MergedEntries,
    NewTranscriptionForm,
    PageList,
    ReadingList,
    Section,
    TranscriptionList,
    WitnessActions,
  } from '$lib/components/registry';
  import { materialLabel } from '$lib/registry/witness';
  import { registry as t } from '$lib/strings/registry';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const s = t.witness;
  const witness = $derived(data.witness);
  /** Where the witness is kept, as it is cited: place, repository, shelfmark. */
  const place = $derived(
    [witness.settlement, witness.repository, witness.shelfmark].filter(Boolean).join(', '),
  );

  // Arriving from the list of witnesses under Make New Transcript, the form is open at once.
  let creating = $state(page.url.searchParams.get('transcribe') === '1');
</script>

<PageFrame>
  <div class="flex flex-col gap-14">
    <EntryHeader title={witness.name} subtitle={place || null}>
      {#snippet actions()}
        <WitnessActions {witness} rights={data.rights} place="page" deletion={data.deletion} />
      {/snippet}
      {#snippet meta()}
        <span>{s.siglum}</span>
        <span class="font-serif text-base font-bold text-ink">{witness.siglum}</span>
        <span class="text-ink-muted" aria-hidden="true">·</span>
        <span>{s.categories[witness.category] ?? witness.category}</span>
        {#if witness.category === 'manuscript' && witness.format && witness.format !== 'unknown'}
          <span class="text-ink-muted" aria-hidden="true">·</span>
          <span>{s.formats[witness.format]}</span>
        {/if}
        {#if witness.dateText}
          <span class="text-ink-muted" aria-hidden="true">·</span>
          <span>{witness.dateText}</span>
        {/if}
      {/snippet}
      <DescriptionList class="max-w-reading">
        {#if witness.category === 'indirect' && (witness.sourceAuthor || witness.sourceWork)}
          <DescriptionItem
            term={s.sourceAuthor}
            value={s.quotedIn(witness.sourceAuthor ?? '', witness.sourceWork ?? '')}
          />
        {/if}
        <DescriptionItem term={s.identifier} value={witness.identifier} />
        {#if witness.identifiers.length}
          <DescriptionItem term={t.identifiers.label}>
            <IdentifierList identifiers={witness.identifiers} />
          </DescriptionItem>
        {/if}
        <DescriptionItem term={s.material} value={materialLabel(witness.material)} />
        <DescriptionItem term={s.extent} value={witness.extent} />
        {#if witness.hands.length}
          <DescriptionItem term={s.hands}>
            <ul class="flex flex-col gap-0.5">
              {#each witness.hands as hand (hand.id)}
                <li>
                  <span class="font-serif text-base text-ink">{hand.label}</span
                  >{#if hand.main}<span class="text-ink-soft">
                      ({s.handMainShort})</span
                    >{/if}{#if hand.description}<span class="text-ink-soft"
                      >: {hand.description}</span
                    >{/if}
                </li>
              {/each}
            </ul>
          </DescriptionItem>
        {/if}
        <DescriptionItem term={s.provenance} value={witness.provenance} />
        {#if data.merged.length}
          <DescriptionItem term={t.merge.mergedHere}>
            <MergedEntries items={data.merged} />
          </DescriptionItem>
        {/if}
        {#if witness.iiifManifest}
          <DescriptionItem term={s.iiif}>
            <a
              href={witness.iiifManifest}
              class="break-all text-accent hover:underline"
              rel="noopener noreferrer"
            >
              {witness.iiifManifest}
            </a>
          </DescriptionItem>
        {/if}
      </DescriptionList>
      {#if witness.description}
        <p class="max-w-reading font-serif text-reading text-ink">{witness.description}</p>
      {/if}
      <p class="font-sans text-sm text-ink-soft">
        {data.maintainers.length
          ? t.work.maintainedBy(t.common.and(data.maintainers.map((m) => m.name)))
          : t.work.noMaintainers}
      </p>
    </EntryHeader>

    <Section
      title={s.pages}
      count={data.pages.length}
      empty={s.noPages}
      isEmpty={data.pages.length === 0}
    >
      {#snippet actions()}
        {#if data.rights.maintain}
          <Button href="/witnesses/{witness.slug}/pages" variant="secondary" size="sm">
            <Images class="size-4" aria-hidden="true" />
            {s.managePages}
          </Button>
        {/if}
      {/snippet}
      <PageList pages={data.pages} />
    </Section>

    <Section
      title={s.transcriptions}
      count={data.transcriptions.length}
      empty={s.noTranscriptions}
      isEmpty={data.transcriptions.length === 0}
    >
      {#snippet actions()}
        {#if data.can.newTranscription}
          <Button size="sm" variant="secondary" onclick={() => (creating = true)}>
            <Plus class="size-4" aria-hidden="true" />
            {s.newTranscription}
          </Button>
        {/if}
      {/snippet}
      <TranscriptionList items={data.transcriptions} />
    </Section>

    <Section
      title={s.works}
      count={data.works.length}
      empty={s.noWorks}
      isEmpty={data.works.length === 0}
    >
      <ul class="divide-y divide-line rounded-md border border-line bg-surface">
        {#each data.works as work (work.id)}
          <li class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
            <div class="min-w-0">
              <a
                href="/works/{work.slug}"
                class="font-serif text-lg leading-snug text-ink transition-colors hover:text-accent hover:underline"
              >
                {work.title}
              </a>
              {#if work.author}<span class="ml-1.5 font-serif text-base text-ink-soft"
                  >{work.author}</span
                >{/if}
            </div>
            <p class="font-sans text-xs text-ink-soft">
              {[
                work.transcriptionCount ? s.viaTranscriptions(work.transcriptionCount) : '',
                work.readingCount ? s.viaReadings(work.readingCount) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </li>
        {/each}
      </ul>
    </Section>

    <Section
      title={s.readings}
      count={data.readings.length}
      hint={data.readings.length ? s.readingsHint : undefined}
      empty={s.noReadings}
      isEmpty={data.readings.length === 0}
    >
      <ReadingList items={data.readings} show="work" />
    </Section>
  </div>
</PageFrame>

{#if data.can.newTranscription}
  <NewTranscriptionForm bind:open={creating} works={data.workOptions} sources={data.sources} />
{/if}
