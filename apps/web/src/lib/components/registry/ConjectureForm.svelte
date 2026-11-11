<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { parseLabel, type Scheme } from '@varians/core';
  import type { CitationDraft } from '$lib/bibliography/types';
  import CitationPicker from '$lib/components/bibliography/CitationPicker.svelte';
  import {
    Button,
    Dialog,
    Field,
    Input,
    Notice,
    Select,
    Textarea,
    toasts,
  } from '$lib/components/ui';
  import { citationsPayload, draftsOf } from '$lib/registry/citations';
  import { CONJECTURE_KINDS, type ConjectureKind } from '$lib/registry/witness';
  import type { Cited, ConjectureRow } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';
  import { autofocus } from './focus';

  interface Props {
    open?: boolean;
    /** The conjecture to edit, with what it cites; null adds one. */
    conjecture?: (ConjectureRow & { citations?: Cited[] }) | null;
    /** The work's scheme, to check the segment label before sending. */
    scheme: Scheme;
    /** A label of the work, shown as an example. */
    example: string;
    /** The id of a datalist of the work's labels, for suggestions. */
    labelsList?: string;
  }

  let { open = $bindable(false), conjecture = null, scheme, example, labelsList }: Props = $props();

  const s = registry.conjecture;
  const uid = $props.id();
  const formId = `conjecture-${uid}`;
  const kindOptions = CONJECTURE_KINDS.map((k) => ({ value: k, label: s.kinds[k] ?? k }));

  let kind = $state<ConjectureKind>('substitution');
  let citations = $state<CitationDraft[]>([]);
  let submitting = $state(false);
  let errors = $state<Record<string, string[] | undefined>>({});
  let formError = $state<string | null>(null);

  const editing = $derived(!!conjecture);

  // Every opening starts from the record (or an empty form).
  $effect(() => {
    if (open) {
      kind = conjecture?.kind ?? 'substitution';
      citations = draftsOf(conjecture?.citations);
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
    if (!parseLabel(scheme, label)) {
      errors = { ...errors, segment: [label.trim() ? s.segmentInvalid : registry.common.required] };
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

<Dialog bind:open title={editing ? s.editTitle : s.addTitle} size="lg">
  <form
    id={formId}
    method="post"
    action={editing ? '?/editConjecture' : '?/addConjecture'}
    class="-mx-1 flex max-h-[calc(100dvh-15rem)] flex-col gap-4 overflow-y-auto px-1 pb-1"
    novalidate
    oninput={forget}
    use:enhance={submit}
  >
    {#if conjecture}<input type="hidden" name="id" value={conjecture.id} />{/if}
    {#if formError}<Notice kind="error">{formError}</Notice>{/if}
    <div class="grid gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      <Field label={s.segment} hint={s.segmentHint(example)} error={errors.segment} required>
        {#snippet children(control)}
          <Input
            {...control}
            name="segment"
            value={conjecture?.label ?? ''}
            list={labelsList}
            autocomplete="off"
            class="font-serif text-base"
            required
            {@attach autofocus}
          />
        {/snippet}
      </Field>
      <Field label={s.kind} error={errors.kind}>
        {#snippet children(control)}
          <Select {...control} name="kind" bind:value={kind} options={kindOptions} />
        {/snippet}
      </Field>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <Field label={s.lemma} error={errors.lemma}>
        {#snippet children(control)}
          <Input
            {...control}
            name="lemma"
            value={conjecture?.lemma ?? ''}
            autocomplete="off"
            class="font-serif text-base"
          />
        {/snippet}
      </Field>
      {#if kind !== 'deletion' && kind !== 'lacuna'}
        <Field label={s.reading} hint={s.readingHint} error={errors.reading}>
          {#snippet children(control)}
            <Input
              {...control}
              name="reading"
              value={conjecture?.reading ?? ''}
              autocomplete="off"
              class="font-serif text-base"
            />
          {/snippet}
        </Field>
      {/if}
    </div>
    {#if kind === 'lacuna'}
      <Field label={s.extent} error={errors.extent}>
        {#snippet children(control)}
          <Input {...control} name="extent" value={conjecture?.extent ?? ''} autocomplete="off" />
        {/snippet}
      </Field>
    {/if}
    <Field label={s.proposer} error={errors.proposer}>
      {#snippet children(control)}
        <Input {...control} name="proposer" value={conjecture?.proposer ?? ''} autocomplete="off" />
      {/snippet}
    </Field>
    <CitationPicker bind:value={citations} />
    <input type="hidden" name="citations" value={citationsPayload(citations)} />
    {#if errors.citations}<p class="font-sans text-xs text-danger" role="alert">
        {errors.citations[0]}
      </p>{/if}
    <Field label={s.note} error={errors.note}>
      {#snippet children(control)}
        <Textarea {...control} name="note" value={conjecture?.note ?? ''} rows={3} />
      {/snippet}
    </Field>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{registry.common.cancel}</Button>
    <Button type="submit" form={formId} variant="primary" loading={submitting}>{s.save}</Button>
  {/snippet}
</Dialog>
