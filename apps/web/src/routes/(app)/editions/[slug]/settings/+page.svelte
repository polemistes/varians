<script lang="ts">
  import EditionActions from '$lib/components/edition/EditionActions.svelte';
  import EditionPage from '$lib/components/edition/EditionPage.svelte';
  import EditionPeople from '$lib/components/edition/EditionPeople.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<!-- What is saved is where the page starts from: a save that changes it starts the page afresh. -->
{#key data.revision}
  <EditionPage
    mode="settings"
    work={data.work}
    edition={data.edition}
    editors={data.edition.editors}
    conspectus={data.conspectus}
    suggestions={data.suggestions}
    sources={data.sources}
    errors={form?.errors ?? {}}
  >
    {#snippet headerActions()}
      <EditionActions
        edition={{
          id: data.edition.id,
          slug: data.edition.slug,
          title: data.edition.title,
          published: data.edition.published,
        }}
        rights={data.rights}
        place="settings"
      />
    {/snippet}
    {#snippet after()}
      {#if data.people}
        <EditionPeople {...data.people} />
      {/if}
    {/snippet}
  </EditionPage>
{/key}
