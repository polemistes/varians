<script lang="ts">
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Menu, MenuItem } from '$lib/components/ui';
  import { registry } from '$lib/strings/registry';

  interface Props {
    /** The accessible name of the trigger: what the row is. */
    label: string;
    editLabel?: string;
    deleteLabel?: string;
    onedit?: () => void;
    ondelete?: () => void;
  }

  let {
    label,
    editLabel = registry.conjecture.edit,
    deleteLabel = registry.conjecture.delete,
    onedit,
    ondelete,
  }: Props = $props();

  // Let the menu close and hand focus back before a dialog takes it.
  const later = (fn?: () => void) => () => setTimeout(() => fn?.(), 0);
</script>

<Menu {label} triggerSize="sm" triggerClass="w-8 px-0">
  {#snippet trigger()}
    <Ellipsis class="size-4" aria-hidden="true" />
  {/snippet}
  {#if onedit}
    <MenuItem onSelect={later(onedit)}>
      {#snippet icon()}<Pencil aria-hidden="true" />{/snippet}
      {editLabel}
    </MenuItem>
  {/if}
  {#if ondelete}
    <MenuItem danger onSelect={later(ondelete)}>
      {#snippet icon()}<Trash2 aria-hidden="true" />{/snippet}
      {deleteLabel}
    </MenuItem>
  {/if}
</Menu>
