<script lang="ts">
  /**
   * The one window that asks before anything is deleted, removed, published
   * or taken back. Its title is the action's name, its body says what goes
   * with it, its buttons are the verb and Cancel. The deed is a form action
   * (`action`, with hidden `fields`), or a function (`onconfirm`) that
   * returns a refusal to show, if any.
   */
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { recordActions } from '$lib/strings/record-actions';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Notice from './Notice.svelte';
  import { toasts } from './toast.svelte';

  interface Props {
    open?: boolean;
    title: string;
    description: string;
    /** The verb: Delete, Remove, Publish, Unpublish. */
    confirmLabel: string;
    /** Danger for what cannot be undone; primary for publishing. */
    tone?: 'danger' | 'primary';
    /** The form action that does the deed, such as ?/deleteConjecture; or else `onconfirm`. */
    action?: string;
    /** Hidden fields sent with it. */
    fields?: Record<string, string>;
    /** Done instead of a form action; a string returned is a refusal, shown in the window. */
    onconfirm?: () => Promise<string | null | void>;
    /** Shown when the action succeeds or redirects; an action's own `message` wins. */
    done?: string;
  }

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel,
    tone = 'danger',
    action,
    fields = {},
    onconfirm,
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
        refusal = String(result.data?.error ?? result.data?.message ?? recordActions.failed);
        return;
      }
      if (result.type === 'error') {
        toasts.error(result.error?.message ?? recordActions.failed);
        return;
      }
      const message =
        result.type === 'success' ? (result.data?.message as string | undefined) : undefined;
      if (message ?? done) toasts.success((message ?? done)!);
      open = false;
      await update();
    };
  };

  async function confirmed() {
    submitting = true;
    try {
      const refused = await onconfirm!();
      if (refused) {
        refusal = refused;
        return;
      }
      if (done) toasts.success(done);
      open = false;
    } catch (cause) {
      refusal = cause instanceof Error ? cause.message : recordActions.failed;
    } finally {
      submitting = false;
    }
  }
</script>

{#snippet refused()}
  <Notice kind="error">{refusal}</Notice>
{/snippet}

<!-- The body is the description; a refusal, when there is one, stands under it. -->
<Dialog bind:open {title} {description} size="sm" children={refusal ? refused : undefined}>
  {#snippet footer()}
    {#if action}
      <form id={formId} method="post" {action} use:enhance={submit} class="hidden">
        {#each Object.entries(fields) as [name, value] (name)}
          <input type="hidden" {name} {value} />
        {/each}
      </form>
    {/if}
    <Button variant="ghost" onclick={() => (open = false)}>{recordActions.cancel}</Button>
    {#if action}
      <Button type="submit" form={formId} variant={tone} loading={submitting} disabled={!!refusal}>
        {confirmLabel}
      </Button>
    {:else}
      <Button variant={tone} loading={submitting} disabled={!!refusal} onclick={confirmed}>
        {confirmLabel}
      </Button>
    {/if}
  {/snippet}
</Dialog>
