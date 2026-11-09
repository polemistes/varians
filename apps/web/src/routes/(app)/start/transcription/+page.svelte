<script lang="ts">
  import SearchForm from '$lib/components/library/SearchForm.svelte';
  import WitnessLinks from '$lib/components/library/WitnessLinks.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Button } from '$lib/components/ui';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const t = site.start;
</script>

<PageFrame title={t.transcription.title} width="reading">
  <div class="flex flex-col gap-6">
    <SearchForm action="/start/transcription" query={data.q} label={site.witnesses.search} placeholder={site.witnesses.placeholder} />
    {#if data.witnesses.length}
      <WitnessLinks items={data.witnesses} href={(witness) => `/witnesses/${witness.slug}?transcribe=1`} action={t.transcription.choose} />
    {:else}
      <p class="font-sans text-sm text-ink-soft">{data.q ? t.noneFor(data.q) : t.none}</p>
    {/if}
    <div>
      <Button href="/witnesses/new" variant="secondary" size="sm">{t.transcription.register}</Button>
    </div>
  </div>
</PageFrame>
