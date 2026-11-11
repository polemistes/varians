<script lang="ts">
  /**
   * A work's Edit button and menu, the same wherever they stand: beside its
   * name on its page, at the end of its row in the Works list and in search.
   * Deleting asks in the application's window; the rest lead to pages.
   */
  import { ConfirmDialog, RecordActions } from '$lib/components/ui';
  import { recordActions } from '$lib/strings/record-actions';
  import { workActions, type WorkPlace, type WorkRights } from '$lib/work/actions';

  interface Props {
    work: { slug: string; title: string };
    rights: WorkRights;
    place: WorkPlace;
    /** Why the work cannot be deleted now, where the page knows it. */
    deletion?: string | null;
    class?: string;
  }

  let { work, rights, place, deletion = null, class: className }: Props = $props();

  const t = recordActions.work;
  const actions = $derived(
    workActions(work, rights, place, {
      ...(place === 'list' ? { name: work.title } : {}),
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
  label={place === 'list' ? recordActions.menuOf(work.title) : recordActions.menu}
  onaction={act}
  class={className}
/>

{#if rights.delete}
  <ConfirmDialog
    bind:open={deleteOpen}
    title={t.deleteTitle}
    description={t.deleteBody}
    confirmLabel={t.deleteVerb}
    action={`/works/${encodeURIComponent(work.slug)}/edit?/delete`}
    fields={place === 'list' ? { stay: '1' } : {}}
    done={t.deleted(work.title)}
  />
{/if}
