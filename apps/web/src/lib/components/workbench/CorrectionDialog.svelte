<script lang="ts">
  /**
   * The hand and stage of a correction: the deletions and additions the
   * selected words carry are given the hand that made them and the layer of
   * correction they belong to. Both may stay unknown.
   */
  import type { WitnessHand } from '@varians/db';
  import { Button, Dialog, Field, Input, Select } from '$lib/components/ui';
  import type { CorrectionAttrs, CorrectionFound } from '$lib/editor/marks';
  import { handOptions, handValue } from '$lib/workbench/hands';
  import { workbench as t } from '$lib/strings/workbench';

  interface Props {
    open: boolean;
    hands: WitnessHand[];
    /** The correction as the words carry it. */
    initial: CorrectionFound | null;
    onsave: (attrs: CorrectionAttrs) => void;
    oncancel: () => void;
  }

  let { open = $bindable(false), hands, initial, onsave, oncancel }: Props = $props();

  let hand = $state('');
  let stage = $state('');

  $effect(() => {
    if (open) {
      hand = initial?.hand ?? '';
      stage = initial?.seq !== undefined ? String(initial.seq) : '';
    }
  });

  const options = $derived(handOptions(hands, t.hands, initial?.hand));
  const kinds = $derived((initial?.kinds ?? []).map((k) => t.correction.kinds[k] ?? k).join(', '));

  function save(event: Event) {
    event.preventDefault();
    const attrs: CorrectionAttrs = {};
    const chosen = handValue(hand, hands);
    if (chosen) attrs.hand = chosen;
    const n = Number.parseInt(stage, 10);
    if (Number.isInteger(n) && n >= 1) attrs.seq = n;
    onsave(attrs);
    open = false;
  }
</script>

<Dialog
  bind:open
  title={t.correction.title}
  size="sm"
  onOpenChange={(next) => {
    if (!next) oncancel();
  }}
>
  <form id="wb-correction" class="flex flex-col gap-4" onsubmit={save}>
    {#if kinds}<p class="font-sans text-sm text-ink-soft">{kinds}</p>{/if}
    <Field label={t.correction.hand}>
      {#snippet children(control)}
        <Select {...control} bind:value={hand} {options} />
      {/snippet}
    </Field>
    <Field label={t.correction.stage} hint={t.correction.stageHint}>
      {#snippet children(control)}
        <Input {...control} type="number" min="1" max="9" bind:value={stage} class="w-24" />
      {/snippet}
    </Field>
  </form>
  {#snippet footer()}
    <Button
      variant="ghost"
      onclick={() => {
        oncancel();
        open = false;
      }}>{t.correction.cancel}</Button
    >
    <Button type="submit" form="wb-correction" variant="primary">{t.correction.save}</Button>
  {/snippet}
</Dialog>
