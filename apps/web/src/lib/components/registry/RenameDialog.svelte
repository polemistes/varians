<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { Button, Dialog, Field, Input, toasts } from '$lib/components/ui';
  import { registry } from '$lib/strings/registry';
  import { autoselect } from './focus';

  interface Props {
    open?: boolean;
    transcription: { id: string; name: string } | null;
  }

  let { open = $bindable(false), transcription }: Props = $props();

  const s = registry.transcription;
  const uid = $props.id();
  const formId = `rename-${uid}`;
  let submitting = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (open) error = null;
  });

  const submit: SubmitFunction = () => {
    submitting = true;
    return async ({ result, update }) => {
      submitting = false;
      if (result.type === 'success') {
        toasts.success(s.renamed);
        open = false;
        await update();
      } else if (result.type === 'failure') {
        const errors = result.data?.errors as Record<string, string[] | undefined> | undefined;
        error = errors?.name?.[0] ?? String(result.data?.error ?? registry.common.forbidden);
      } else if (result.type === 'error') {
        error = result.error?.message ?? registry.common.forbidden;
      } else {
        await update();
      }
    };
  };
</script>

<Dialog bind:open title={s.renameTitle} size="sm">
  {#if transcription}
    <form id={formId} method="post" action="?/renameTranscription" novalidate use:enhance={submit}>
      <input type="hidden" name="id" value={transcription.id} />
      <Field label={s.name} {error} required>
        {#snippet children(control)}
          <Input
            {...control}
            name="name"
            value={transcription.name}
            autocomplete="off"
            class="font-serif text-base"
            required
            {@attach autoselect}
          />
        {/snippet}
      </Field>
    </form>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{registry.common.cancel}</Button>
    <Button type="submit" form={formId} variant="primary" loading={submitting}
      >{s.renameConfirm}</Button
    >
  {/snippet}
</Dialog>
