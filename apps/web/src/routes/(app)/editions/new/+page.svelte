<script lang="ts">
  import EditionPage from '$lib/components/edition/EditionPage.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<EditionPage
  mode="new"
  work={data.work}
  works={data.works}
  q={data.q}
  editors={data.editors}
  conspectus={{ rows: [], witnesses: {}, groups: [] }}
  suggestions={data.suggestions}
  sources={data.sources}
  errors={form?.errors ?? {}}
/>
