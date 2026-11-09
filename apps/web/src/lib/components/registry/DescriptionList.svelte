<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** DescriptionItem components. */
    children: Snippet;
    class?: string;
  }

  let { children, class: className }: Props = $props();
</script>

<dl
  class={[
    'grid grid-cols-1 gap-x-8 gap-y-1 font-sans text-sm sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-2.5',
    className,
  ]}
>
  {@render children()}
</dl>
