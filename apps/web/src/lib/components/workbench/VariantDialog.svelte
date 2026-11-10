<script lang="ts">
  /**
   * A variant the manuscript notes for the selected words: its
   * reading, where it stands and, if known, the hand. The words keep their
   * text; the variant is a mark on them.
   */
  import type { WitnessHand } from '@varians/db';
  import { Button, Dialog, Field, Input, Select } from '$lib/components/ui';
  import type { VariantAttrs, VariantPlace } from '$lib/editor/marks';
  import { handOptions, handValue } from '$lib/workbench/hands';
  import { workbench as t } from '$lib/strings/workbench';

  interface Props {
    open: boolean;
    /** The words the variant is for, as the text has them. */
    words: string;
    /** The witness's hands, to name the one that wrote the variant. */
    hands: WitnessHand[];
    /** The variant being changed, when the words carry one already. */
    initial: VariantAttrs | null;
    onsave: (variant: VariantAttrs) => void;
    oncancel: () => void;
  }

  let { open = $bindable(false), words, hands, initial, onsave, oncancel }: Props = $props();

  const options = $derived(handOptions(hands, t.hands, initial?.hand));

  let reading = $state('');
  let place = $state<string>('margin');
  let hand = $state('');

  $effect(() => {
    if (open) {
      reading = initial?.reading ?? '';
      place = initial?.place ?? 'margin';
      hand = initial?.hand ?? '';
    }
  });

  function save(event: Event) {
    event.preventDefault();
    const variant: VariantAttrs = { reading: reading.trim(), place: place as VariantPlace };
    const chosen = handValue(hand.trim(), hands);
    if (chosen) variant.hand = chosen;
    onsave(variant);
    open = false;
  }
</script>

<Dialog
  bind:open
  title={t.variant.title}
  description={t.variant.description}
  size="sm"
  onOpenChange={(next) => {
    if (!next) oncancel();
  }}
>
  <form id="wb-variant" class="flex flex-col gap-4" onsubmit={save}>
    <p class="font-sans text-sm text-ink-soft">
      {t.variant.words}: <span class="font-serif text-base text-ink" dir="auto">{words}</span>
    </p>
    <Field label={t.variant.reading} hint={t.variant.readingHint}>
      {#snippet children(control)}
        <Input
          {...control}
          bind:value={reading}
          autocomplete="off"
          spellcheck="false"
          dir="auto"
          class="font-serif text-base"
        />
      {/snippet}
    </Field>
    <Field label={t.variant.place}>
      {#snippet children(control)}
        <Select
          {...control}
          bind:value={place}
          options={Object.entries(t.variant.places).map(([value, label]) => ({ value, label }))}
        />
      {/snippet}
    </Field>
    <Field label={t.variant.hand}>
      {#snippet children(control)}
        <Select {...control} bind:value={hand} {options} />
      {/snippet}
    </Field>
  </form>
  {#snippet footer()}
    <Button
      variant="ghost"
      onclick={() => {
        oncancel();
        open = false;
      }}>{t.variant.cancel}</Button
    >
    <Button type="submit" form="wb-variant" variant="primary">{t.variant.save}</Button>
  {/snippet}
</Dialog>
