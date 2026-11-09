<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Tabs } from 'bits-ui';

  export interface Tab {
    value: string;
    label: string;
    disabled?: boolean;
  }

  interface Props {
    tabs: Tab[];
    /** The selected tab; defaults to the first. */
    value?: string;
    onValueChange?: (value: string) => void;
    /** Accessible name of the tab list. */
    label?: string;
    /** TabPanel components, one per tab. */
    children?: Snippet;
    class?: string;
  }

  let { tabs, value = $bindable(tabs[0]?.value ?? ''), onValueChange, label, children, class: className }: Props = $props();
</script>

<Tabs.Root bind:value {onValueChange} class={className}>
  <Tabs.List class="flex gap-1 border-b border-line font-sans text-sm" aria-label={label}>
    {#each tabs as tab (tab.value)}
      <Tabs.Trigger
        value={tab.value}
        disabled={tab.disabled}
        class="-mb-px border-b-2 border-transparent px-3 py-2 text-ink-soft transition-colors hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink data-disabled:pointer-events-none data-disabled:opacity-50"
      >
        {tab.label}
      </Tabs.Trigger>
    {/each}
  </Tabs.List>
  {@render children?.()}
</Tabs.Root>
