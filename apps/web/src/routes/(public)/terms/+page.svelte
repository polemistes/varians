<script lang="ts">
  import { PageFrame } from '$lib/components/shell';
  import { Button, Notice } from '$lib/components/ui';
  import { site } from '$lib/strings/site';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<PageFrame width="reading">
  {#if data.toAccept}
    <Notice kind="info">{data.changed ? site.terms.changed : site.terms.first}</Notice>
  {/if}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- the terms are the repository's own Markdown, rendered by $lib/guide/markdown. -->
  <article class="terms mt-6 font-serif text-reading text-ink">{@html data.html}</article>
  {#if data.toAccept}
    <form method="POST" class="mt-8">
      <input type="hidden" name="version" value={data.version} />
      <input type="hidden" name="next" value={data.next} />
      <Button type="submit" variant="primary">{site.terms.accept}</Button>
    </form>
  {:else if data.toAccept === false}
    <p class="mt-8 font-sans text-sm text-ink-soft">{site.terms.acceptedOn(data.version)}.</p>
  {/if}
</PageFrame>

<style>
  .terms :global(h1) {
    font-size: var(--text-title);
    line-height: 1.15;
    margin-bottom: 1.5rem;
  }
  .terms :global(h2) {
    font-family: var(--font-sans);
    font-size: 1.05rem;
    font-weight: 600;
    margin-top: 2rem;
    margin-bottom: 0.6rem;
  }
  .terms :global(p) {
    margin-bottom: 0.9rem;
    line-height: 1.6;
  }
</style>
