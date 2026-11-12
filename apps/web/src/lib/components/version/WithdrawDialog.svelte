<script lang="ts">
  /**
   * Withdraw Version…, for an edition and a transcript alike: which version,
   * of those not withdrawn (the latest chosen to begin with), and the note
   * readers will see at its address. A refusal stays in the window.
   */
  import { invalidateAll } from '$app/navigation';
  import { formatLocal } from '$lib/dates';
  import {
    Button,
    Dialog,
    Field,
    Notice,
    Select,
    Spinner,
    Textarea,
    toasts,
  } from '$lib/components/ui';
  import { recordActions } from '$lib/strings/record-actions';
  import { versions as v } from '$lib/strings/versions';

  /** The longest note the server takes. */
  const MAX_NOTE = 4000;

  interface Props {
    open?: boolean;
    kind: 'edition' | 'transcription';
    id: string;
  }

  let { open = $bindable(false), kind, id }: Props = $props();

  type Listed = { number: number; at: string; withdrawn: unknown };

  const base = $derived(
    `/api/${kind === 'edition' ? 'editions' : 'transcriptions'}/${encodeURIComponent(id)}`,
  );
  let standing = $state<Listed[] | null>(null);
  let failed = $state(false);
  let chosen = $state('');
  let note = $state('');
  let refusal = $state<string | null>(null);
  let submitting = $state(false);
  let opening = 0;

  $effect(() => {
    if (open) void prepare();
  });

  async function prepare() {
    const mine = ++opening;
    standing = null;
    failed = false;
    refusal = null;
    note = '';
    try {
      const response = await fetch(`${base}/versions`);
      if (!response.ok) throw new Error(response.statusText);
      const body = (await response.json()) as { versions: Listed[] };
      if (mine !== opening) return;
      // Newest first, as the server lists them: the latest that stands is chosen.
      standing = body.versions.filter((x) => !x.withdrawn);
      chosen = standing[0] ? String(standing[0].number) : '';
    } catch {
      if (mine === opening) failed = true;
    }
  }

  async function withdraw() {
    const number = Number(chosen);
    if (!number) return;
    submitting = true;
    try {
      const text = note.trim();
      const response = await fetch(`${base}/withdraw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ number, note: text === '' ? null : text }),
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        refusal = body?.message ?? recordActions.failed;
        return;
      }
      toasts.success(v.withdraw.done(number));
      open = false;
      await invalidateAll();
    } catch {
      refusal = recordActions.failed;
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog bind:open title={v.withdraw.title} description={v.withdraw.body} size="md">
  {#if failed}
    <Notice kind="error">{v.withdraw.failed}</Notice>
  {:else if !standing}
    <p class="flex items-center gap-2 text-ink-soft"><Spinner size="sm" /> {v.withdraw.loading}</p>
  {:else}
    <div class="space-y-4">
      <Field label={v.withdraw.which}>
        {#snippet children(control)}
          <Select
            {...control}
            bind:value={chosen}
            options={standing!.map((x) => ({
              value: String(x.number),
              label: v.withdraw.option(x.number, formatLocal(x.at)),
            }))}
          />
        {/snippet}
      </Field>
      <Field label={v.withdraw.note}>
        {#snippet children(control)}
          <Textarea {...control} bind:value={note} rows={4} maxlength={MAX_NOTE} />
        {/snippet}
      </Field>
      {#if refusal}<Notice kind="error">{refusal}</Notice>{/if}
    </div>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{recordActions.cancel}</Button>
    <Button variant="danger" loading={submitting} disabled={!chosen || !!refusal} onclick={withdraw}
      >{v.withdraw.verb}</Button
    >
  {/snippet}
</Dialog>
