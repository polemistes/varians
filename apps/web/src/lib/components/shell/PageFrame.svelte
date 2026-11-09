<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    /** One sentence under the title. */
    lead?: string;
    /** The column: the full page, the reading column, or a narrow form. */
    width?: 'page' | 'reading' | 'narrow';
    /** Buttons beside the title. */
    actions?: Snippet;
    children: Snippet;
    class?: string;
  }

  let { title, lead, width = 'page', actions, children, class: className }: Props = $props();

  const widths = { page: 'max-w-page', reading: 'max-w-reading', narrow: 'max-w-narrow' };
</script>

<div class={['mx-auto w-full px-6 py-10 sm:px-8 sm:py-12', widths[width], className]}>
  {#if title || actions}
    <header class="mb-10 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      {#if title}
        <div class="min-w-0">
          <h1 class="font-serif text-title text-ink">{title}</h1>
          {#if lead}<p class="mt-2 max-w-reading font-sans text-sm text-ink-soft">{lead}</p>{/if}
        </div>
      {/if}
      {#if actions}
        <div class="flex flex-wrap items-center gap-2 font-sans">{@render actions()}</div>
      {/if}
    </header>
  {/if}
  {@render children()}
</div>
