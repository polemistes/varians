<script lang="ts">
  import EditionCard from '$lib/components/home/EditionCard.svelte';
  import RecentCard from '$lib/components/home/RecentCard.svelte';
  import { Button } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const t = site.home;

  /** What someone signed in starts from here; making an edition comes first. */
  const menu = [
    { href: '/start/edition', label: t.makeEdition },
    { href: '/works/new', label: t.registerWork },
    { href: '/witnesses/new', label: t.registerWitness },
    { href: '/start/transcription', label: t.transcribeWitness },
  ];
</script>

<svelte:head>
  <title>{s.app.name}</title>
  <meta name="description" content={t.lead} />
</svelte:head>

<div class="mx-auto flex w-full max-w-page flex-col gap-12 px-6 py-12 sm:px-8 sm:py-16">
  {#if data.user && data.recent}
    <h1 class="sr-only">{s.app.name}</h1>
    <nav aria-label={t.menu} class="flex flex-wrap gap-2 font-sans">
      {#each menu as item, i (item.href)}
        <Button href={item.href} variant={i === 0 ? 'primary' : 'secondary'}>{item.label}</Button>
      {/each}
    </nav>

    {#if data.recent.total}
      <section aria-labelledby="continue" class="flex flex-col gap-3">
        <div class="flex items-baseline justify-between gap-4">
          <h2 id="continue" class="font-sans text-sm font-semibold text-ink">{t.continue}</h2>
          <a href="/mine" class="font-sans text-sm text-ink-soft hover:text-ink hover:underline"
            >{t.allYourWork(data.recent.total)}</a
          >
        </div>
        <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each data.recent.items as item (item.kind + item.id)}
            <li><RecentCard {item} /></li>
          {/each}
        </ul>
      </section>
    {/if}
  {:else}
    <section class="flex flex-col gap-6">
      <h1 class="font-serif text-4xl leading-tight text-ink">{t.title}</h1>
      <p class="max-w-reading font-serif text-lg leading-relaxed text-ink-soft">{t.lead}</p>
    </section>
  {/if}

  <section aria-labelledby="editions" class="flex flex-col gap-4">
    <h2 id="editions" class="font-serif text-title text-ink">{t.editions}</h2>
    {#if data.published.length}
      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each data.published as edition (edition.id)}
          <li><EditionCard {...edition} /></li>
        {/each}
      </ul>
    {:else}
      <p class="font-sans text-sm text-ink-soft">{t.noEditions}</p>
    {/if}
  </section>
</div>
