<script lang="ts">
  /**
   * The transcription's settings: its name, whether it keeps a written form
   * beside the read form, and whether the written form is shown
   * without word division. Switching the written form changes
   * the text as one change in the history.
   */
  import type { SubmitFunction } from '@sveltejs/kit';
  import { enhance } from '$app/forms';
  import type { Stream } from '@varians/core';
  import {
    Button,
    Checkbox,
    Dialog,
    Field,
    Input,
    Notice,
    Textarea,
    toasts,
  } from '$lib/components/ui';
  import WorksField, { type ChosenWork } from '$lib/components/registry/WorksField.svelte';
  import { workbench as t } from '$lib/strings/workbench';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    open: boolean;
  }

  let { wb, open = $bindable(false) }: Props = $props();

  let name = $state('');
  let keepsWrittenForm = $state(false);
  let displayAsWritten = $state(false);
  let works = $state<ChosenWork[]>([]);
  let sources = $state('');
  let rightsNote = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    name = wb.name;
    keepsWrittenForm = wb.keepsWrittenForm;
    displayAsWritten = wb.displayAsWritten;
    works = wb.workIds.map((id) => ({ id, title: wb.works.find((w) => w.id === id)?.title ?? id }));
    sources = wb.sources ?? '';
    rightsNote = wb.rightsNote ?? '';
    error = null;
  });

  const submit: SubmitFunction = async ({ formData, cancel }) => {
    error = null;
    busy = true;
    await wb.flush();
    if (wb.pending > 0) {
      busy = false;
      error = wb.saveError ?? t.importer.conflict;
      cancel();
      return;
    }
    formData.set('fromVersion', String(wb.version));
    return async ({ result }) => {
      busy = false;
      if (result.type === 'success') {
        const settings = (
          result.data as {
            settings: {
              name: string;
              keepsWrittenForm: boolean;
              displayAsWritten: boolean;
              workIds: string[];
              sources: string | null;
              rightsNote: string | null;
              version: number;
              content: Stream | null;
            };
          }
        ).settings;
        if (settings.content)
          wb.replaceDocument({ version: settings.version, content: settings.content });
        wb.applySettings(settings);
        toasts.success(t.settings.saved);
        open = false;
        // Other works bring other segment labels and spelling rules: the page loads them afresh.
        if (settings.workIds.join() !== wb.workIds.join()) location.reload();
      } else if (result.type === 'failure') {
        const data = result.data as { message?: string; conflict?: boolean } | undefined;
        error = data?.message ?? null;
        if (data?.conflict) await wb.reload();
      } else if (result.type === 'error') {
        error = result.error?.message ?? null;
      }
    };
  };
</script>

<Dialog bind:open title={t.settings.title} size="md">
  <form
    id="wb-settings"
    method="post"
    action="?/settings"
    use:enhance={submit}
    class="flex flex-col gap-4"
  >
    <Field label={t.settings.name} required>
      {#snippet children(control)}
        <Input {...control} name="name" bind:value={name} required maxlength={200} />
      {/snippet}
    </Field>
    <Checkbox
      name="keepsWrittenForm"
      bind:checked={keepsWrittenForm}
      hint={t.settings.keepWrittenHint}>{t.settings.keepWritten}</Checkbox
    >
    {#if wb.keepsWrittenForm && !keepsWrittenForm}
      <Notice kind="warning">{t.settings.dropWrittenWarning}</Notice>
    {/if}
    <Checkbox name="displayAsWritten" bind:checked={displayAsWritten}
      >{t.settings.asWritten}</Checkbox
    >
    <WorksField bind:works />
    <Field label={t.settings.sources} hint={t.settings.sourcesHint}>
      {#snippet children(control)}
        <Textarea {...control} name="sources" bind:value={sources} rows={3} maxlength={5000} />
      {/snippet}
    </Field>
    <Field
      label={t.settings.rightsNote}
      hint={wb.licence
        ? t.settings.licenceFixed(wb.licence)
        : wb.installationLicence
          ? t.settings.licenceToCome(wb.installationLicence)
          : undefined}
    >
      {#snippet children(control)}
        <Input {...control} name="rightsNote" bind:value={rightsNote} maxlength={300} />
      {/snippet}
    </Field>
    {#if error}<Notice kind="error">{error}</Notice>{/if}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{t.settings.cancel}</Button>
    <Button
      type="submit"
      form="wb-settings"
      variant="primary"
      loading={busy}
      disabled={!name.trim()}>{t.settings.save}</Button
    >
  {/snippet}
</Dialog>
