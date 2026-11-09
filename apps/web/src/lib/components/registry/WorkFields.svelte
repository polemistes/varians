<script lang="ts">
  import { untrack } from 'svelte';
  import { Field, Input, Textarea } from '$lib/components/ui';
  import { LANGUAGE_OTHER } from '$lib/registry/constants';
  import { registry } from '$lib/strings/registry';
  import IdentifiersField from './IdentifiersField.svelte';
  import LanguageField from './LanguageField.svelte';
  import RegistrySearch from './RegistrySearch.svelte';

  interface Props {
    /** What the form shows at first: the work's fields, or what was sent. */
    values?: Record<string, string | null | undefined>;
    errors?: Record<string, string[] | undefined>;
    /** Show existing works as the title is typed (a new work). */
    search?: boolean;
  }

  let { values = {}, errors = {}, search = false }: Props = $props();

  const s = registry.work;
  // The initial title only; the input owns it from here on.
  let title = $state(untrack(() => values.title ?? ''));
  const language = $derived(
    values.language === LANGUAGE_OTHER ? (values.languageCode ?? '') : (values.language ?? 'grc'),
  );
</script>

<div class="flex flex-col gap-5">
  <div class="flex flex-col gap-2">
    <Field label={s.title} error={errors.title} required>
      {#snippet children(control)}
        <Input
          {...control}
          name="title"
          bind:value={title}
          autocomplete="off"
          class="font-serif text-base"
          required
          maxlength={200}
        />
      {/snippet}
    </Field>
    {#if search}<RegistrySearch kind="work" queries={[title]} />{/if}
  </div>
  <Field label={s.author} error={errors.author}>
    {#snippet children(control)}
      <Input
        {...control}
        name="author"
        value={values.author ?? ''}
        autocomplete="off"
        class="font-serif text-base"
      />
    {/snippet}
  </Field>
  <LanguageField
    value={language}
    other={values.language === LANGUAGE_OTHER}
    error={errors.language}
  />
  <Field label={s.identifier} hint={s.identifierHint} error={errors.identifier}>
    {#snippet children(control)}
      <Input
        {...control}
        name="identifier"
        value={values.identifier ?? ''}
        autocomplete="off"
        spellcheck="false"
      />
    {/snippet}
  </Field>
  <IdentifiersField value={values.identifiers} error={errors.identifiers} />
  <Field label={s.description} error={errors.description}>
    {#snippet children(control)}
      <Textarea {...control} name="description" value={values.description ?? ''} rows={4} />
    {/snippet}
  </Field>
</div>
