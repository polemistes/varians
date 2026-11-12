<script lang="ts">
  /**
   * Publish…, for an edition and a transcript alike: the window named after
   * the action, which says which number the version will have, lists the
   * changes since the version before and asks for the note on the version.
   * Pending saves are made first, so that the changes listed and the version
   * published are the record as it stands. A refusal stays in the window.
   */
  import { invalidateAll } from '$app/navigation';
  import type { VersionChanges } from '@varians/db';
  import { Button, Dialog, Field, Notice, Spinner, Textarea, toasts } from '$lib/components/ui';
  import { recordActions } from '$lib/strings/record-actions';
  import { versions as v } from '$lib/strings/versions';
  import VersionChangesList from './VersionChangesList.svelte';

  /** The longest note the server takes. */
  const MAX_NOTE = 4000;

  interface Props {
    open?: boolean;
    kind: 'edition' | 'transcription';
    id: string;
    /** Saves what is pending before the changes are read. */
    flush?: () => Promise<void>;
    /** After a version is made, before the page's data are loaded again. */
    onpublished?: (number: number) => void;
  }

  let { open = $bindable(false), kind, id, flush, onpublished }: Props = $props();

  const base = $derived(
    `/api/${kind === 'edition' ? 'editions' : 'transcriptions'}/${encodeURIComponent(id)}`,
  );
  let next = $state<{ number: number; changes: VersionChanges } | null>(null);
  let failed = $state(false);
  let note = $state('');
  let refusal = $state<string | null>(null);
  let submitting = $state(false);
  /** Counts the openings, so that an answer to an earlier one is dropped. */
  let opening = 0;

  $effect(() => {
    if (open) void prepare();
  });

  async function prepare() {
    const mine = ++opening;
    next = null;
    failed = false;
    refusal = null;
    note = '';
    try {
      await flush?.();
      const response = await fetch(`${base}/changes`);
      if (!response.ok) throw new Error(response.statusText);
      const body = (await response.json()) as { number: number; changes: VersionChanges };
      if (mine === opening) next = body;
    } catch {
      if (mine === opening) failed = true;
    }
  }

  async function publish() {
    if (!next) return;
    submitting = true;
    try {
      await flush?.();
      const text = note.trim();
      const response = await fetch(`${base}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: text === '' ? null : text }),
      });
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        number?: number;
      } | null;
      if (!response.ok) {
        refusal = body?.message ?? recordActions.failed;
        return;
      }
      const number = body?.number ?? next.number;
      toasts.success(v.publish.done(number));
      open = false;
      onpublished?.(number);
      await invalidateAll();
    } catch {
      refusal = recordActions.failed;
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog
  bind:open
  title={kind === 'edition' ? v.publish.edition : v.publish.transcription}
  description={next ? v.publish.body(kind, next.number) : undefined}
  size="md"
>
  {#if failed}
    <Notice kind="error">{v.changes.failed}</Notice>
  {:else if !next}
    <p class="flex items-center gap-2 text-ink-soft"><Spinner size="sm" /> {v.changes.loading}</p>
  {:else}
    <div class="space-y-4">
      {#if kind === 'edition'}<p class="text-ink-soft">{v.publish.withTranscripts}</p>{/if}
      <section class="space-y-1.5">
        <h3 class="text-xs font-medium text-ink-muted">
          {v.changes.since(next.number > 1 ? next.number - 1 : null)}
        </h3>
        <VersionChangesList changes={next.changes} />
      </section>
      <Field label={v.publish.note}>
        {#snippet children(control)}
          <Textarea {...control} bind:value={note} rows={4} maxlength={MAX_NOTE} />
        {/snippet}
      </Field>
      {#if refusal}<Notice kind="error">{refusal}</Notice>{/if}
    </div>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{recordActions.cancel}</Button>
    <Button variant="primary" loading={submitting} disabled={!next || !!refusal} onclick={publish}
      >{v.publish.verb}</Button
    >
  {/snippet}
</Dialog>
