<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    class?: string;
  }

  let { children, class: className }: Props = $props();
</script>

<kbd
  class={[
    'inline-flex min-w-5 items-center justify-center rounded border border-line border-b-2 bg-sunken px-1.5 py-px font-sans text-[0.6875rem] text-ink-soft',
    className,
  ]}
>
  {@render children()}
</kbd>
