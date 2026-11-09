<script lang="ts">
  import EditionCard from '$lib/components/home/EditionCard.svelte';
  import RecentCard from '$lib/components/home/RecentCard.svelte';
  import { Button } from '$lib/components/ui';
  import { s } from '$lib/strings';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const t = site.home;

  /** The ways in, for someone signed in. */
  const menu = [
    { href: '/editions', label: t.readEdition },
    { href: '/works/new', label: t.registerWork },
    { href: '/witnesses/new', label: t.registerWitness },
    { href: '/start/transcription', label: t.transcribeWitness },
    { href: '/start/edition', label: t.makeEdition },
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
      {#each menu as item (item.href)}
        <Button href={item.href} variant="secondary">{item.label}</Button>
      {/each}
    </nav>

    {#if data.recent.total}
      <section aria-labelledby="continue" class="flex flex-col gap-3">
        <div class="flex items-baseline justify-between gap-4">
          <h2 id="continue" class="font-sans text-sm font-semibold text-ink">{t.continue}</h2>
          <a href="/mine" class="font-sans text-sm text-ink-soft hover:text-ink hover:underline">{t.allYourWork(data.recent.total)}</a>
        </div>
        <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each data.recent.items as item (item.kind + item.id)}
            <li><RecentCard {item} /></li>
          {/each}
        </ul>
      </section>
    {/if}
  {:else}
    <section class="flex max-w-3xl flex-col gap-6">
      <h1 class="font-serif text-4xl leading-tight text-ink sm:text-5xl">{t.title}</h1>
      <p class="max-w-reading font-serif text-lg leading-relaxed text-ink-soft">{t.lead}</p>
      <div class="flex flex-wrap items-center gap-3 font-sans">
        <Button href="/editions" variant="primary">{t.read}</Button>
        <Button href="/login" variant="secondary">{t.logIn}</Button>
        <a href="/register" class="text-sm text-accent hover:underline">{t.register}</a>
      </div>
    </section>

    <section aria-labelledby="recent" class="flex flex-col gap-3">
      <div class="flex items-baseline justify-between gap-4">
        <h2 id="recent" class="font-sans text-sm font-semibold text-ink">{t.recent}</h2>
        {#if data.published.length}<a href="/editions" class="font-sans text-sm text-ink-soft hover:text-ink hover:underline">{t.allEditions}</a>{/if}
      </div>
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
  {/if}
</div>
