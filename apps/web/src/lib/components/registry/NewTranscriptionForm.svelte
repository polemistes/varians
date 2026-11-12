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
  import type { TranscriptionOption } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';
  import { autofocus } from './focus';

  interface Props {
    open?: boolean;
    /** The window's title. */
    title?: string;
    /** The transcriptions the user may view, to start from. */
    sources: TranscriptionOption[];
    /** The form action; the witness page's own when omitted. */
    action?: string;
    /**
     * The witness transcribed, shown and not chosen. A transcript is of its
     * witness and has no works of its own: its works are those its text is
     * assigned to, chosen where text is assigned, so the window names the
     * witness and no work, wherever it is opened.
     */
    witness: { id: string; name: string } | null;
    /** Called with the transcript made, in place of going to its workbench. */
    oncreated?: (transcript: TranscriptChoice) => void;
  }

  let {
    open = $bindable(false),
    title = registry.witness.newTranscriptionTitle,
    sources,
    action = '?/newTranscription',
    witness,
    oncreated,
  }: Props = $props();

  const s = registry.transcription;
  const uid = $props.id();
  const formId = `new-transcription-${uid}`;

  const sourceOptions = $derived(
    sources.map((t) => ({
      value: t.id,
      label: `${t.witnessSiglum}: ${t.witnessName}, ${t.name} (${t.ownerName})`,
    })),
  );

  let name = $state('');
  /** Whether the transcript starts from another; the transcripts to start from are shown only then. */
  let startsFrom = $state(false);
  let submitting = $state(false);
  let errors = $state<Record<string, string[] | undefined>>({});
  let formError = $state<string | null>(null);

  $effect(() => {
    if (open) {
      name = witness ? s.defaultName(witness.name) : '';
      startsFrom = false;
      errors = {};
      formError = null;
    }
  });

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
    <input type="hidden" name="witnessId" value={witness?.id ?? ''} />
    <div class="flex flex-col gap-1.5 font-sans">
      <span class="text-sm font-medium text-ink">{s.witness}</span>
      <span class="font-serif text-base text-ink">{witness?.name}</span>
    </div>
    <Field label={s.name} error={errors.name} required>
      {#snippet children(control)}
        <Input
          {...control}
          name="name"
          bind:value={name}
          autocomplete="off"
          class="font-serif text-base"
          required
          {@attach autofocus}
        />
      {/snippet}
    </Field>
    <Checkbox name="keepsWrittenForm">{s.keepsWritten}</Checkbox>
    <!-- The window is the same whatever the registry holds: where there is no transcript to start from, the list is empty. -->
    <Checkbox bind:checked={startsFrom}>{s.startFrom}</Checkbox>
    {#if startsFrom}
      <div class="flex flex-col gap-1.5 font-sans">
        <Select
          name="fromTranscriptionId"
          options={sourceOptions}
          aria-label={s.startFromWhich}
          aria-invalid={errors.fromTranscriptionId ? 'true' : undefined}
        />
        {#if errors.fromTranscriptionId}
          <p class="text-xs text-danger" role="alert">{errors.fromTranscriptionId[0]}</p>
        {/if}
      </div>
    {/if}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{registry.common.cancel}</Button>
    <Button type="submit" form={formId} variant="primary" loading={submitting}>{s.create}</Button>
  {/snippet}
</Dialog>
