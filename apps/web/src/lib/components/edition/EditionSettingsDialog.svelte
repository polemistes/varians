<script lang="ts">
  /** The edition's title, editors, preface and conventions, saved through the page's `settings` action. */
  import { enhance } from '$app/forms';
  import type { EditionConventions } from '@varians/db';
  import { Button, Checkbox, Dialog, Field, Input, Select, Textarea } from '$lib/components/ui';
  import { edition as e } from '$lib/strings/edition';
  import EditorsField from './EditorsField.svelte';
  import { editor } from '$lib/strings/editor';

  const t = editor.dialogs.settings;
  const d = editor.dialogs;

  interface Props {
    open: boolean;
    edition: {
      title: string;
      editors: string[];
      preface: string | null;
      sources?: string | null;
      rightsNote?: string | null;
      licence?: string | null;
      installationLicence?: string;
      conventions: EditionConventions;
    };
    onsaved?: () => void;
  }

  let { open = $bindable(), edition, onsaved }: Props = $props();
  let saving = $state(false);
  let errors = $state<Record<string, string[] | undefined>>({});
  let form = $state<HTMLFormElement | null>(null);
  let lineation = $state<'verse' | 'prose'>('verse');
  $effect(() => {
    if (open) lineation = edition.conventions.lineation;
  });
</script>

<Dialog bind:open title={t.title} size="lg">
  <form
    method="POST"
    action="?/settings"
    bind:this={form}
    class="flex flex-col gap-4"
    use:enhance={() => {
      saving = true;
      return async ({ result, update }) => {
        saving = false;
        if (result.type === 'failure') {
          errors = ((result.data as { errors?: Record<string, string[]> } | undefined)?.errors ??
            {}) as Record<string, string[] | undefined>;
          return;
        }
        errors = {};
        open = false;
        onsaved?.();
        await update({ reset: false });
      };
    }}
  >
    <Field label={e.title} error={errors.title} required>
      {#snippet children(control)}<Input
          {...control}
          name="title"
          value={edition.title}
          class="font-serif"
        />{/snippet}
    </Field>
    <EditorsField names={edition.editors} error={errors.editors} />
    <Field label={t.preface} hint={t.prefaceHint}>
      {#snippet children(control)}<Textarea
          {...control}
          name="preface"
          value={edition.preface ?? ''}
          rows={5}
        />{/snippet}
    </Field>
    <div class="grid gap-4 sm:grid-cols-2">
      <Field label={t.sources} hint={t.sourcesHint} error={errors.sources}>
        {#snippet children(control)}<Textarea
            {...control}
            name="sources"
            value={edition.sources ?? ''}
            rows={3}
          />{/snippet}
      </Field>
      <Field
        label={t.rightsNote}
        error={errors.rightsNote}
        hint={edition.licence
          ? t.licenceFixed(edition.licence)
          : edition.installationLicence
            ? t.licenceToCome(edition.installationLicence)
            : undefined}
      >
        {#snippet children(control)}<Input
            {...control}
            name="rightsNote"
            value={edition.rightsNote ?? ''}
            maxlength={300}
          />{/snippet}
      </Field>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <fieldset class="flex flex-col gap-2 font-sans text-sm">
        <legend class="mb-1 text-xs text-ink-soft">{e.lineation}</legend>
        <label class="flex items-center gap-2"
          ><input type="radio" name="lineation" value="verse" bind:group={lineation} />
          {t.verse}</label
        >
        <label class="flex items-center gap-2"
          ><input type="radio" name="lineation" value="prose" bind:group={lineation} />
          {t.prose}</label
        >
        {#if lineation === 'verse'}
          <label class="flex items-center gap-2 text-ink-soft">
            {e.numberEvery}
            <Input
              name="numberEvery"
              type="number"
              min="1"
              max="100"
              value={String(edition.conventions.numberEvery)}
              class="w-20"
            />
            {e.numberEveryUnit}
          </label>
        {:else}
          <input type="hidden" name="numberEvery" value="1" />
        {/if}
      </fieldset>
      <fieldset class="flex flex-col gap-2 font-sans text-sm">
        <legend class="mb-1 text-xs text-ink-soft">{e.apparatusForm}</legend>
        <label class="flex items-center gap-2"
          ><input
            type="radio"
            name="apparatus"
            value="positive"
            checked={edition.conventions.apparatus === 'positive'}
          />
          {t.positive}</label
        >
        <label class="flex items-center gap-2"
          ><input
            type="radio"
            name="apparatus"
            value="negative"
            checked={edition.conventions.apparatus === 'negative'}
          />
          {t.negative}</label
        >
        <Checkbox name="latin" checked={edition.conventions.latin}>{e.latin}</Checkbox>
      </fieldset>
      <fieldset class="flex flex-col gap-2 font-sans text-sm">
        <legend class="mb-1 text-xs text-ink-soft">{e.interpretative}</legend>
        {#each ['apparatus', 'separate', 'none'] as const as placement (placement)}
          <label class="flex items-center gap-2"
            ><input
              type="radio"
              name="interpretative"
              value={placement}
              checked={(edition.conventions.interpretative ?? 'separate') === placement}
            />
            {e.interpretativeOptions[placement]}</label
          >
        {/each}
        <p class="text-xs text-ink-muted">{e.interpretativeHint}</p>
      </fieldset>
    </div>
    <Field label={t.speakers}>
      {#snippet children(control)}
        <Select
          {...control}
          name="speakerDisplay"
          value={edition.conventions.speakerDisplay}
          options={[
            { value: 'margin', label: t.speakerMargin },
            { value: 'inline', label: t.speakerInline },
            { value: 'own-line', label: t.speakerOwnLine },
          ]}
        />
      {/snippet}
    </Field>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{d.cancel}</Button>
    <Button variant="primary" loading={saving} onclick={() => form?.requestSubmit()}
      >{d.save}</Button
    >
  {/snippet}
</Dialog>
