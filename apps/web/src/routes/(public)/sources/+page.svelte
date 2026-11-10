<script lang="ts">
  /** Sources and licences: the licences of Varians itself, and the data and resources that come with it. */
  import { USED_SOURCES, VARIANS_LICENCES } from '$lib/sources';
  import { site } from '$lib/strings/site';

  const t = site.sources;
  const groups = [
    { heading: t.varians, items: VARIANS_LICENCES },
    { heading: t.resources, items: USED_SOURCES },
  ];
</script>

<svelte:head><title>{t.title}</title></svelte:head>

<div class="mx-auto w-full max-w-reading px-6 py-10 sm:px-8">
  <h1 class="font-serif text-3xl text-ink">{t.title}</h1>
  <p class="mt-3 text-ink-soft">{t.lead}</p>
  {#each groups as group (group.heading)}
    <h2 class="mt-10 font-serif text-2xl text-ink">{group.heading}</h2>
    <dl class="mt-4 flex flex-col gap-6">
      {#each group.items as item (item.title)}
        <div class="border-t border-line pt-4">
          <dt class="font-serif text-lg text-ink">
            {#if item.url}<a href={item.url} class="hover:text-accent" rel="external"
                >{item.title}</a
              >{:else}{item.title}{/if}
          </dt>
          <dd class="mt-1 grid gap-1 font-sans text-sm text-ink-soft sm:grid-cols-[8rem_1fr]">
            <span class="text-ink-muted">{t.use}</span><span>{item.use}</span>
            <span class="text-ink-muted">{t.source}</span><span>{item.source}</span>
            <span class="text-ink-muted">{t.licence}</span><span
              >{#if item.licenceUrl}<a
                  href={item.licenceUrl}
                  class="underline-offset-2 hover:underline"
                  rel="external">{item.licence}</a
                >{:else}{item.licence}{/if}</span
            >
          </dd>
        </div>
      {/each}
    </dl>
  {/each}
</div>
