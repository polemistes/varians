<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import EditorsField from '$lib/components/edition/EditorsField.svelte';
  import { PageFrame } from '$lib/components/shell';
  import { Button, Checkbox, Field, Input, Notice, Select } from '$lib/components/ui';
  import { s as app } from '$lib/strings';
  import { edition as s } from '$lib/strings/edition';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  let submitting = $state(false);
  // The initial choice only; the select owns the value from then on.
  let base = $state(untrack(() => form?.values?.base ?? data.candidates[0]?.transcriptionId ?? ''));
  let lineation = $state<'verse' | 'prose'>('verse');

  const baseOptions = $derived([
    { value: '', label: s.baseNone },
    ...data.candidates.map((c) => ({ value: c.transcriptionId, label: `${c.siglum}: ${c.witnessName}, ${c.transcriptionName} (${c.segments})` })),
  ]);
  const errors = $derived((form?.errors ?? {}) as Record<string, string[] | undefined>);
  const editors = $derived(form?.values?.editors ?? (data.user?.name ? [data.user.name] : []));
</script>

<PageFrame title={s.newTitle(data.work.title)} width="reading">
  <form
    method="POST"
    class="flex flex-col gap-8"
    use:enhance={() => {
      submitting = true;
      return async ({ update }) => {
        await update();
        submitting = false;
      };
    }}
  >
    <section class="flex flex-col gap-5">
      <Field label={s.title} error={errors.title} required>
        {#snippet children(control)}
          <Input {...control} name="title" value={form?.values?.title ?? ''} class="font-serif" required />
        {/snippet}
      </Field>
      <EditorsField names={editors} error={errors.editors} />
    </section>

    <section class="flex flex-col gap-5">
      <Field label={s.base}>
        {#snippet children(control)}
          <Select {...control} name="base" bind:value={base} options={baseOptions} />
        {/snippet}
      </Field>
      {#if base}
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-2 font-sans text-sm font-medium text-ink">{s.range}</legend>
          <div class="grid grid-cols-2 gap-4">
            <Field label={s.rangeFrom} error={errors.from}>
              {#snippet children(control)}
                <Input {...control} name="from" value={form?.values?.from ?? ''} class="font-serif" />
              {/snippet}
            </Field>
            <Field label={s.rangeTo} error={errors.to}>
              {#snippet children(control)}
                <Input {...control} name="to" value={form?.values?.to ?? ''} class="font-serif" />
              {/snippet}
            </Field>
          </div>
        </fieldset>
      {/if}
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="font-sans text-sm font-medium text-ink">{s.sigla}</h2>
      {#if errors.sigla}<Notice kind="error">{errors.sigla[0]}</Notice>{/if}
      {#if data.candidates.length === 0}
        <p class="font-sans text-sm text-ink-soft">{s.noWitnesses}</p>
      {:else}
        <table class="w-full border-collapse font-sans text-sm">
          <thead>
            <tr class="text-left text-xs text-ink-soft">
              <th class="py-1 pr-3 font-medium">{s.include}</th>
              <th class="py-1 pr-3 font-medium">{s.siglumColumn}</th>
              <th class="py-1 pr-3 font-medium">{s.witnessColumn}</th>
              <th class="py-1 font-medium">{s.transcriptionColumn}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.candidates as c (c.transcriptionId)}
              <tr class="border-t border-line">
                <td class="py-2 pr-3"><Checkbox name={`include:${c.transcriptionId}`} checked={true} aria-label={`${s.include} ${c.witnessName}`} /></td>
                <td class="py-2 pr-3"><Input name={`siglum:${c.transcriptionId}`} value={c.siglum} class="w-20 font-serif" aria-label={s.siglumColumn} /></td>
                <td class="py-2 pr-3 font-serif text-ink">{c.witnessName}</td>
                <td class="py-2 text-ink-soft">{c.transcriptionName} · {c.segments}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="font-sans text-sm font-medium text-ink">{s.conventions}</h2>
      <fieldset class="flex flex-col gap-2 font-sans text-sm">
        <legend class="mb-1 text-xs text-ink-soft">{s.lineation}</legend>
        <label class="flex items-center gap-2"><input type="radio" name="lineation" value="verse" bind:group={lineation} /> {s.verse}</label>
        <label class="flex items-center gap-2"><input type="radio" name="lineation" value="prose" bind:group={lineation} /> {s.prose}</label>
        {#if lineation === 'verse'}
          <label class="mt-1 flex items-center gap-2 text-ink-soft">
            {s.numberEvery}
            <Input name="numberEvery" type="number" min="1" max="100" value="5" class="w-20" />
            {s.numberEveryUnit}
          </label>
        {/if}
      </fieldset>
      <fieldset class="flex flex-col gap-2 font-sans text-sm">
        <legend class="mb-1 text-xs text-ink-soft">{s.apparatusForm}</legend>
        <label class="flex items-center gap-2"><input type="radio" name="apparatus" value="positive" checked /> {s.positive}</label>
        <label class="flex items-center gap-2"><input type="radio" name="apparatus" value="negative" /> {s.negative}</label>
        <Checkbox name="latin" checked={true}>{s.latin}</Checkbox>
      </fieldset>
    </section>

    <div class="flex items-center gap-3">
      <Button type="submit" variant="primary" loading={submitting}>{submitting ? s.creating : s.create}</Button>
      <Button href={`/works/${data.work.slug}`} variant="ghost">{app.common.cancel}</Button>
    </div>
  </form>
</PageFrame>
