<script lang="ts">
  /**
   * Pages without images, from a label pattern (1r-12v, p. 1-20, col. i-iv,
   * or a list), with a live count and the first and last labels it makes.
   * The browser expands the pattern with the same code as the server.
   */
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { Button, Field, Input, toasts } from '$lib/components/ui';
  import { pageStrings as t } from '$lib/strings/pages';
  import { actionUrl, failureMessage } from './client';
  import { expandLabels } from './labels';

  interface Failure {
    errors?: { labels?: string[] };
    values?: { labels?: string };
  }

  interface Props {
    /** The add action's answer when the form was sent without script and failed. */
    failure?: Failure | null;
    /** The witness is a roll: its pages are columns, and the example says so. */
    roll?: boolean;
    /** The pages screen whose form action receives the labels; the current page when empty. */
    base?: string;
    /** After the pages are added: the list is loaded again. */
    onchanged?: () => Promise<void> | void;
  }

  let { failure = null, roll = false, base = '', onchanged = invalidateAll }: Props = $props();

  let spec = $state(untrack(() => failure?.values?.labels ?? ''));
  let error = $state<string | null>(untrack(() => failure?.errors?.labels?.[0] ?? null));
  let submitting = $state(false);

  const expanded = $derived(spec.trim() === '' ? null : expandLabels(spec));
  const count = $derived(expanded?.ok ? expanded.labels.length : 0);
  const preview = $derived.by(() => {
    if (!expanded) return '';
    if (!expanded.ok) return expanded.error;
    return t.add.preview(expanded.labels.length, expanded.labels[0]!, expanded.labels.at(-1)!);
  });
</script>

<section
  aria-labelledby="add-pages-heading"
  class="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 font-sans"
>
  <div>
    <h2 id="add-pages-heading" class="text-sm font-semibold text-ink">{t.add.title}</h2>
  </div>
  <form
    method="post"
    action={actionUrl('add', base)}
    novalidate
    class="flex flex-col gap-2"
    use:enhance={({ cancel }) => {
      if (!expanded || !expanded.ok) {
        error = expanded?.error ?? t.labels.required;
        cancel();
        return;
      }
      submitting = true;
      return async ({ result }) => {
        submitting = false;
        if (result.type === 'success') {
          spec = '';
          const message = (result.data as { message?: string } | undefined)?.message;
          await onchanged();
          if (message) toasts.success(message);
        } else {
          error = failureMessage(result);
        }
      };
    }}
  >
    <div class="flex items-end gap-2">
      <Field label={t.add.labels} {error} class="min-w-0 flex-1">
        {#snippet children(control)}
          <Input
            {...control}
            name="labels"
            bind:value={spec}
            placeholder={roll ? t.add.placeholderRoll : t.add.placeholder}
            autocomplete="off"
            spellcheck="false"
            required
            oninput={() => (error = null)}
          />
        {/snippet}
      </Field>
      <Button type="submit" variant="secondary" loading={submitting}>
        {t.add.submit(count)}
      </Button>
    </div>
    <p
      class={['min-h-4 text-xs', expanded && !expanded.ok ? 'text-ink-muted' : 'text-ink-soft']}
      aria-live="polite"
    >
      {#if preview}{preview}{:else}{t.add.labelsHint}{/if}
    </p>
  </form>
</section>
