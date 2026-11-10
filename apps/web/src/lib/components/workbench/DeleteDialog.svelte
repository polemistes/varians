<script lang="ts">
  /** Deleting the transcription, for its owner: the witness and its pages stay. */
  import { enhance } from '$app/forms';
  import { Button, Dialog, Notice } from '$lib/components/ui';
  import { workbench as t } from '$lib/strings/workbench';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    open: boolean;
  }

  let { wb, open = $bindable(false) }: Props = $props();

  let busy = $state(false);
  let refused = $state<string | null>(null);
</script>

<Dialog
  bind:open
  title={t.delete.title}
  description={t.delete.body(wb.name)}
  size="sm"
  onOpenChange={(value) => {
    // Saving stopped for the delete; after a refusal the page starts again to save once more.
    if (!value && refused) location.reload();
  }}
>
  {#if refused}<Notice kind="error">{refused}</Notice>{/if}
  <form
    id="wb-delete"
    method="post"
    action="?/delete"
    use:enhance={() => {
      busy = true;
      wb.stop();
      return async ({ result, update }) => {
        busy = false;
        if (result.type === 'failure') {
          refused =
            (result.data as { deleteError?: string } | undefined)?.deleteError ??
            t.errors.forbidden;
          return;
        }
        await update();
      };
    }}
  ></form>
  {#snippet footer()}
    <Button
      variant="ghost"
      onclick={() => {
        open = false;
        if (refused) location.reload();
      }}>{t.delete.cancel}</Button
    >
    <Button type="submit" form="wb-delete" variant="danger" loading={busy}
      >{t.delete.confirm}</Button
    >
  {/snippet}
</Dialog>
