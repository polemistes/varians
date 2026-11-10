<script lang="ts">
  /** Insert something at the caret that is not a word of the text: a speaker, a heading, a marginal note, a lacuna. */
  import { Button, Dialog, Field, Input, Select } from '$lib/components/ui';
  import { editor } from '$lib/strings/editor';

  const t = editor.dialogs.insert;

  export type InsertKind = 'speaker' | 'head' | 'stage' | 'margin' | 'lacuna';

  interface Props {
    open: boolean;
    kind: InsertKind;
    oninsert: (kind: InsertKind, text: string) => void;
    oncancel: () => void;
  }

  let { open = $bindable(), kind = $bindable(), oninsert, oncancel }: Props = $props();
  let text = $state('');
  $effect(() => {
    if (open) text = '';
  });

  const kinds = [
    { value: 'speaker', label: t.speaker },
    { value: 'head', label: t.head },
    { value: 'stage', label: t.stage },
    { value: 'margin', label: t.margin },
    { value: 'lacuna', label: t.lacuna },
  ];
  const label = $derived(kind === 'lacuna' ? t.extent : t.text);
  const valid = $derived(kind === 'lacuna' || text.trim().length > 0);
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
      if (valid) oninsert(kind, text.trim());
    }}
  >
    <Field label={t.kind}>
      {#snippet children(control)}<Select
          {...control}
          bind:value={kind}
          options={kinds}
        />{/snippet}
    </Field>
    <Field {label} hint={kind === 'lacuna' ? t.lacunaHint : undefined}>
      {#snippet children(control)}<Input
          {...control}
          bind:value={text}
          class="font-serif"
          dir="auto"
          autofocus
        />{/snippet}
    </Field>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={oncancel}>{editor.dialogs.cancel}</Button>
    <Button variant="primary" disabled={!valid} onclick={() => valid && oninsert(kind, text.trim())}
      >{t.insert}</Button
    >
  {/snippet}
</Dialog>
