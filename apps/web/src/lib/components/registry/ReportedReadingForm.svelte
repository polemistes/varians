<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { parseLabel, type Scheme } from '@varians/core';
  import type { CitationDraft } from '$lib/bibliography/types';
  import CitationPicker from '$lib/components/bibliography/CitationPicker.svelte';
  import {
    Button,
    Checkbox,
    Dialog,
    Field,
    Input,
    Notice,
    Select,
    Textarea,
    toasts,
  } from '$lib/components/ui';
  import { citationsPayload, draftsOf } from '$lib/registry/citations';
  import type { Cited, ReadingRow, WitnessOption } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';
  import { autofocus } from './focus';

  interface Props {
    open?: boolean;
    /** The reading to edit, with what it cites; null reports a new one. */
    reading?: (ReadingRow & { citations?: Cited[] }) | null;
    scheme: Scheme;
    example: string;
    labelsList?: string;
    witnesses: WitnessOption[];
    canPublish: boolean;
  }

  let {
    open = $bindable(false),
    reading = null,
    scheme,
    example,
    labelsList,
    witnesses,
    canPublish,
  }: Props = $props();

  const s = registry.reading;
  const uid = $props.id();
  const formId = `reading-${uid}`;
  const witnessOptions = $derived([
    { value: '', label: s.chooseWitness, disabled: true },
    ...witnesses.map((w) => ({ value: w.id, label: `${w.siglum}: ${w.name}` })),
  ]);

  let citations = $state<CitationDraft[]>([]);
  let submitting = $state(false);
  let errors = $state<Record<string, string[] | undefined>>({});
  let formError = $state<string | null>(null);
  const editing = $derived(!!reading);

  // Every opening starts from the record (or an empty form).
  $effect(() => {
    if (open) {
      citations = draftsOf(reading?.citations);
      errors = {};
      formError = null;
    }
  });

  /** A field's error goes as soon as the field is changed. */
  function forget(event: Event) {
    const name = (event.target as HTMLInputElement | null)?.name;
    if (name && errors[name]) errors = { ...errors, [name]: undefined };
  }

  const submit: SubmitFunction = ({ formData, cancel }) => {
    const label = String(formData.get('segment') ?? '');
    const problems: Record<string, string[]> = {};
    if (!parseLabel(scheme, label)) {
      problems.segment = [
        label.trim() ? registry.conjecture.segmentInvalid : registry.common.required,
      ];
    }
    if (!formData.get('witnessId')) problems.witnessId = [s.witnessRequired];
    if (Object.keys(problems).length) {
      errors = problems;
      cancel();
      return;
    }
    submitting = true;
    return async ({ result, update }) => {
      submitting = false;
      if (result.type === 'success') {
        toasts.success(editing ? s.updated : s.added);
        open = false;
        await update();
      } else if (result.type === 'failure') {
        errors = (result.data?.errors as Record<string, string[] | undefined>) ?? {};
        formError = (result.data?.error as string | undefined) ?? null;
      } else if (result.type === 'error') {
        formError = result.error?.message ?? registry.common.forbidden;
      } else {
        await update();
      }
    };
  };
</script>

<Dialog
  bind:open
  title={editing ? s.editTitle : s.addTitle}
  size="lg"
>
  {#if witnesses.length === 0}
    <Notice kind="info">{s.noWitnesses}</Notice>
  {:else}
    <form
      id={formId}
      method="post"
      action={editing ? '?/editReading' : '?/addReading'}
      class="-mx-1 flex max-h-[calc(100dvh-15rem)] flex-col gap-4 overflow-y-auto px-1 pb-1"
      novalidate
      oninput={forget}
      use:enhance={submit}
    >
      {#if reading}<input type="hidden" name="id" value={reading.id} />{/if}
      {#if formError}<Notice kind="error">{formError}</Notice>{/if}
      <div class="grid gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        <Field
          label={registry.conjecture.segment}
          hint={registry.conjecture.segmentHint(example)}
          error={errors.segment}
          required
        >
          {#snippet children(control)}
            <Input
              {...control}
              name="segment"
              value={reading?.label ?? ''}
              list={labelsList}
              autocomplete="off"
              class="font-serif text-base"
              required
              {@attach autofocus}
            />
          {/snippet}
        </Field>
        <Field label={s.witness} error={errors.witnessId} required>
          {#snippet children(control)}
            <Select
              {...control}
              name="witnessId"
              value={reading?.witnessId ?? ''}
              options={witnessOptions}
              required
            />
          {/snippet}
        </Field>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <Field label={s.lemma} error={errors.lemma}>
          {#snippet children(control)}
            <Input
              {...control}
              name="lemma"
              value={reading?.lemma ?? ''}
              autocomplete="off"
              class="font-serif text-base"
            />
          {/snippet}
        </Field>
        <Field label={s.reading} error={errors.reading}>
          {#snippet children(control)}
            <Input
              {...control}
              name="reading"
              value={reading?.reading ?? ''}
              autocomplete="off"
              class="font-serif text-base"
            />
          {/snippet}
        </Field>
      </div>
      <Field label={s.source} error={errors.source}>
        {#snippet children(control)}
          <Input {...control} name="source" value={reading?.source ?? ''} autocomplete="off" />
        {/snippet}
      </Field>
      <CitationPicker bind:value={citations} />
      <input type="hidden" name="citations" value={citationsPayload(citations)} />
      {#if errors.citations}<p class="font-sans text-xs text-danger" role="alert">
          {errors.citations[0]}
        </p>{/if}
      <Field label={s.note} error={errors.note}>
        {#snippet children(control)}
          <Textarea {...control} name="note" value={reading?.note ?? ''} rows={3} />
        {/snippet}
      </Field>
      {#if canPublish}
        <Checkbox
          name="published"
          checked={reading?.visibility === 'published'}
          hint={registry.conjecture.publishHint}
        >
          {registry.conjecture.publish}
        </Checkbox>
      {/if}
    </form>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{registry.common.cancel}</Button>
    {#if witnesses.length}
      <Button type="submit" form={formId} variant="primary" loading={submitting}
        >{editing ? s.save : s.add}</Button
      >
    {/if}
  {/snippet}
</Dialog>
