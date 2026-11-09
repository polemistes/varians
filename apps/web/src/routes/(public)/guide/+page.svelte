<script lang="ts">
  import { PageFrame } from '$lib/components/shell';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<PageFrame width="page">
  <div class="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-16">
    <nav aria-label={site.guide.contents} class="font-sans text-sm lg:sticky lg:top-6 lg:w-56 lg:shrink-0">
      <p class="mb-2 font-semibold text-ink">{site.guide.contents}</p>
      <ul class="flex flex-col gap-1.5">
        {#each data.contents as heading (heading.id)}
          <li><a href="#{heading.id}" class="text-ink-soft hover:text-ink hover:underline">{heading.text}</a></li>
        {/each}
      </ul>
    </nav>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- the guide is the repository's own Markdown, rendered by $lib/guide/markdown. -->
    <article class="guide min-w-0 max-w-reading font-serif text-reading text-ink">{@html data.html}</article>
  </div>
</PageFrame>

<style>
  .guide :global(h1) {
    font-size: var(--text-title);
    line-height: 1.15;
    margin-bottom: 1.5rem;
  }
  .guide :global(h2) {
    font-family: var(--font-sans);
    font-size: 1.125rem;
    font-weight: 600;
    margin-top: 2.5rem;
    margin-bottom: 0.75rem;
    scroll-margin-top: 1.5rem;
  }
  .guide :global(h3) {
    font-family: var(--font-sans);
    font-size: 1rem;
    font-weight: 600;
    margin-top: 1.75rem;
    margin-bottom: 0.5rem;
    scroll-margin-top: 1.5rem;
  }
  .guide :global(p),
  .guide :global(ul),
  .guide :global(table) {
    margin-bottom: 0.9rem;
    line-height: 1.6;
  }
  .guide :global(ul) {
    list-style: disc;
    padding-left: 1.5rem;
  }
  .guide :global(ul ul) {
    margin: 0.3rem 0 0.3rem;
  }
  .guide :global(li) {
    margin-bottom: 0.35rem;
  }
  .guide :global(code) {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.85em;
    background: var(--color-sunken);
    padding: 0.05em 0.3em;
    border-radius: 0.25rem;
  }
  .guide :global(a) {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .guide :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-sans);
    font-size: 0.875rem;
  }
  .guide :global(th),
  .guide :global(td) {
    text-align: left;
    padding: 0.35rem 0.75rem 0.35rem 0;
    border-bottom: 1px solid var(--color-line);
    vertical-align: top;
  }
  .guide :global(th) {
    font-weight: 600;
  }
</style>
