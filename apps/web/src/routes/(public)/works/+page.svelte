<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import WorkLinks from '$lib/components/library/WorkLinks.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Button } from '$lib/components/ui';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const t = site.works;
</script>

<PageFrame title={t.title}>
  {#snippet actions()}
    {#if data.user}
      <Button href="/works/new" variant="secondary" size="sm"
        ><Plus class="size-4" aria-hidden="true" />{t.newWork}</Button
      >
    {/if}
  {/snippet}
  {#if data.works.length}
    <WorkLinks items={data.works} />
  {:else}
    <p class="font-sans text-sm text-ink-soft">{t.none}</p>
  {/if}
</PageFrame>
