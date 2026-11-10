<script lang="ts">
  /**
   * The rights of an image as a form gives them: the statement,
   * chosen from the listed ones, the credit line, and, where it belongs, the
   * address the image was obtained from. The fields post under `names`.
   */
  import { Field, Input, Select } from '$lib/components/ui';
  import { pageStrings as t } from '$lib/strings/pages';
  import { rightsCopyable, rightsOptions } from './rights';

  interface Props {
    rights: string;
    attribution: string;
    source?: string;
    /** Offer the source field. */
    withSource?: boolean;
    names?: { rights: string; attribution: string; source: string };
    rightsLabel?: string;
    /** The label of the empty choice. */
    emptyLabel?: string;
    /** A statement must be chosen. */
    required?: boolean;
    disabled?: boolean;
    /** Messages by field name. */
    errors?: Record<string, string[] | string | null | undefined>;
  }

  let {
    rights = $bindable(''),
    attribution = $bindable(''),
    source = $bindable(''),
    withSource = true,
    names = { rights: 'rights', attribution: 'attribution', source: 'imageSource' },
    rightsLabel = t.rights.statement,
    emptyLabel = t.rights.choose,
    required = false,
    disabled = false,
    errors = {},
  }: Props = $props();

  const options = $derived(rightsOptions(emptyLabel));
  const hint = $derived(rightsCopyable(rights) ? undefined : t.rights.notCopyable);
</script>

<div class="flex flex-col gap-3">
  <Field label={rightsLabel} {hint} {required} error={errors[names.rights]}>
    {#snippet children(control)}
      <Select {...control} name={names.rights} bind:value={rights} {options} {disabled} />
    {/snippet}
  </Field>
  <Field label={t.rights.credit} error={errors[names.attribution]}>
    {#snippet children(control)}
      <Input {...control} name={names.attribution} bind:value={attribution} maxlength={500} autocomplete="off" {disabled} />
    {/snippet}
  </Field>
  {#if withSource}
    <Field label={t.rights.source} hint={t.rights.sourceHint} error={errors[names.source]}>
      {#snippet children(control)}
        <Input
          {...control}
          name={names.source}
          type="url"
          inputmode="url"
          placeholder="https://"
          spellcheck="false"
          autocomplete="off"
          bind:value={source}
          {disabled}
        />
      {/snippet}
    </Field>
  {/if}
</div>
