<script lang="ts">
  import type { Snippet } from 'svelte';
  import { EmptyState } from '$lib/components/ui';

  interface Props {
    title: string;
    /** Shown after the title when above zero. */
    count?: number;
    hint?: string;
    /** The empty state, shown in place of the children while there is nothing. */
    empty?: string;
    isEmpty?: boolean;
    /** Buttons beside the heading. */
    actions?: Snippet;
    children?: Snippet;
    id?: string;
  }

  const uid = $props.id();
  let { title, count, hint, empty, isEmpty = false, actions, children, id }: Props = $props();
  const headingId = `section-${uid}`;
</script>

<section {id} aria-labelledby={headingId} class="flex scroll-mt-8 flex-col gap-4">
  <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-3">
    <div class="min-w-0">
      <h2 id={headingId} class="font-sans text-base font-semibold text-ink">
        {title}{#if count}<span class="ml-1.5 font-normal text-ink-muted">{count}</span>{/if}
      </h2>
      {#if hint}<p class="mt-1 max-w-reading font-sans text-sm text-ink-soft">{hint}</p>{/if}
    </div>
    {#if actions}
      <div class="flex shrink-0 flex-wrap items-center gap-2 font-sans">{@render actions()}</div>
    {/if}
  </div>
  {#if isEmpty}
    <EmptyState description={empty} class="py-6" />
  {:else}
    {@render children?.()}
  {/if}
</section>
