<script lang="ts">
  /**
   * What may be done with a record, beside its name or at the end of its
   * row: its buttons, then its ⋯ menu, as a kind's own function gives them
   * (lib/record/actions.ts). Links lead where they say; an action's id is
   * handed to `onaction`, for the page to open its window or act.
   */
  import type { Snippet } from 'svelte';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import type { RecordActions } from '$lib/record/actions';
  import Button from './Button.svelte';
  import Menu from './Menu.svelte';
  import MenuItem from './MenuItem.svelte';
  import MenuLabel from './MenuLabel.svelte';
  import MenuSeparator from './MenuSeparator.svelte';

  interface Props {
    actions: RecordActions;
    /** The accessible name of the ⋯ menu. */
    label: string;
    onaction: (id: string) => void;
    /** Buttons of the page's own before the record's (the editor's Publish). */
    before?: Snippet;
    class?: string;
  }

  let { actions, label, onaction, before, class: className }: Props = $props();
</script>

{#if before || actions.buttons.length || actions.menu.length}
  <div class={['flex shrink-0 items-center gap-2 font-sans', className]}>
    {@render before?.()}
    {#each actions.buttons as button (button.id)}
      <Button href={button.href} size="sm" variant="secondary" aria-label={button.name}
        >{button.label}</Button
      >
    {/each}
    {#if actions.menu.length}
      <Menu
        {label}
        triggerVariant="secondary"
        triggerSize="sm"
        triggerClass="w-8 px-0"
        class="min-w-56"
      >
        {#snippet trigger()}
          <Ellipsis class="size-4" aria-hidden="true" />
        {/snippet}
        {#each actions.menu as entry, i (i)}
          {#if entry.kind === 'separator'}
            <MenuSeparator />
          {:else if entry.kind === 'label'}
            <MenuLabel>{entry.label}</MenuLabel>
          {:else if entry.kind === 'link'}
            <MenuItem href={entry.href} file={entry.file}>{entry.label}</MenuItem>
          {:else}
            <MenuItem
              danger={entry.danger}
              disabled={!!entry.disabled}
              onSelect={() => onaction(entry.id)}
            >
              <span class="flex flex-col">
                <span>{entry.label}</span>
                {#if entry.disabled}<span class="text-xs text-ink-muted">{entry.disabled}</span
                  >{/if}
              </span>
            </MenuItem>
          {/if}
        {/each}
      </Menu>
    {/if}
  </div>
{/if}
