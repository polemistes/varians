<script lang="ts">
  import LibrarySection from '$lib/components/library/LibrarySection.svelte';
  import RecordRow from '$lib/components/library/RecordRow.svelte';
  import EditionActions from '$lib/components/edition/EditionActions.svelte';
  import TranscriptionActions from '$lib/components/transcription/TranscriptionActions.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Button } from '$lib/components/ui';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const t = site.mine;
  const h = site.home;
</script>

{#snippet editionActions(edition: (typeof data.editions)[number])}
  <EditionActions
    edition={{
      id: edition.id,
      slug: edition.slug,
      title: edition.title,
      published: edition.latestVersion !== null,
    }}
    rights={edition.can}
    place="list"
  />
{/snippet}

{#snippet transcriptionActions(transcription: (typeof data.transcriptions)[number])}
  <TranscriptionActions {transcription} rights={transcription.can} place="list" />
{/snippet}

<PageFrame title={t.title}>
  {#snippet actions()}
    <Button href="/editions/new" variant="secondary" size="sm">{t.newEdition}</Button>
    <Button href="/start/transcription" variant="secondary" size="sm">{t.newTranscription}</Button>
  {/snippet}
  <div class="flex flex-col gap-12">
    <LibrarySection title={t.editions} count={data.editions.length} empty={t.noEditions}>
      {#each data.editions as edition (edition.id)}
        <RecordRow
          href="/editions/{edition.slug}"
          title={edition.title}
          subtitle={h.editionOf(edition.workTitle)}
          subtitleHref="/works/{edition.workSlug}"
          date={edition.updatedAt}
          badge={edition.latestVersion !== null ? h.published : h.draft}
        >
          {#snippet actions()}{@render editionActions(edition)}{/snippet}
        </RecordRow>
      {/each}
    </LibrarySection>
    <LibrarySection
      title={t.transcriptions}
      count={data.transcriptions.length}
      empty={t.noTranscriptions}
    >
      {#each data.transcriptions as transcription (transcription.id)}
        <RecordRow
          href="/transcriptions/{transcription.id}"
          title={transcription.name}
          subtitle={h.transcriptionOf(transcription.witnessName)}
          subtitleHref="/witnesses/{transcription.witnessSlug}"
          date={transcription.updatedAt}
          badge={transcription.latestVersion !== null ? h.published : h.draft}
        >
          {#snippet actions()}{@render transcriptionActions(transcription)}{/snippet}
        </RecordRow>
      {/each}
    </LibrarySection>
    <LibrarySection
      title={t.shared}
      count={data.shared.editions.length + data.shared.transcriptions.length}
      empty={t.noShared}
    >
      {#each data.shared.editions as edition (edition.id)}
        <RecordRow
          href="/editions/{edition.slug}"
          title={edition.title}
          subtitle={h.editionOf(edition.workTitle)}
          subtitleHref="/works/{edition.workSlug}"
          owner={edition.ownerName}
          date={edition.updatedAt}
        >
          {#snippet actions()}{@render editionActions(edition)}{/snippet}
        </RecordRow>
      {/each}
      {#each data.shared.transcriptions as transcription (transcription.id)}
        <RecordRow
          href="/transcriptions/{transcription.id}"
          title={transcription.name}
          subtitle={h.transcriptionOf(transcription.witnessName)}
          subtitleHref="/witnesses/{transcription.witnessSlug}"
          owner={transcription.ownerName}
          date={transcription.updatedAt}
        >
          {#snippet actions()}{@render transcriptionActions(transcription)}{/snippet}
        </RecordRow>
      {/each}
    </LibrarySection>
  </div>
</PageFrame>
