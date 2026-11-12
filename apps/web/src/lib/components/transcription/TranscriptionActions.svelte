<script lang="ts">
  /**
   * A transcript's menu, the same wherever it stands: in the workbench's
   * header, in the rows of a witness's page and a work's page, on Your Work
   * and on the front page's Continue. Publish…, Withdraw Version… and an
   * administrator's Delete Version… open their windows wherever the menu
   * stands, and deleting asks in the application's window. Settings and the copy are windows of the
   * workbench: there they open at once, and from a list the item leads to
   * the workbench with the window open.
   */
  import { goto } from '$app/navigation';
  import { ConfirmDialog, RecordActions } from '$lib/components/ui';
  import DeleteVersionDialog from '$lib/components/version/DeleteVersionDialog.svelte';
  import PublishDialog from '$lib/components/version/PublishDialog.svelte';
  import WithdrawDialog from '$lib/components/version/WithdrawDialog.svelte';
  import { recordActions } from '$lib/strings/record-actions';
  import {
    transcriptionActions,
    type TranscriptionPlace,
    type TranscriptionRights,
  } from '$lib/transcription/actions';

  interface Props {
    transcription: { id: string; name: string; latestVersion: number | null };
    rights: TranscriptionRights;
    place: TranscriptionPlace;
    /** In the workbench: saves what is pending before publishing. */
    flush?: () => Promise<void>;
    /** In the workbench: open the settings window. */
    onsettings?: () => void;
    /** In the workbench: open the window for making a copy. */
    oncopy?: () => void;
    /** In the workbench: called as the deletion begins, so that saving stops first. */
    ondeletestart?: () => void;
    /** In the workbench: called when the window closes after a refusal, so that saving starts again. */
    ondeleterefused?: () => void;
    class?: string;
  }

  let {
    transcription,
    rights,
    place,
    flush,
    onsettings,
    oncopy,
    ondeletestart,
    ondeleterefused,
    class: className,
  }: Props = $props();

  const t = recordActions.transcription;
  const actions = $derived(transcriptionActions(transcription, rights, place));
  const id = $derived(encodeURIComponent(transcription.id));

  let deleteOpen = $state(false);
  let publishOpen = $state(false);
  let withdrawOpen = $state(false);
  let deleteVersionOpen = $state(false);
  let refused = $state(false);

  // A page that stopped as the deletion began goes on once the refusal has been read.
  $effect(() => {
    if (!deleteOpen && refused) {
      refused = false;
      ondeleterefused?.();
    }
  });

  function act(action: string) {
    if (action === 'delete') deleteOpen = true;
    else if (action === 'publish') publishOpen = true;
    else if (action === 'withdraw') withdrawOpen = true;
    else if (action === 'delete-version') deleteVersionOpen = true;
    else if (action === 'settings') {
      if (place === 'workbench') onsettings?.();
      else void goto(`/transcriptions/${id}?settings=1`);
    } else if (action === 'copy') {
      if (place === 'workbench') oncopy?.();
      else void goto(`/transcriptions/${id}?copy=1`);
    }
  }
</script>

<RecordActions
  {actions}
  label={place === 'list' ? recordActions.menuOf(transcription.name) : recordActions.menu}
  onaction={act}
  class={className}
/>

{#if rights.publish}
  <PublishDialog bind:open={publishOpen} kind="transcription" id={transcription.id} {flush} />
  <WithdrawDialog bind:open={withdrawOpen} kind="transcription" id={transcription.id} />
{/if}

{#if rights.deleteVersion}
  <DeleteVersionDialog bind:open={deleteVersionOpen} kind="transcription" id={transcription.id} />
{/if}

{#if rights.delete}
  <ConfirmDialog
    bind:open={deleteOpen}
    title={t.deleteTitle}
    description={t.deleteBody}
    confirmLabel={t.deleteVerb}
    action={`/transcriptions/${id}?/delete`}
    fields={place === 'list' ? { stay: '1' } : {}}
    done={t.deleted}
    onstart={ondeletestart}
    onrefused={() => (refused = true)}
  />
{/if}
