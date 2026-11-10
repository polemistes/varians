<script lang="ts">
  /** Add a bibliography entry or change one, as the biblatex of one entry. */
  import { enhance } from '$app/forms';
  import { Button, Dialog, Field, Notice, Textarea, toasts } from '$lib/components/ui';
  import { bibStrings as t } from '$lib/strings/bibliography';

  interface Props {
    open: boolean;
    /** The entry being changed; null adds one. */
    entry: { id: string; bib: string } | null;
  }

  let { open = $bindable(), entry }: Props = $props();
  let text = $state('');
  let message = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (open) {
      text = entry ? entry.bib : t.entry.template;
      message = null;
    }
  });
</script>

<Dialog
  bind:open
  title={entry ? t.entry.editTitle : t.entry.addTitle}
  description={t.entry.description}
  size="lg"
>
  <form
    id="bib-entry-form"
    method="POST"
    action="?/save"
    use:enhance={() => {
      busy = true;
      return async ({ result, update }) => {
        busy = false;
        if (result.type === 'failure') {
          message = (result.data as { message?: string } | undefined)?.message ?? null;
          return;
        }
        if (result.type === 'success') {
          toasts.success(t.entry.saved);
          open = false;
        }
        await update({ reset: false });
      };
    }}
  >
    {#if entry}<input type="hidden" name="id" value={entry.id} />{/if}
    {#if message}<Notice kind="error" class="mb-3">{message}</Notice>{/if}
    <Field label={t.entry.field}>
      {#snippet children(control)}
        <Textarea
          {...control}
          name="bib"
          bind:value={text}
          rows={12}
          spellcheck={false}
          class="font-mono text-xs"
        />
      {/snippet}
    </Field>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{t.entry.cancel}</Button>
    <Button variant="primary" type="submit" form="bib-entry-form" loading={busy}
      >{t.entry.save}</Button
    >
  {/snippet}
</Dialog>
