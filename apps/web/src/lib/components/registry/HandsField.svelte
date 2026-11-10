<script lang="ts">
  /**
   * The hands of a witness as a list: a label as the catalogues cite it
   * (m1, m2, A²), a description, and which hand is the scribe of the text.
   * Sent as one JSON field, `hands`; new hands get their ids on the server.
   */
  import { untrack } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { Button, IconButton, Input } from '$lib/components/ui';
  import { parseHandsJson } from '$lib/registry/witness';
  import { registry } from '$lib/strings/registry';

  interface Props {
    /** The hands as JSON: the witness's, or what was sent. */
    value?: string | null;
    error?: string | string[] | null;
  }

  let { value = '', error }: Props = $props();
  const s = registry.witness;
  const uid = $props.id();

  interface Row {
    id: string;
    label: string;
    description: string;
    main: boolean;
  }

  // The initial hands only; the fields own them from here on.
  let rows = $state<Row[]>(
    untrack(() =>
      parseHandsJson(value).map((h) => ({
        id: h.id,
        label: h.label,
        description: h.description ?? '',
        main: h.main,
      })),
    ),
  );
  const message = $derived(Array.isArray(error) ? error[0] : error || undefined);
  const payload = $derived(
    JSON.stringify(
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        description: r.description || null,
        main: r.main,
      })),
    ),
  );

  function add() {
    rows.push({ id: '', label: '', description: '', main: rows.length === 0 });
  }

  function remove(k: number) {
    const wasMain = rows[k]?.main ?? false;
    rows.splice(k, 1);
    if (wasMain && rows[0]) rows[0].main = true;
  }

  function setMain(k: number) {
    rows.forEach((row, i) => (row.main = i === k));
  }
</script>

<fieldset
  class="flex flex-col gap-2 font-sans"
  aria-describedby={message ? `hands-${uid}-error` : undefined}
>
  <legend class="mb-1.5 text-sm font-medium text-ink">{s.hands}</legend>
  <input type="hidden" name="hands" value={payload} />
  {#if rows.length}
    <div class="grid grid-cols-[7rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 text-sm">
      <span class="text-xs text-ink-soft">{s.handLabel}</span>
      <span class="text-xs text-ink-soft">{s.handDescription}</span>
      <span class="text-xs text-ink-soft">{s.handMain}</span>
      <span></span>
      {#each rows as row, k (k)}
        <Input
          bind:value={row.label}
          aria-label={s.handLabel}
          autocomplete="off"
          maxlength={40}
          class="font-serif text-base"
        />
        <Input
          bind:value={row.description}
          aria-label={s.handDescription}
          autocomplete="off"
          maxlength={500}
        />
        <input
          type="radio"
          name="hands-main-{uid}"
          checked={row.main}
          onchange={() => setMain(k)}
          aria-label={s.handMainOf(row.label)}
          class="size-4 justify-self-center accent-accent"
        />
        <IconButton label={s.removeHand(row.label)} onclick={() => remove(k)}
          ><X aria-hidden="true" /></IconButton
        >
      {/each}
    </div>
  {/if}
  <div>
    <Button type="button" variant="ghost" size="sm" onclick={add}>
      <Plus class="size-4" aria-hidden="true" />
      {s.addHand}
    </Button>
  </div>
  {#if message}<p id="hands-{uid}-error" class="text-xs text-danger" role="alert">{message}</p>{/if}
</fieldset>
