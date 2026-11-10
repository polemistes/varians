<script lang="ts">
  /** Write a note on a segment of the edition. */
  import CitationPicker from '$lib/components/bibliography/CitationPicker.svelte';
  import { Button, Dialog, Field, Textarea } from '$lib/components/ui';
  import type { CitationDraft } from '$lib/bibliography/types';
  import { editor as s } from '$lib/strings/editor';

  interface Props {
    open: boolean;
    segmentLabel: string;
    busy?: boolean;
    onsubmit: (text: string, citations: CitationDraft[]) => void;
    oncancel: () => void;
  }

  let { open = $bindable(), segmentLabel, busy = false, onsubmit, oncancel }: Props = $props();
  let text = $state('');
  let citations = $state<CitationDraft[]>([]);
  $effect(() => {
    if (open) {
      text = '';
      citations = [];
    }
  });
</script>

<Dialog
  bind:open
  title={`${s.noteTitle} ${segmentLabel}`}
  onOpenChange={(value) => {
    if (!value) oncancel();
  }}
>
  <Field label={s.conjecture.note}>
    {#snippet children(control)}
      <Textarea {...control} bind:value={text} rows={4} serif autofocus />
    {/snippet}
  </Field>
  <div class="mt-4"><CitationPicker bind:value={citations} /></div>
  {#snippet footer()}
    <Button variant="ghost" onclick={oncancel}>{s.conjecture.cancel}</Button>
    <Button
      variant="primary"
      loading={busy}
      disabled={!text.trim()}
      onclick={() => text.trim() && onsubmit(text.trim(), $state.snapshot(citations))}
      >{s.noteSave}</Button
    >
  {/snippet}
</Dialog>
