<script lang="ts">
  /**
   * The menu at the end of the row of a smaller record, one that has no page
   * of its own: a conjecture, a reported reading, a bibliography entry. It is
   * the shared menu with the items lib/record/row-actions.ts gives: Edit
   * first, Delete last. Both open windows of the page the row stands on,
   * which the page does, given the item.
   */
  import { RecordActions } from '$lib/components/ui';
  import { rowActions, type RowKind, type RowMenuRights } from '$lib/record/row-actions';

  interface Props {
    kind: RowKind;
    rights: RowMenuRights;
    /** The accessible name of the menu: what the row is. */
    label: string;
    onedit?: () => void;
    ondelete?: () => void;
    class?: string;
  }

  let { kind, rights, label, onedit, ondelete, class: className }: Props = $props();

  const actions = $derived(rowActions(kind, rights));

  // Let the menu close and hand focus back before a window takes it.
  function act(id: string) {
    setTimeout(() => (id === 'edit' ? onedit?.() : ondelete?.()), 0);
  }
</script>

<RecordActions {actions} {label} onaction={act} class={className} />
