<script lang="ts">
  /**
   * A record of the registry or one's own made in a window over a page: the
   * fields post to a form action, which answers with the record made. The
   * window closes on success and hands the answer over; the page behind it
   * keeps what it holds, nothing being loaded again.
   */
  import type { Snippet } from 'svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { Button, Dialog, Notice } from '$lib/components/ui';
  import { edition } from '$lib/strings/edition';
  import { registry } from '$lib/strings/registry';

  type Errors = Record<string, string[] | undefined>;

  interface Props {
    open?: boolean;
    title: string;
    /** One sentence under the title. */
    description?: string;
    action: string;
    saveLabel?: string;
    /** The fields, given the errors of the last attempt. */
    fields: Snippet<[Errors]>;
    onsaved: (data: Record<string, unknown>) => void;
  }

  let {
    open = $bindable(false),
    title,
    description,
    action,
    saveLabel = edition.save,
    fields,
    onsaved,
  }: Props = $props();

  const uid = $props.id();
  const formId = `record-window-${uid}`;
  let submitting = $state(false);
  let errors = $state<Errors>({});
  let message = $state<string | null>(null);

  $effect(() => {
    if (open) {
      errors = {};
      message = null;
    }
  });

  const submit: SubmitFunction = () => {
    submitting = true;
    message = null;
    return async ({ result }) => {
      submitting = false;
      if (result.type === 'success') {
        open = false;
        onsaved(result.data ?? {});
      } else if (result.type === 'failure') {
        errors = (result.data?.errors as Errors | undefined) ?? {};
        message =
          (result.data?.error as string | null | undefined) ??
          (Object.values(errors).some(Boolean) ? registry.common.invalidForm : null);
      } else if (result.type === 'error') {
        message = result.error?.message ?? registry.common.forbidden;
      }
    };
  };
</script>

<Dialog bind:open {title} {description} size="lg">
  <form
    id={formId}
    method="post"
    {action}
    novalidate
    class="flex flex-col gap-6"
    use:enhance={submit}
  >
    {#if message}<Notice kind="error">{message}</Notice>{/if}
    {@render fields(errors)}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{edition.cancel}</Button>
    <Button type="submit" form={formId} variant="primary" loading={submitting}>{saveLabel}</Button>
  {/snippet}
</Dialog>
