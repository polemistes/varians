<script lang="ts">
  /** Confirm deleting a bibliography entry; refused while something cites it. */
  import { enhance } from '$app/forms';
  import { Button, Dialog, Notice, toasts } from '$lib/components/ui';
  import { bibStrings as t } from '$lib/strings/bibliography';

  interface Props {
    open: boolean;
    entry: { id: string; label: string } | null;
  }

  let { open = $bindable(), entry }: Props = $props();
  let message = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (open) message = null;
  });
</script>

<Dialog
  bind:open
  title={t.deleteDialog.title(entry?.label ?? '')}
  description={t.deleteDialog.description}
  size="sm"
>
  {#if message}<Notice kind="error">{message}</Notice>{/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{t.deleteDialog.cancel}</Button>
    <form
      method="POST"
      action="?/delete"
      use:enhance={() => {
        busy = true;
        return async ({ result, update }) => {
          busy = false;
          if (result.type === 'failure') {
            message = (result.data as { message?: string } | undefined)?.message ?? null;
            return;
          }
          if (result.type === 'success') {
            toasts.success(t.deleteDialog.deleted);
            open = false;
          }
          await update();
        };
      }}
    >
      <input type="hidden" name="id" value={entry?.id ?? ''} />
      <Button variant="danger" type="submit" loading={busy}>{t.deleteDialog.confirm}</Button>
    </form>
  {/snippet}
</Dialog>
