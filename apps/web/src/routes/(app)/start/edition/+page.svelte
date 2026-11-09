<script lang="ts">
  import SearchForm from '$lib/components/library/SearchForm.svelte';
  import WorkLinks from '$lib/components/library/WorkLinks.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Button } from '$lib/components/ui';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const t = site.start;
</script>

<PageFrame title={t.edition.title} width="reading">
  <div class="flex flex-col gap-6">
    <SearchForm action="/start/edition" query={data.q} label={site.works.search} placeholder={site.works.placeholder} />
    {#if data.works.length}
      <WorkLinks items={data.works} href={(work) => `/editions/new?work=${work.slug}`} action={t.edition.choose} />
    {:else}
      <p class="font-sans text-sm text-ink-soft">{data.q ? t.noneFor(data.q) : t.none}</p>
    {/if}
    <div>
      <Button href="/works/new" variant="secondary" size="sm">{t.edition.register}</Button>
    </div>
  </div>
</PageFrame>
