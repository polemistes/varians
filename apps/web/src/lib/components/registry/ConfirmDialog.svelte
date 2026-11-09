<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { Button, Dialog, Notice, toasts } from '$lib/components/ui';
  import { registry } from '$lib/strings/registry';

  interface Props {
    open?: boolean;
    title: string;
    description: string;
    /** The form action that does the deed, such as ?/deleteConjecture. */
    action: string;
    /** Hidden fields sent with it. */
    fields?: Record<string, string>;
    confirmLabel?: string;
    /** Shown when the action succeeds or redirects; an action's own `message` wins. */
    done?: string;
  }

  let {
    open = $bindable(false),
    title,
    description,
    action,
    fields = {},
    confirmLabel = registry.common.confirmDelete,
    done,
  }: Props = $props();

  const uid = $props.id();
  const formId = `confirm-${uid}`;
  let submitting = $state(false);
  let refusal = $state<string | null>(null);

  $effect(() => {
    if (open) refusal = null;
  });

  const submit: SubmitFunction = () => {
    submitting = true;
    return async ({ result, update }) => {
      submitting = false;
      if (result.type === 'failure') {
        refusal = String(result.data?.error ?? registry.common.forbidden);
        return;
      }
      if (result.type === 'error') {
        toasts.error(result.error?.message ?? registry.common.forbidden);
        return;
      }
      const message =
        result.type === 'success' ? (result.data?.message as string | undefined) : undefined;
      if (message ?? done) toasts.success((message ?? done)!);
      open = false;
      await update();
    };
  };
</script>

<Dialog bind:open {title} {description} size="sm">
  <form id={formId} method="post" {action} use:enhance={submit}>
    {#each Object.entries(fields) as [name, value] (name)}
      <input type="hidden" {name} {value} />
    {/each}
  </form>
  {#if refusal}<Notice kind="error">{refusal}</Notice>{/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{registry.common.cancel}</Button>
    <Button type="submit" form={formId} variant="danger" loading={submitting} disabled={!!refusal}>
      {confirmLabel}
    </Button>
  {/snippet}
</Dialog>
