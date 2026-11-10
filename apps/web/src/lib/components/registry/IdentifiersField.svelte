<script lang="ts">
  /**
   * The canonical identifiers of a work or witness as a list of rows, each a
   * scheme and a value. Sent as one JSON field, `identifiers`; the server
   * checks and normalizes the values.
   */
  import { untrack } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { Button, IconButton, Input, Select } from '$lib/components/ui';
  import { IDENTIFIER_SCHEMES, identifierRows } from '$lib/registry/identifiers';
  import { registry } from '$lib/strings/registry';

  interface Props {
    /** The identifiers as JSON: the entry's, or what was sent. */
    value?: string | null;
    error?: string | string[] | null;
  }

  let { value = '', error }: Props = $props();
  const s = registry.identifiers;
  const uid = $props.id();
  const options = IDENTIFIER_SCHEMES.map((scheme) => ({
    value: scheme,
    label: s.schemes[scheme] ?? scheme,
  }));

  // The initial rows only; the fields own them from here on.
  let rows = $state<{ scheme: string; value: string }[]>(untrack(() => identifierRows(value)));
  const message = $derived(Array.isArray(error) ? error[0] : error || undefined);
  const payload = $derived(JSON.stringify(rows.filter((r) => r.value.trim() !== '')));

  function add() {
    rows.push({ scheme: rows.at(-1)?.scheme ?? 'cts', value: '' });
  }
</script>

<fieldset
  class="flex flex-col gap-2 font-sans"
  aria-describedby={message ? `identifiers-${uid}-error` : undefined}
>
  <legend class="mb-1.5 text-sm font-medium text-ink">{s.label}</legend>
  <input type="hidden" name="identifiers" value={payload} />
  {#if rows.length}
    <div class="grid grid-cols-[10rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 text-sm">
      <span class="text-xs text-ink-soft">{s.scheme}</span>
      <span class="text-xs text-ink-soft">{s.value}</span>
      <span></span>
      {#each rows as row, k (k)}
        <Select bind:value={row.scheme} {options} aria-label={s.schemeOf(row.value)} />
        <Input
          bind:value={row.value}
          aria-label={s.value}
          autocomplete="off"
          spellcheck="false"
          maxlength={300}
        />
        <IconButton label={s.remove(row.value)} onclick={() => rows.splice(k, 1)}
          ><X aria-hidden="true" /></IconButton
        >
      {/each}
    </div>
  {/if}
  <div>
    <Button type="button" variant="ghost" size="sm" onclick={add}>
      <Plus class="size-4" aria-hidden="true" />
      {s.add}
    </Button>
  </div>
  {#if message}<p id="identifiers-{uid}-error" class="text-xs text-danger" role="alert">
      {message}
    </p>{/if}
</fieldset>
