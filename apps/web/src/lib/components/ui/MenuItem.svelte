<script lang="ts">
  import type { Snippet } from 'svelte';
  import { DropdownMenu } from 'bits-ui';

  interface Props {
    /** Renders the item as a link. */
    href?: string;
    /** The link is a file to fetch (a download), not a page: the browser loads it, not the app's router. */
    file?: boolean;
    onSelect?: (event: Event) => void;
    disabled?: boolean;
    danger?: boolean;
    icon?: Snippet;
    children: Snippet;
    class?: string;
  }

  let { href, file = false, onSelect, disabled = false, danger = false, icon, children, class: className }: Props = $props();

  const classes = $derived([
    'flex w-full cursor-default items-center gap-2 rounded px-2 py-1.5 text-left outline-none select-none transition-colors data-highlighted:bg-sunken data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-ink-muted',
    danger ? 'text-danger' : 'text-ink',
    className,
  ]);
</script>

{#if href}
  <DropdownMenu.Item {disabled} {onSelect} class={classes}>
    {#snippet child({ props })}
      <a {...props} {href} data-sveltekit-reload={file ? '' : undefined}>
        {#if icon}{@render icon()}{/if}
        {@render children()}
      </a>
    {/snippet}
  </DropdownMenu.Item>
{:else}
  <DropdownMenu.Item {disabled} {onSelect} class={classes}>
    {#if icon}{@render icon()}{/if}
    {@render children()}
  </DropdownMenu.Item>
{/if}
