<script lang="ts">
  import Download from '@lucide/svelte/icons/download';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import { PageFrame } from '$lib/components/shell';
  import { Badge, Button, buttonClasses } from '$lib/components/ui';
  import {
    ConfirmDialog,
    ConjectureForm,
    ConjectureList,
    EditionList,
    EntryHeader,
    IdentifierList,
    MergedEntries,
    ReadingList,
    ReportedReadingForm,
    Section,
    SegmentLabels,
    WitnessList,
    WitnessPicker,
  } from '$lib/components/registry';
  import { registry as t } from '$lib/strings/registry';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  type ConjectureItem = (typeof data.conjectures)[number];
  type ReadingItem = (typeof data.readings)[number];

  const uid = $props.id();
  const labelsList = `labels-${uid}`;
  const work = $derived(data.work);
  const newWitnessHref = $derived(
    `/witnesses/new?return=${encodeURIComponent(`/works/${data.work.slug}`)}`,
  );

  let picking = $state(false);
  let conjectureOpen = $state(false);
  let conjecture = $state<ConjectureItem | null>(null);
  let conjectureDeleteOpen = $state(false);
  let conjectureToDelete = $state<ConjectureItem | null>(null);
  let readingOpen = $state(false);
  let reading = $state<ReadingItem | null>(null);
  let readingDeleteOpen = $state(false);
  let readingToDelete = $state<ReadingItem | null>(null);

  // Back from registering a witness: the picker opens once with it chosen.
  let pickedShown = '';
  $effect(() => {
    const picked = data.pickedWitness;
    if (picked && picked.id !== pickedShown) {
      pickedShown = picked.id;
      picking = true;
    }
  });
</script>

