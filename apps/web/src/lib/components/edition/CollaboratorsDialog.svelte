<script lang="ts">
  /** Who may edit the edition besides its owner: invite by email, remove. */
  import { enhance } from '$app/forms';
  import { Button, Dialog, Field, Input, Notice } from '$lib/components/ui';
  import { editor } from '$lib/strings/editor';

  const t = editor.dialogs.collaborators;

  interface Props {
    open: boolean;
    collaborators: { userId: string; name: string; email: string }[];
  }

  let { open = $bindable(), collaborators }: Props = $props();
  let message = $state<string | null>(null);
  let busy = $state(false);
</script>

<Dialog bind:open title={t.title} description={t.description}>
  {#if message}<Notice kind="error">{message}</Notice>{/if}
  <ul class="mb-4 flex flex-col divide-y divide-line font-sans text-sm">
    {#each collaborators as person (person.userId)}
      <li class="flex items-center gap-3 py-2">
        <span class="text-ink">{person.name}</span>
        <span class="text-xs text-ink-soft">{person.email}</span>
        <form method="POST" action="?/removeCollaborator" class="ml-auto" use:enhance>
          <input type="hidden" name="userId" value={person.userId} />
          <Button size="sm" variant="ghost" type="submit">{t.remove}</Button>
        </form>
      </li>
    {:else}
      <li class="py-2 text-ink-muted">{t.nobody}</li>
    {/each}
  </ul>
  <form
    method="POST"
    action="?/addCollaborator"
    class="flex items-end gap-2"
    use:enhance={() => {
      busy = true;
      return async ({ result, update }) => {
        busy = false;
        message =
          result.type === 'failure'
            ? ((result.data as { message?: string } | undefined)?.message ?? t.notAdded)
            : null;
        await update();
      };
    }}
  >
    <Field label={t.invite} class="flex-1">
      {#snippet children(control)}<Input
          {...control}
          name="email"
          type="email"
          required
        />{/snippet}
    </Field>
    <Button type="submit" variant="secondary" loading={busy}>{t.inviteAction}</Button>
  </form>
</Dialog>
