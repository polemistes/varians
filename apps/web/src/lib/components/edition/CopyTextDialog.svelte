<script lang="ts">
  /**
   * Copy the text of a range of segments from a transcript of the conspectus
   * into the edition. The window asks the server how many segments the range
   * brings and how many of them the edition has text for, which the copy
   * replaces, and says so before the editor copies.
   */
  import { Button, Dialog, Field, Input, Notice, Select } from '$lib/components/ui';
  import { editor as s } from '$lib/strings/editor';

  export interface CopyRange {
    transcriptionId: string;
    from: string;
    to: string;
  }

  interface Props {
    open: boolean;
    editionId: string;
    /** The transcripts of the conspectus, by siglum and witness. */
    transcripts: { transcriptionId: string; siglum: string; witnessName: string }[];
    busy?: boolean;
    error?: string | null;
    oncopy: (range: CopyRange) => void;
    oncancel: () => void;
  }

  let {
    open = $bindable(),
    editionId,
    transcripts,
    busy = false,
    error = null,
    oncopy,
    oncancel,
  }: Props = $props();

  const t = s.dialogs.copyText;
  let transcriptionId = $state('');
  let from = $state('');
  let to = $state('');
  let preview = $state<{ segments: number; replaced: number } | null>(null);
  let problem = $state<string | null>(null);
  let counting = $state(false);

  $effect(() => {
    if (open && !transcripts.some((x) => x.transcriptionId === transcriptionId))
      transcriptionId = transcripts[0]?.transcriptionId ?? '';
  });

  // What the range brings, asked again a moment after the choice last changed, and each time the window opens.
  $effect(() => {
    if (!open || !transcriptionId) return;
    const query = new URLSearchParams({ transcription: transcriptionId, from, to });
    let stale = false;
    counting = true;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/editions/${editionId}/copy-text?${query}`);
        const data = (await response.json().catch(() => null)) as {
          segments: number;
          replaced: number;
          message?: string;
        } | null;
        if (stale) return;
        if (response.ok && data) {
          preview = { segments: data.segments, replaced: data.replaced };
          problem = null;
        } else {
          preview = null;
          problem = data?.message ?? t.failed;
        }
      } catch {
        if (!stale) {
          preview = null;
          problem = t.failed;
        }
      } finally {
        if (!stale) counting = false;
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });

  const ready = $derived(!counting && preview !== null && preview.segments > 0);

  function submit() {
    if (ready && !busy) oncopy({ transcriptionId, from: from.trim(), to: to.trim() });
  }
</script>

<Dialog
  bind:open
  title={t.title}
  size="sm"
  onOpenChange={(value) => {
    if (!value) oncancel();
  }}
>
  <form
    class="flex flex-col gap-4"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <Field label={t.transcript}>
      {#snippet children(control)}
        <Select
          {...control}
          bind:value={transcriptionId}
          options={transcripts.map((x) => ({
            value: x.transcriptionId,
            label: `${x.siglum}: ${x.witnessName}`,
          }))}
        />
      {/snippet}
    </Field>
    <div class="grid grid-cols-2 gap-3">
      <Field label={t.from}>
        {#snippet children(control)}
          <Input {...control} bind:value={from} class="font-serif" autocomplete="off" />
        {/snippet}
      </Field>
      <Field label={t.to}>
        {#snippet children(control)}
          <Input {...control} bind:value={to} class="font-serif" autocomplete="off" />
        {/snippet}
      </Field>
    </div>
    <div class="min-h-12 font-sans text-sm" aria-live="polite" data-testid="copy-text-count">
      {#if counting && preview === null && problem === null}
        <p class="text-ink-muted">{t.counting}</p>
      {:else if problem}
        <Notice kind="error">{problem}</Notice>
      {:else if preview && preview.segments === 0}
        <p class="text-ink-soft">{t.nothing}</p>
      {:else if preview && preview.replaced > 0}
        <Notice kind="warning"
          >{t.segments(preview.segments)} {t.replaced(preview.replaced, preview.segments)}</Notice
        >
      {:else if preview}
        <p class="text-ink">{t.segments(preview.segments)}</p>
      {/if}
    </div>
    {#if error}<Notice kind="error">{error}</Notice>{/if}
    <!-- Enter in a field copies, as the button does. -->
    <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={oncancel}>{t.cancel}</Button>
    <Button variant="primary" loading={busy} disabled={!ready} onclick={submit}>{t.copy}</Button>
  {/snippet}
</Dialog>
