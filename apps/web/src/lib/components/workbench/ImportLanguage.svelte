<script lang="ts">
  /**
   * The language of the text an import brings in: one Varians names, or
   * Other with a tag typed. Nothing is chosen to begin with; a file that
   * declares its language fills it in when it is read (`declared`), and the
   * person importing may change it.
   */
  import { Field, Input, Select } from '$lib/components/ui';
  import { LANGUAGE_OTHER } from '$lib/registry/constants';
  import { isListedLanguage, LANGUAGES } from '$lib/registry/languages';
  import { workbench as t } from '$lib/strings/workbench';

  interface Props {
    /** The language tag chosen, or '' where none is. */
    value?: string;
    /** The language the file declares, once it is read; null or undefined where it declares none. */
    declared?: string | null | undefined;
  }

  let { value = $bindable(''), declared }: Props = $props();

  const options = [
    { value: '', label: '' },
    ...LANGUAGES.map((l) => ({ value: l.code, label: `${l.name} (${l.code})` })),
    { value: LANGUAGE_OTHER, label: t.importer.languageOther },
  ];

  let choice = $state('');
  let code = $state('');

  // A file read that declares its language fills the field; one that declares none leaves it as it is.
  $effect(() => {
    if (!declared) return;
    if (isListedLanguage(declared)) {
      choice = declared;
      code = '';
    } else {
      choice = LANGUAGE_OTHER;
      code = declared;
    }
  });

  $effect(() => {
    value = choice === LANGUAGE_OTHER ? code.trim() : choice;
  });
</script>

<div class="flex flex-wrap items-end gap-4">
  <Field label={t.importer.language}>
    {#snippet children(control)}
      <Select {...control} bind:value={choice} {options} />
    {/snippet}
  </Field>
  {#if choice === LANGUAGE_OTHER}
    <Field label={t.importer.languageCode} hint={t.importer.languageCodeHint}>
      {#snippet children(control)}
        <Input
          {...control}
          bind:value={code}
          autocomplete="off"
          spellcheck="false"
          class="w-40 font-mono text-xs"
        />
      {/snippet}
    </Field>
  {/if}
</div>
