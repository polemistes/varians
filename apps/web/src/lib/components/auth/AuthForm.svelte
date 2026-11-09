<script lang="ts">
  import type { Snippet } from 'svelte';
  import { enhance } from '$app/forms';
  import { Button, Notice } from '$lib/components/ui';

  /** What the auth actions return on failure. */
  export interface AuthFailure {
    values?: Record<string, string | undefined>;
    errors?: Record<string, string[] | undefined> & { form?: string };
  }

  interface Props {
    /** The whole-form message, shown above the fields. */
    formError?: string;
    submitLabel: string;
    /** The fields. */
    children: Snippet;
    /** Text beside the button, such as the link to the other form. */
    aside?: Snippet;
  }

  let { formError, submitLabel, children, aside }: Props = $props();
  let submitting = $state(false);
</script>

<form
  method="post"
  class="flex flex-col gap-5"
  novalidate
  use:enhance={() => {
    submitting = true;
    return async ({ update }) => {
      submitting = false;
      await update();
    };
  }}
>
  {#if formError}
    <Notice kind="error">{formError}</Notice>
  {/if}
  {@render children()}
  <div class="flex flex-wrap items-center justify-between gap-4 pt-2">
    <Button type="submit" variant="primary" loading={submitting}>{submitLabel}</Button>
    {#if aside}
      <p class="font-sans text-sm text-ink-soft">{@render aside()}</p>
    {/if}
  </div>
</form>
