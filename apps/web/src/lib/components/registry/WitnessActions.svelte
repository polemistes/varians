<script lang="ts">
  /**
   * A witness's Edit button and menu, the same wherever they stand: beside
   * its name on its page, at the end of its row in the Witnesses list and in
   * search. Deleting asks in the application's window; Merge leads to a page.
   */
  import { ConfirmDialog, RecordActions } from '$lib/components/ui';
  import { recordActions } from '$lib/strings/record-actions';
  import { witnessActions, type WitnessPlace, type WitnessRights } from '$lib/witness/actions';

  interface Props {
    witness: { slug: string; name: string };
    rights: WitnessRights;
    place: WitnessPlace;
    /** Why the witness cannot be deleted now, where the page knows it. */
    deletion?: string | null;
    class?: string;
  }

  let { witness, rights, place, deletion = null, class: className }: Props = $props();

  const t = recordActions.witness;
  const actions = $derived(
    witnessActions(witness, rights, place, {
      ...(place === 'list' ? { name: witness.name } : {}),
      deletion,
    }),
  );

  let deleteOpen = $state(false);

  function act(id: string) {
    if (id === 'delete') deleteOpen = true;
  }
</script>

<RecordActions
  {actions}
  label={place === 'list' ? recordActions.menuOf(witness.name) : recordActions.menu}
  onaction={act}
  class={className}
/>

{#if rights.delete}
  <ConfirmDialog
    bind:open={deleteOpen}
    title={t.deleteTitle}
    description={t.deleteBody}
    confirmLabel={t.deleteVerb}
    action={`/witnesses/${encodeURIComponent(witness.slug)}/edit?/delete`}
    fields={place === 'list' ? { stay: '1' } : {}}
    done={t.deleted(witness.name)}
  />
{/if}
