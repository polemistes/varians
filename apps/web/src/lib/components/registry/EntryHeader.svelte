<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    /** The author of a work; a witness's place and shelfmark. Serif, under the title. */
    subtitle?: string | null;
    /** A line of facts in the interface face, with badges. */
    meta?: Snippet;
    /** Buttons at the end of the title line. */
    actions?: Snippet;
    /** What follows: a description, a list of fields. */
    children?: Snippet;
  }

  let { title, subtitle, meta, actions, children }: Props = $props();
</script>

<header class="flex flex-col gap-5">
  <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
    <div class="min-w-0">
      <h1 class="font-serif text-title text-ink">{title}</h1>
      {#if subtitle}<p class="mt-1.5 font-serif text-xl text-ink-soft">{subtitle}</p>{/if}
    </div>
    {#if actions}
      <div class="flex flex-wrap items-center gap-2 font-sans">{@render actions()}</div>
    {/if}
  </div>
  {#if meta}
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 font-sans text-sm text-ink-soft">
      {@render meta()}
    </div>
  {/if}
  {@render children?.()}
</header>
