<script lang="ts">
  import Reference from '$lib/components/bibliography/Reference.svelte';
  import EditionCard from '$lib/components/home/EditionCard.svelte';
  import SearchForm from '$lib/components/library/SearchForm.svelte';
  import WitnessLinks from '$lib/components/library/WitnessLinks.svelte';
  import WorkLinks from '$lib/components/library/WorkLinks.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const t = site.search;

  const nothing = $derived(!data.editions.length && !data.works.length && !data.witnesses.length && !data.bibliography.items.length);
  const bibliographyHref = $derived(`/bibliography?q=${encodeURIComponent(data.q)}`);
</script>

{#snippet heading(id: string, title: string, count: number)}
  <h2 {id} class="font-sans text-base font-semibold text-ink">
    {title}<span class="ml-1.5 font-normal text-ink-muted">{count}</span>
  </h2>
{/snippet}

<PageFrame title={data.q ? t.resultsFor(data.q) : t.title}>
  <div class="flex flex-col gap-10">
    <!-- The header's field is hidden on small screens; the page has one of its own there. -->
    <div class="md:hidden">
      <SearchForm action="/search" query={data.q} label={site.nav.searchField} />
    </div>

    {#if data.q && nothing}
      <p class="font-sans text-sm text-ink-soft">{t.none(data.q)}</p>
    {/if}

    {#if data.editions.length}
      <section aria-labelledby="results-editions" class="flex flex-col gap-4">
        {@render heading('results-editions', t.editions, data.editions.length)}
        <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each data.editions as edition (edition.id)}
            <li><EditionCard {...edition} /></li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if data.works.length}
      <section aria-labelledby="results-works" class="flex flex-col gap-4">
        {@render heading('results-works', t.works, data.works.length)}
        <WorkLinks items={data.works} />
      </section>
    {/if}

    {#if data.witnesses.length}
      <section aria-labelledby="results-witnesses" class="flex flex-col gap-4">
        {@render heading('results-witnesses', t.witnesses, data.witnesses.length)}
        <WitnessLinks items={data.witnesses} />
      </section>
    {/if}

    {#if data.bibliography.items.length}
      <section aria-labelledby="results-bibliography" class="flex flex-col gap-4">
        {@render heading('results-bibliography', t.bibliography, data.bibliography.total)}
        <ul class="flex flex-col divide-y divide-line">
          {#each data.bibliography.items as item (item.id)}
            <li class="flex flex-col gap-1 py-3">
              <a href="{bibliographyHref}#bib-{item.key}" class="font-sans text-sm font-semibold text-ink hover:text-accent">{item.label}</a>
              <Reference pieces={item.pieces} class="text-[0.95rem] leading-snug text-ink" />
            </li>
          {/each}
        </ul>
        {#if data.bibliography.total > data.bibliography.items.length}
          <a href={bibliographyHref} class="font-sans text-sm text-accent hover:underline">{t.allBibliography(data.bibliography.total)}</a>
        {/if}
      </section>
    {/if}
  </div>
</PageFrame>
