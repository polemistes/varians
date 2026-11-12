<script lang="ts">
  import { untrack } from 'svelte';
  import { Field, Input, Select } from '$lib/components/ui';
  import { LANGUAGE_OTHER } from '$lib/registry/constants';
  import { isListedLanguage, LANGUAGES } from '$lib/registry/languages';
  import { registry } from '$lib/strings/registry';

  interface Props {
    /** The code at first: a listed one is chosen in the select, any other goes in the code input. */
    value?: string;
    /** Set when the form came back with the language chosen as Other. */
    other?: boolean;
    error?: string[] | string | null;
  }

  let { value = '', other = false, error }: Props = $props();

  const s = registry.work;
  const options = [
    { value: '', label: '' },
    ...LANGUAGES.map((l) => ({ value: l.code, label: `${l.name} (${l.code})` })),
    { value: LANGUAGE_OTHER, label: s.languageOther },
  ];

  // The initial values only; the controls own them from here on.
  let choice = $state(
    untrack(() => (other || (value && !isListedLanguage(value)) ? LANGUAGE_OTHER : value)),
  );
  let code = $state(untrack(() => (choice === LANGUAGE_OTHER ? value : '')));
</script>

<div class="flex flex-col gap-4">
  <Field label={s.language} error={choice === LANGUAGE_OTHER ? undefined : error} required>
    {#snippet children(control)}
      <Select {...control} name="language" bind:value={choice} {options} />
    {/snippet}
  </Field>
  {#if choice === LANGUAGE_OTHER}
    <Field label={s.languageCode} hint={s.languageCodeHint} {error} required>
      {#snippet children(control)}
        <Input
          {...control}
          name="languageCode"
          bind:value={code}
          autocomplete="off"
          spellcheck="false"
          class="w-40 font-mono text-xs"
          required
        />
      {/snippet}
    </Field>
  {/if}
</div>
