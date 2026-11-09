<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    description?: string;
    /** An action, such as a button that makes the first thing. */
    children?: Snippet;
    class?: string;
  }

  let { title, description, children, class: className }: Props = $props();
</script>

<div class={['rounded-md border border-dashed border-line px-6 py-8 text-center font-sans', className]}>
  {#if title}<p class="text-sm font-medium text-ink">{title}</p>{/if}
  {#if description}<p class={['text-sm text-ink-soft', title && 'mt-1']}>{description}</p>{/if}
  {#if children}<div class="mt-4 flex justify-center gap-2">{@render children()}</div>{/if}
</div>
