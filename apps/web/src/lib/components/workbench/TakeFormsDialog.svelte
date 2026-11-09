<script lang="ts">
  /**
   * Take normalized forms from another text: the other transcriptions and the
   * editions of the transcription's works, chosen here; the words in scope
   * whose letters agree take that text's forms.
   */
  import { Button, Dialog, Notice, Select, Spinner, toasts } from '$lib/components/ui';
  import { workbench } from '$lib/strings/workbench';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    open: boolean;
  }

  let { wb, open = $bindable(false) }: Props = $props();

  const t = workbench.tools.take;

  type Source = { kind: 'transcription' | 'edition'; id: string; label: string };
  let sources = $state<Source[] | null>(null);
  let chosen = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!open) return;
    sources = null;
    error = null;
    fetch(`/api/transcriptions/${wb.id}/sources`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { sources: Source[] }) => {
        sources = data.sources;
        chosen = data.sources[0] ? `${data.sources[0].kind}:${data.sources[0].id}` : '';
      })
      .catch(() => {
        sources = [];
        error = t.failed;
      });
  });

  async function take() {
    const [kind, id] = chosen.split(':') as ['transcription' | 'edition', string];
    if (!id) return;
    busy = true;
    const outcome = await wb.takeFormsFrom({ kind, id });
    busy = false;
    if (!outcome) {
      error = t.failed;
      return;
    }
    toasts.success(t.done(outcome.taken, outcome.differing));
    open = false;
  }
</script>

<Dialog bind:open title={t.title} description={t.description(wb.hasRange && wb.selection.ids.length ? wb.selection.ids.length : null)} size="md">
  {#if sources === null}
    <p class="flex items-center gap-2 text-sm text-ink-muted"><Spinner size="sm" /> {t.loading}</p>
  {:else if sources.length === 0}
    <p class="text-sm text-ink-soft">{t.none}</p>
  {:else}
    <Select bind:value={chosen} aria-label={t.source} options={sources.map((s) => ({ value: `${s.kind}:${s.id}`, label: `${s.kind === 'edition' ? t.edition : t.transcription}: ${s.label}` }))} />
  {/if}
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{t.cancel}</Button>
    <Button variant="primary" loading={busy} disabled={!chosen} onclick={() => void take()}>{t.take}</Button>
  {/snippet}
</Dialog>
