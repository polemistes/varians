<script lang="ts">
  import LibrarySection from '$lib/components/library/LibrarySection.svelte';
  import RecordRow from '$lib/components/library/RecordRow.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Button } from '$lib/components/ui';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const t = site.mine;
  const h = site.home;
</script>

<PageFrame title={t.title}>
  {#snippet actions()}
    <Button href="/editions/new" variant="secondary" size="sm">{t.newEdition}</Button>
    <Button href="/start/transcription" variant="secondary" size="sm">{t.newTranscription}</Button>
  {/snippet}
  <div class="flex flex-col gap-12">
    <LibrarySection title={t.editions} count={data.editions.length} empty={t.noEditions}>
      {#each data.editions as edition (edition.id)}
        <RecordRow
          href="/editions/{edition.slug}/edit"
          title={edition.title}
          subtitle={h.editionOf(edition.workTitle)}
          subtitleHref="/works/{edition.workSlug}"
          date={edition.updatedAt}
          badge={edition.visibility === 'published' ? h.published : h.draft}
        />
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
          badge={transcription.visibility === 'published' ? h.published : h.draft}
        />
      {/each}
    </LibrarySection>
    <LibrarySection
      title={t.shared}
      count={data.shared.editions.length + data.shared.transcriptions.length}
      empty={t.noShared}
    >
      {#each data.shared.editions as edition (edition.id)}
        <RecordRow
          href="/editions/{edition.slug}/edit"
          title={edition.title}
          subtitle={h.editionOf(edition.workTitle)}
          subtitleHref="/works/{edition.workSlug}"
          owner={edition.ownerName}
          date={edition.updatedAt}
        />
      {/each}
      {#each data.shared.transcriptions as transcription (transcription.id)}
        <RecordRow
          href="/transcriptions/{transcription.id}"
          title={transcription.name}
          subtitle={h.transcriptionOf(transcription.witnessName)}
          subtitleHref="/witnesses/{transcription.witnessSlug}"
          owner={transcription.ownerName}
          date={transcription.updatedAt}
        />
      {/each}
    </LibrarySection>
  </div>
</PageFrame>
