<script lang="ts">
  import EditionCard from '$lib/components/home/EditionCard.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const t = site.editions;
</script>

<PageFrame title={t.title}>
  {#if data.editions.length}
    <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each data.editions as edition (edition.id)}
        <li><EditionCard {...edition} /></li>
      {/each}
    </ul>
  {:else}
    <p class="font-sans text-sm text-ink-soft">{t.none}</p>
  {/if}
</PageFrame>
