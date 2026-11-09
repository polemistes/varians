<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import WitnessLinks from '$lib/components/library/WitnessLinks.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Button } from '$lib/components/ui';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const t = site.witnesses;
</script>

<PageFrame title={t.title}>
  {#snippet actions()}
    {#if data.user}
      <Button href="/witnesses/new" variant="secondary" size="sm"><Plus class="size-4" aria-hidden="true" />{t.newWitness}</Button>
    {/if}
  {/snippet}
  {#if data.witnesses.length}
    <WitnessLinks items={data.witnesses} />
  {:else}
    <p class="font-sans text-sm text-ink-soft">{t.none}</p>
  {/if}
</PageFrame>
