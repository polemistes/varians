<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    term: string;
    /** Left out entirely when empty, unless children are given. */
    value?: string | null;
    /** Serif, for names and text that are the object of study. */
    serif?: boolean;
    children?: Snippet;
  }

  let { term, value, serif = false, children }: Props = $props();
</script>

{#if children || value}
  <dt class="pt-2 text-ink-muted first:pt-0 sm:pt-0">{term}</dt>
  <dd class={['min-w-0 break-words text-ink', serif && 'font-serif text-base leading-snug']}>
    {#if children}{@render children()}{:else}{value}{/if}
  </dd>
{/if}
