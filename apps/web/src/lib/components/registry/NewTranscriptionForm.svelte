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
  import type { TranscriptChoice } from '$lib/edition/conspectus';
  import type { TranscriptionOption, WorkOption } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';
  import { autofocus } from './focus';

  interface Props {
    open?: boolean;
    /** The window's title. */
    title?: string;
    /** Every work, to choose from; not needed where the window is opened for a witness. */
    works?: WorkOption[];
    /** The transcriptions the user may view, to start from. */
    sources: TranscriptionOption[];
    /** The form action; the witness page's own when omitted. */
    action?: string;
    /**
     * The witness transcribed, shown and not chosen, for a window opened
     * away from the witness's page. A transcript is of its witness, and may
     * hold text of any work, so the window names the witness and no work.
     */
    witness?: { id: string; name: string } | null;
    /**
     * The work whose segment labels and spelling rules the transcript is
     * offered first, where the window is opened for a witness: the first of
     * the works the transcript is for, changed in the transcript's settings.
     */
    work?: { id: string; title: string } | null;
    /** Called with the transcript made, in place of going to its workbench. */
    oncreated?: (transcript: TranscriptChoice) => void;
  }

  let {
    open = $bindable(false),
    title = registry.witness.newTranscriptionTitle,
    works = [],
    sources,
    action = '?/newTranscription',
    witness = null,
    work = null,
    oncreated,
  }: Props = $props();

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
      name = witness?.name ?? '';
      workId = witness ? (work?.id ?? '') : '';
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
      if (result.type === 'success' && oncreated) {
        open = false;
        toasts.success(s.created);
        oncreated(result.data?.transcript as TranscriptChoice);
      } else if (result.type === 'redirect' || result.type === 'success') {
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

<Dialog bind:open {title} size="md">
  <form
    id={formId}
    method="post"
    {action}
    class="flex flex-col gap-4"
    novalidate
    oninput={forget}
    use:enhance={submit}
  >
    {#if formError}
      <Notice kind="error">{formError}</Notice>
    {/if}
    {#if witness}
      <input type="hidden" name="witnessId" value={witness.id} />
      {#if work}<input type="hidden" name="workId" value={work.id} />{/if}
      <div class="flex flex-col gap-1.5 font-sans">
        <span class="text-sm font-medium text-ink">{s.witness}</span>
        <span class="font-serif text-base text-ink">{witness.name}</span>
      </div>
    {:else}
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
    {/if}
    <Field label={s.name} error={errors.name} required>
      {#snippet children(control)}
        <Input
          {...control}
          name="name"
          bind:value={name}
          autocomplete="off"
          class="font-serif text-base"
          required
          {@attach (node: HTMLElement) => {
            if (witness) autofocus(node);
          }}
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