<PageFrame>
  <div class="flex flex-col gap-14">
    <EntryHeader title={work.title} subtitle={work.author ?? t.work.unknownAuthor}>
      {#if work.description}
        <p class="max-w-reading font-serif text-reading text-ink">{work.description}</p>
      {/if}
      {#if data.can.newEdition || data.can.transcribe || data.can.maintain}
        <div class="flex flex-wrap items-center gap-2 font-sans" role="group" aria-label={t.work.workOn}>
          {#if data.can.newEdition}
            <Button href="/editions/new?work={work.slug}" variant="primary" size="sm">
              <Plus class="size-4" aria-hidden="true" />
              {t.work.newEdition}
            </Button>
          {/if}
          {#if data.can.transcribe}
            <Button size="sm" variant="secondary" onclick={() => (picking = true)}>
              <Plus class="size-4" aria-hidden="true" />
              {t.work.transcribe}
            </Button>
          {/if}
          {#if data.can.maintain}
            <Button href="/works/{work.slug}/edit" variant="ghost" size="sm">
              <Pencil class="size-4" aria-hidden="true" />
              {t.work.editDetails}
            </Button>
          {/if}
        </div>
      {/if}
    </EntryHeader>

    <Section
      title={t.work.editions}
      count={data.editions.length}
      empty={t.work.noEditions}
      isEmpty={data.editions.length === 0}
    >
      <EditionList items={data.editions} />
    </Section>

    <Section
      title={t.work.witnesses}
      count={data.transcriptions.length}
      empty={t.work.noWitnesses}
      isEmpty={data.transcriptions.length === 0}
    >
      <WitnessList items={data.transcriptions} total={data.segmentCount} />
    </Section>

    <Section
      title={t.work.conjectures}
      count={data.conjectures.length}
      empty={t.work.noConjectures}
      isEmpty={data.conjectures.length === 0}
    >
      {#snippet actions()}
        {#if data.can.addConjecture}
          <Button
            size="sm"
            variant="secondary"
            onclick={() => {
              conjecture = null;
              conjectureOpen = true;
            }}
          >
            <Plus class="size-4" aria-hidden="true" />
            {t.conjecture.add}
          </Button>
        {/if}
      {/snippet}
      <ConjectureList
        items={data.conjectures}
        onedit={(item) => {
          conjecture = item as ConjectureItem;
          conjectureOpen = true;
        }}
        ondelete={(item) => {
          conjectureToDelete = item as ConjectureItem;
          conjectureDeleteOpen = true;
        }}
      />
    </Section>

    <Section
      title={t.work.readings}
      count={data.readings.length}
      empty={t.work.noReadings}
      isEmpty={data.readings.length === 0}
    >
      {#snippet actions()}
        {#if data.can.addReading}
          <Button
            size="sm"
            variant="secondary"
            onclick={() => {
              reading = null;
              readingOpen = true;
            }}
          >
            <Plus class="size-4" aria-hidden="true" />
            {t.reading.add}
          </Button>
        {/if}
      {/snippet}
      <ReadingList
        items={data.readings}
        onedit={(item) => {
          reading = item as ReadingItem;
          readingOpen = true;
        }}
        ondelete={(item) => {
          readingToDelete = item as ReadingItem;
          readingDeleteOpen = true;
        }}
      />
    </Section>

    {#if data.user}
      <Section
        title={t.work.segments}
        count={data.segmentCount}
        empty={t.work.noSegments}
        isEmpty={data.segmentCount === 0}
      >
        <SegmentLabels ranges={data.segmentRanges} />
      </Section>
    {/if}

    <Section title={t.work.about}>
      <dl class="grid gap-x-8 gap-y-3 font-sans text-sm sm:grid-cols-[10rem_1fr]">
        <dt class="text-ink-muted">{t.work.language}</dt>
        <dd class="text-ink">{work.languageName}</dd>
        <dt class="text-ink-muted">{t.work.numbering}</dt>
        <dd class="text-ink">{data.schemeSentence}</dd>
        {#if work.identifier}
          <dt class="text-ink-muted">{t.work.identifierLabel}</dt>
          <dd class="font-mono text-xs break-all text-ink">{work.identifier}</dd>
        {/if}
        {#if work.identifiers.length}
          <dt class="text-ink-muted">{t.identifiers.label}</dt>
          <dd class="text-ink"><IdentifierList identifiers={work.identifiers} /></dd>
        {/if}
        <dt class="text-ink-muted">{t.work.visibilityLabel}</dt>
        <dd><Badge tone={work.visibility === 'private' ? 'warning' : 'neutral'}>{work.visibility === 'private' ? t.work.private : t.work.public}</Badge></dd>
        <dt class="text-ink-muted">{t.work.maintainersLabel}</dt>
        <dd class="text-ink">{data.maintainers.length ? t.common.and(data.maintainers.map((m) => m.name)) : t.work.noMaintainers}</dd>
        {#if data.merged.length}
          <dt class="text-ink-muted">{t.merge.mergedHere}</dt>
          <dd class="text-ink"><MergedEntries items={data.merged} /></dd>
        {/if}
      </dl>
      {#if data.can.archive}
        <div class="mt-6 flex flex-col gap-2">
          <p class="max-w-reading font-sans text-sm text-ink-soft">{t.work.archiveHint}</p>
          <div>
            <a href="/works/{work.slug}/package.zip" download="{work.slug}.zip" class={buttonClasses('secondary', 'sm')}>
              <Download class="size-4" aria-hidden="true" />
              {t.work.download}
            </a>
            {#if data.user?.role === 'administrator'}
              <a href="/works/{work.slug}/archive.zip" download="{work.slug}-archive.zip" class="ml-3 font-sans text-sm text-ink-soft underline">{t.work.downloadRepository}</a>
            {/if}
          </div>
        </div>
      {/if}
    </Section>
  </div>
</PageFrame>

{#if data.labels.length}
  <datalist id={labelsList}>
    {#each data.labels as label (label)}<option value={label}></option>{/each}
  </datalist>
{/if}

{#if data.can.transcribe}
  <WitnessPicker bind:open={picking} {newWitnessHref} initial={data.pickedWitness} />
{/if}

<ConjectureForm
  bind:open={conjectureOpen}
  {conjecture}
  scheme={data.scheme}
  example={data.example}
  labelsList={data.labels.length ? labelsList : undefined}
  canPublish={conjecture ? conjecture.can.publish : true}
/>
<ConfirmDialog
  bind:open={conjectureDeleteOpen}
  title={t.conjecture.deleteTitle}
  description={t.conjecture.deleteConfirm}
  action="?/deleteConjecture"
  fields={{ id: conjectureToDelete?.id ?? '' }}
  done={t.conjecture.deleted}
/>

<ReportedReadingForm
  bind:open={readingOpen}
  {reading}
  scheme={data.scheme}
  example={data.example}
  labelsList={data.labels.length ? labelsList : undefined}
  witnesses={data.witnesses}
  canPublish={reading ? reading.can.publish : true}
/>
<ConfirmDialog
  bind:open={readingDeleteOpen}
  title={t.reading.deleteTitle}
  description={t.reading.deleteConfirm}
  action="?/deleteReading"
  fields={{ id: readingToDelete?.id ?? '' }}
  done={t.reading.deleted}
/>
