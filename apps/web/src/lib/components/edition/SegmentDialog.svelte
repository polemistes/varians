<script lang="ts">
  /** Set the segment that begins at a word: a label of the work's scheme. */
  import { Button, Dialog, Field, Input } from '$lib/components/ui';
  import { editor as s } from '$lib/strings/editor';

  interface Props {
    open: boolean;
    /** The label shown now, or a proposal. */
    initial: string;
    /** Whether the word begins a segment already, so that the start can be removed. */
    hasStart: boolean;
    error?: string | null;
    busy?: boolean;
    onsubmit: (label: string) => void;
    onremove: () => void;
    oncancel: () => void;
  }

  let { open = $bindable(), initial, hasStart, error = null, busy = false, onsubmit, onremove, oncancel }: Props = $props();

  let label = $state('');
  let filledFor = '';
  $effect(() => {
    if (open && initial !== filledFor) {
      filledFor = initial;
      label = initial;
    }
  });
</script>

<Dialog bind:open title={s.workspace.segmentTitle} size="sm" onOpenChange={(value) => { if (!value) oncancel(); }}>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      if (label.trim()) onsubmit(label.trim());
    }}
  >
    <Field label={s.workspace.segmentLabel} hint={s.workspace.segmentHint(initial || '1.1')} {error}>
      {#snippet children(control)}
        <Input {...control} bind:value={label} class="font-serif" autofocus />
      {/snippet}
    </Field>
  </form>
  {#snippet footer()}
    {#if hasStart}<Button variant="danger" onclick={onremove}>{s.workspace.segmentRemove}</Button>{/if}
    <Button variant="ghost" onclick={oncancel}>{s.conjecture.cancel}</Button>
    <Button variant="primary" loading={busy} disabled={!label.trim()} onclick={() => label.trim() && onsubmit(label.trim())}>{s.workspace.segmentSet}</Button>
  {/snippet}
</Dialog>
