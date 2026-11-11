<script lang="ts">
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import Plus from '@lucide/svelte/icons/plus';
  import { PageFrame } from '$lib/components/shell';
  import { Button, ConfirmDialog } from '$lib/components/ui';
  import {
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
    WorkActions,
  } from '$lib/components/registry';
  import { recordActions as ra } from '$lib/strings/record-actions';
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

  // A witness's page leads here to edit a reported reading it lists (?editReading=<id>): its window opens once.
  onMount(() => {
    const url = new URL(location.href);
    const id = url.searchParams.get('editReading');
    if (!id) return;
    const found = data.readings.find((r) => r.id === id);
    if (found?.can.edit) {
      reading = found;
      readingOpen = true;
    }
    url.searchParams.delete('editReading');
    replaceState(url, {});
  });

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
      {#snippet actions()}
        <WorkActions {work} rights={data.rights} place="page" deletion={data.deletion} />
      {/snippet}
      {#if work.description}
        <p class="max-w-reading font-serif text-reading text-ink">{work.description}</p>
      {/if}
    </EntryHeader>

    <Section
      title={t.work.editions}
      count={data.editions.length}
      empty={t.work.noEditions}
      isEmpty={data.editions.length === 0}
    >
      {#snippet actions()}
        {#if data.can.newEdition}
          <Button href="/editions/new?work={work.slug}" size="sm" variant="secondary">
            <Plus class="size-4" aria-hidden="true" />
            {t.work.newEdition}
          </Button>
        {/if}
      {/snippet}
      <EditionList items={data.editions} />
    </Section>

    <Section
      title={t.work.witnesses}
      count={data.transcriptions.length}
      empty={t.work.noWitnesses}
      isEmpty={data.transcriptions.length === 0}
    >
      {#snippet actions()}
        {#if data.can.transcribe}
          <Button size="sm" variant="secondary" onclick={() => (picking = true)}>
            <Plus class="size-4" aria-hidden="true" />
            {t.work.transcribe}
          </Button>
        {/if}
      {/snippet}
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
        <dt class="text-ink-muted">{t.work.maintainersLabel}</dt>
        <dd class="text-ink">
          {data.maintainers.length
            ? t.common.and(data.maintainers.map((m) => m.name))
            : t.work.noMaintainers}
        </dd>
        {#if data.merged.length}
          <dt class="text-ink-muted">{t.merge.mergedHere}</dt>
          <dd class="text-ink"><MergedEntries items={data.merged} /></dd>
        {/if}
      </dl>
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
  confirmLabel={ra.conjecture.deleteVerb}
  bind:open={conjectureDeleteOpen}
  title={ra.conjecture.deleteTitle}
  description={ra.conjecture.deleteBody}
  action="?/deleteConjecture"
  fields={{ id: conjectureToDelete?.id ?? '' }}
  done={ra.conjecture.deleted}
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
  confirmLabel={ra.reading.deleteVerb}
  bind:open={readingDeleteOpen}
  title={ra.reading.deleteTitle}
  description={ra.reading.deleteBody}
  action="?/deleteReading"
  fields={{ id: readingToDelete?.id ?? '' }}
  done={ra.reading.deleted}
/>
