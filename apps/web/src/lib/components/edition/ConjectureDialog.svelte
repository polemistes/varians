<script lang="ts">
  /**
   * Register a conjecture at a place of the edition: the words it concerns
   * are given; the editor types the reading, names the proposer, and chooses
   * whether to adopt it at once.
   */
  import CitationPicker from '$lib/components/bibliography/CitationPicker.svelte';
  import { Button, Dialog, Field, Input, Select, Textarea } from '$lib/components/ui';
  import type { CitationDraft } from '$lib/bibliography/types';
  import { editor as s } from '$lib/strings/editor';

  export type ConjectureKind = 'substitution' | 'deletion' | 'addition' | 'lacuna';

  export interface ConjectureDraft {
    segmentLabel: string;
    /** The edition's words the conjecture concerns; empty at an insertion point. */
    lemma: string;
    kind: ConjectureKind;
    reading: string;
    proposer: string;
    note: string;
    extent: string;
    /** Works that propose or discuss it. */
    citations: CitationDraft[];
  }

  interface Props {
    open: boolean;
    draft: ConjectureDraft | null;
    busy?: boolean;
    onsubmit: (draft: ConjectureDraft, adopt: boolean) => void;
    oncancel: () => void;
  }

  let { open = $bindable(), draft, busy = false, onsubmit, oncancel }: Props = $props();

  let kind = $state<ConjectureKind>('substitution');
  let reading = $state('');
  let proposer = $state('');
  let note = $state('');
  let extent = $state('');
  let citations = $state<CitationDraft[]>([]);

  // A new draft fills the form once.
  let filledFor: ConjectureDraft | null = null;
  $effect(() => {
    if (draft && draft !== filledFor) {
      filledFor = draft;
      kind = draft.kind;
      reading = draft.reading;
      proposer = draft.proposer;
      note = draft.note;
      extent = draft.extent;
      citations = draft.citations.map((c) => ({ ...c }));
    }
  });

  const kinds = $derived(
    (draft?.lemma
      ? (['substitution', 'deletion', 'lacuna'] as const)
      : (['addition', 'lacuna'] as const)
    ).map((value) => ({ value, label: s.conjecture[value] })),
  );

  const needsReading = $derived(kind === 'substitution' || kind === 'addition');
  const valid = $derived(!needsReading || reading.trim().length > 0);

  function submit(adopt: boolean) {
    if (!draft || !valid) return;
    onsubmit(
      { ...draft, kind, reading: needsReading ? reading.trim() : '', proposer: proposer.trim(), note: note.trim(), extent: extent.trim(), citations: $state.snapshot(citations) },
      adopt,
    );
  }
</script>

<Dialog bind:open title={s.conjecture.title} description={draft ? `${draft.segmentLabel}${draft.lemma ? `  ${draft.lemma}` : ''}` : ''} onOpenChange={(value) => { if (!value) oncancel(); }}>
  <form
    class="flex flex-col gap-4"
    onsubmit={(event) => {
      event.preventDefault();
      submit(true);
    }}
  >
    <Field label={s.conjecture.kind}>
      {#snippet children(control)}
        <Select {...control} bind:value={kind} options={kinds} />
      {/snippet}
    </Field>
    {#if needsReading}
      <Field label={s.conjecture.reading} hint={kind === 'substitution' ? undefined : s.conjecture.readingHint}>
        {#snippet children(control)}
          <Input {...control} bind:value={reading} class="font-serif" dir="auto" autofocus />
        {/snippet}
      </Field>
    {/if}
    {#if kind === 'lacuna'}
      <Field label={s.conjecture.extent}>
        {#snippet children(control)}
          <Input {...control} bind:value={extent} />
        {/snippet}
      </Field>
    {/if}
    <Field label={s.conjecture.proposer}>
      {#snippet children(control)}
        <Input {...control} bind:value={proposer} />
      {/snippet}
    </Field>
    <CitationPicker bind:value={citations} />
    <Field label={s.conjecture.note}>
      {#snippet children(control)}
        <Textarea {...control} bind:value={note} rows={2} />
      {/snippet}
    </Field>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={oncancel}>{s.conjecture.cancel}</Button>
    <Button variant="secondary" disabled={!valid || busy} onclick={() => submit(false)}>{s.conjecture.registerOnly}</Button>
    <Button variant="primary" disabled={!valid} loading={busy} onclick={() => submit(true)}>{s.conjecture.registerAdopt}</Button>
  {/snippet}
</Dialog>
