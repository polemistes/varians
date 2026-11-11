<script lang="ts">
  import EditionPage from '$lib/components/edition/EditionPage.svelte';
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
  />
{/key}
