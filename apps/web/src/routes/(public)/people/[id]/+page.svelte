<script lang="ts">
  import { PageFrame } from '$lib/components/shell';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<PageFrame title={data.person.name} width="reading">
  <p class="font-sans text-sm text-ink-soft">
    {#if data.person.orcidUrl}
      ORCID iD: <a href={data.person.orcidUrl} rel="external" class="text-accent underline"
        >{data.person.orcid}</a
      >
    {:else}
      {site.people.noOrcid}
    {/if}
  </p>
</PageFrame>
