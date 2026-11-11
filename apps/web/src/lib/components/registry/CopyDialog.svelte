<script lang="ts">
  /**
   * Making a copy of a transcription or an edition: a name for the copy,
   * what comes along, and the form action that makes it. The action
   * redirects to the copy.
   */
  import { enhance } from '$app/forms';
  import { Button, Dialog, Field, Input, Notice } from '$lib/components/ui';
  import { registry } from '$lib/strings/registry';

  interface Props {
    open: boolean;
    title: string;
    /** What the copy brings along and what it leaves. */
    description: string;
    /** The name proposed for the copy. */
    proposed: string;
    /** The form action, such as "?/copy". */
    action: string;
    label: string;
  }

  let { open = $bindable(false), title, description, proposed, action, label }: Props = $props();

  const s = registry.copy;
  const uid = $props.id();
  const formId = `copy-${uid}`;
  let name = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!open) return;
    name = proposed;
    error = null;
  });
</script>

<Dialog bind:open {title} {description} size="sm">
  <form
    id={formId}
    method="post"
    {action}
    class="flex flex-col gap-4"
    use:enhance={() => {
      busy = true;
      error = null;
      return async ({ result, update }) => {
        busy = false;
        if (result.type === 'failure') {
          error = (result.data as { copyError?: string } | undefined)?.copyError ?? s.failed;
          return;
        }
        // The copy opens as a page of its own: the workbench and the editor are built once per page.
        if (result.type === 'redirect') {
          location.assign(result.location);
          return;
        }
        await update();
      };
    }}
  >
    <Field {label} required>
      {#snippet children(control)}
        <Input {...control} name="name" bind:value={name} required maxlength={200} />
      {/snippet}
    </Field>
    {#if error}<Notice kind="error">{error}</Notice>{/if}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{s.cancel}</Button>
    <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!name.trim()}
      >{s.make}</Button
    >
  {/snippet}
</Dialog>
