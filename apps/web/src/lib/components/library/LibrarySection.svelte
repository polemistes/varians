<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    /** How many rows the children render; zero shows the empty text. */
    count: number;
    empty?: string;
    level?: 2 | 3;
    actions?: Snippet;
    children?: Snippet;
  }

  const uid = $props.id();
  let { title, count, empty, level = 2, actions, children }: Props = $props();
  const headingId = `section-${uid}`;
</script>

<section aria-labelledby={headingId} class="flex flex-col gap-3">
  <div class="flex items-baseline justify-between gap-4">
    <svelte:element
      this={`h${level}`}
      id={headingId}
      class={['font-sans font-semibold text-ink', level === 2 ? 'text-base' : 'text-sm']}
    >
      {title}
      {#if count > 0}<span class="ml-1.5 font-normal text-ink-muted">{count}</span>{/if}
    </svelte:element>
    {#if actions}<div class="font-sans">{@render actions()}</div>{/if}
  </div>
  {#if count === 0}
    <p class="font-sans text-sm text-ink-soft">{empty}</p>
  {:else}
    <ul class="divide-y divide-line rounded-md border border-line bg-surface">
      {@render children?.()}
    </ul>
  {/if}
</section>
