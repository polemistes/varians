<script lang="ts">
  import { untrack } from 'svelte';
  import { Field, Input, Select, Textarea } from '$lib/components/ui';
  import { MATERIAL_OTHER, WITNESS_CATEGORIES, WITNESS_FORMATS, WITNESS_MATERIALS } from '$lib/registry/witness';
  import { registry } from '$lib/strings/registry';
  import HandsField from './HandsField.svelte';
  import RegistrySearch from './RegistrySearch.svelte';

  interface Props {
    /** What the form shows at first: the witness's fields, or what was sent. */
    values?: Record<string, string | null | undefined>;
    errors?: Record<string, string[] | undefined>;
    /** Show existing witnesses as the name and shelfmark are typed (a new witness). */
    search?: boolean;
  }

  let { values = {}, errors = {}, search = false }: Props = $props();

  const s = registry.witness;
  const categoryOptions = WITNESS_CATEGORIES.map((c) => ({
    value: c,
    label: s.categories[c] ?? c,
  }));
  const formatOptions = WITNESS_FORMATS.map((f) => ({ value: f, label: s.formats[f] ?? f }));
  const materialOptions = [
    { value: '', label: '' },
    ...WITNESS_MATERIALS.map((m) => ({ value: m, label: s.materials[m] ?? m })),
    { value: MATERIAL_OTHER, label: s.materials[MATERIAL_OTHER] ?? MATERIAL_OTHER },
  ];
  // The initial values only; the inputs own them from here on.
  let name = $state(untrack(() => values.name ?? ''));
  let category = $state(untrack(() => values.category || 'manuscript'));
  let material = $state(untrack(() => values.material ?? ''));
  let shelfmark = $state(untrack(() => values.shelfmark ?? ''));

  const text = (key: string) => values[key] ?? '';
</script>

{#snippet line(key: string, label: string, serif = false)}
  <Field {label} error={errors[key]}>
    {#snippet children(control)}
      <Input
        {...control}
        name={key}
        value={text(key)}
        autocomplete="off"
        class={serif ? 'font-serif text-base' : undefined}
      />
    {/snippet}
  </Field>
{/snippet}

<div class="flex flex-col gap-5">
  <div class="flex flex-col gap-2">
    <Field label={s.name} error={errors.name} required>
      {#snippet children(control)}
        <Input
          {...control}
          name="name"
          bind:value={name}
          autocomplete="off"
          class="font-serif text-base"
          required
        />
      {/snippet}
    </Field>
    {#if search}<RegistrySearch kind="witness" queries={[name, shelfmark]} />{/if}
  </div>

  <div class="grid gap-5 sm:grid-cols-2">
    <Field label={s.siglum} error={errors.siglum} required>
      {#snippet children(control)}
        <Input
          {...control}
          name="siglum"
          value={text('siglum')}
          autocomplete="off"
          class="font-serif text-base"
          required
          maxlength={40}
        />
      {/snippet}
    </Field>
    <Field label={s.category} error={errors.category}>
      {#snippet children(control)}
        <Select {...control} name="category" bind:value={category} options={categoryOptions} />
      {/snippet}
    </Field>
    {#if category === 'manuscript'}
      <Field label={s.format} error={errors.format}>
        {#snippet children(control)}
          <Select {...control} name="format" value={text('format') || 'unknown'} options={formatOptions} />
        {/snippet}
      </Field>
    {/if}
    {#if category === 'indirect'}
      {@render line('sourceAuthor', s.sourceAuthor)}
      {@render line('sourceWork', s.sourceWork)}
    {/if}
    {@render line('repository', s.repository)}
    {@render line('settlement', s.settlement)}
    <Field label={s.shelfmark} error={errors.shelfmark}>
      {#snippet children(control)}
        <Input {...control} name="shelfmark" bind:value={shelfmark} autocomplete="off" />
      {/snippet}
    </Field>
  </div>

  <div class="grid gap-5 sm:grid-cols-2">
    {@render line('identifier', s.identifier)}
    {@render line('dateText', s.date)}
    <Field label={s.material} error={errors.material}>
      {#snippet children(control)}
        <Select {...control} name="material" bind:value={material} options={materialOptions} />
      {/snippet}
    </Field>
    {#if material === MATERIAL_OTHER}
      {@render line('materialOther', s.materialOther)}
    {/if}
    {@render line('extent', s.extent)}
  </div>
  <HandsField value={values.hands} error={errors.hands} />
  <Field label={s.provenance} error={errors.provenance}>
    {#snippet children(control)}
      <Textarea {...control} name="provenance" value={text('provenance')} rows={3} />
    {/snippet}
  </Field>
  <Field label={s.description} error={errors.description}>
    {#snippet children(control)}
      <Textarea {...control} name="description" value={text('description')} rows={4} />
    {/snippet}
  </Field>
</div>
