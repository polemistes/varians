<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Tabs } from 'bits-ui';

  interface Props {
    /** The value of the tab this panel belongs to. */
    value: string;
    children: Snippet;
    class?: string;
  }

  let { value, children, class: className }: Props = $props();
</script>

<Tabs.Content {value} class={['pt-4 outline-none', className]}>
  {@render children()}
</Tabs.Content>
