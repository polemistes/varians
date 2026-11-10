<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import {
    Button,
    Checkbox,
    Dialog,
    Field,
    Input,
    Notice,
    Select,
    toasts,
  } from '$lib/components/ui';
  import type { TranscriptionOption, WorkOption } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';
  import { autofocus } from './focus';

  interface Props {
    open?: boolean;
    /** The works the user may see. */
    works: WorkOption[];
    /** The transcriptions the user may view, to start from. */
    sources: TranscriptionOption[];
  }

  let { open = $bindable(false), works, sources }: Props = $props();

  const s = registry.transcription;
  const uid = $props.id();
  const formId = `new-transcription-${uid}`;

  const workOptions = $derived([
    { value: '', label: s.workNone },
    ...works.map((w) => ({ value: w.id, label: w.author ? `${w.title} (${w.author})` : w.title })),
  ]);
  const sourceOptions = $derived([
    { value: '', label: s.startFromNone },
    ...sources.map((t) => ({
      value: t.id,
      label: `${t.witnessSiglum}: ${t.witnessName}, ${t.name} (${t.ownerName})`,
    })),
  ]);

  let name = $state('');
  let workId = $state('');
  let submitting = $state(false);
  let errors = $state<Record<string, string[] | undefined>>({});
  let formError = $state<string | null>(null);

  $effect(() => {
    if (open) {
      name = '';
      workId = '';
      errors = {};
      formError = null;
    }
  });

  /** A name still empty, or still the title of the work chosen before, follows the work. */
  function chooseWork(id: string) {
    const before = works.find((w) => w.id === workId)?.title ?? '';
    const after = works.find((w) => w.id === id)?.title ?? '';
    if (!name.trim() || name === before) name = after;
    workId = id;
  }

  /** A field's error goes as soon as the field is changed. */
  function forget(event: Event) {
    const field = (event.target as HTMLInputElement | null)?.name;
    if (field && errors[field]) errors = { ...errors, [field]: undefined };
  }

  const submit: SubmitFunction = () => {
    submitting = true;
    formError = null;
    return async ({ result, update }) => {
      submitting = false;
      if (result.type === 'redirect' || result.type === 'success') {
        toasts.success(s.created);
        await update();
      } else if (result.type === 'failure') {
        errors = (result.data?.errors as Record<string, string[] | undefined>) ?? {};
        formError = (result.data?.error as string | undefined) ?? null;
      } else {
        formError = result.error?.message ?? registry.common.forbidden;
      }
    };
  };
</script>

<Dialog bind:open title={registry.witness.newTranscription} size="md">
  <form
    id={formId}
    method="post"
    action="?/newTranscription"
    class="flex flex-col gap-4"
    novalidate
    oninput={forget}
    use:enhance={submit}
  >
    {#if formError}
      <Notice kind="error">{formError}</Notice>
    {/if}
    <Field label={s.work} error={errors.workId}>
      {#snippet children(control)}
        <Select
          {...control}
          name="workId"
          value={workId}
          options={workOptions}
          onchange={(e) => chooseWork(e.currentTarget.value)}
          {@attach autofocus}
        />
      {/snippet}
    </Field>
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
    <Checkbox name="keepsWrittenForm">{s.keepsWritten}</Checkbox>
    <Field label={s.startFrom} error={errors.fromTranscriptionId}>
      {#snippet children(control)}
        <Select {...control} name="fromTranscriptionId" value="" options={sourceOptions} />
      {/snippet}
    </Field>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{registry.common.cancel}</Button>
    <Button type="submit" form={formId} variant="primary" loading={submitting}>{s.create}</Button>
  {/snippet}
</Dialog>
