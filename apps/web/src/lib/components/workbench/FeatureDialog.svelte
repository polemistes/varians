<script lang="ts">
  /** A zone that marks no words (PLAN 4.2): what kind of feature it is, and a description. */
  import { Button, Dialog, Field, Input, Select } from '$lib/components/ui';
  import { workbench as t } from '$lib/strings/workbench';

  interface Props {
    open: boolean;
    onsave: (feature: { kind: string; description?: string }) => void;
    oncancel: () => void;
  }

  let { open = $bindable(false), onsave, oncancel }: Props = $props();

  let kind = $state('figure');
  let description = $state('');

  $effect(() => {
    if (open) {
      kind = 'figure';
      description = '';
    }
  });

  function save(event: Event) {
    event.preventDefault();
    const text = description.trim();
    onsave(text ? { kind, description: text } : { kind });
    open = false;
  }
</script>

<Dialog
  bind:open
  title={t.feature.title}
  size="sm"
  onOpenChange={(next) => {
    if (!next) oncancel();
  }}
>
  <form id="wb-feature" class="flex flex-col gap-4" onsubmit={save}>
    <Field label={t.feature.kind}>
      {#snippet children(control)}
        <Select {...control} bind:value={kind} options={Object.entries(t.feature.kinds).map(([value, label]) => ({ value, label }))} />
      {/snippet}
    </Field>
    <Field label={t.feature.description}>
      {#snippet children(control)}
        <Input {...control} bind:value={description} autocomplete="off" />
      {/snippet}
    </Field>
  </form>
  {#snippet footer()}
    <Button
      variant="ghost"
      onclick={() => {
        oncancel();
        open = false;
      }}>{t.feature.cancel}</Button
    >
    <Button type="submit" form="wb-feature" variant="primary">{t.feature.save}</Button>
  {/snippet}
</Dialog>
