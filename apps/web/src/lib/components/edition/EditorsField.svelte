<script lang="ts">
  /** The editors of an edition as a list of names: one field each, sent as repeated `editors` fields. */
  import { untrack } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { Button, IconButton, Input } from '$lib/components/ui';
  import { edition as s } from '$lib/strings/edition';

  interface Props {
    /** The names at first; one empty field when there are none. */
    names?: string[];
    error?: string | string[] | null;
  }

  let { names = [], error }: Props = $props();
  const uid = $props.id();
  // The initial names only; the fields own them from here on.
  let list = $state<string[]>(untrack(() => (names.length ? [...names] : [''])));
  const message = $derived(Array.isArray(error) ? error[0] : error || undefined);

  function remove(k: number) {
    list.splice(k, 1);
    if (list.length === 0) list.push('');
  }
</script>

<fieldset
  class="flex flex-col gap-2 font-sans"
  aria-describedby={message ? `editors-${uid}-error` : undefined}
>
  <!-- The section the fields stand in is headed Editors; the legend names the group for a screen reader. -->
  <legend class="sr-only">{s.editors}</legend>
  {#each list as _, k (k)}
    <div class="flex items-center gap-2">
      <Input
        name="editors"
        bind:value={list[k]}
        aria-label={s.editorName(k + 1)}
        autocomplete="off"
        maxlength={200}
        class="font-serif text-base"
      />
      <IconButton
        label={s.removeEditor(list[k] ?? '')}
        onclick={() => remove(k)}
        disabled={list.length === 1 && !list[0]}
      >
        <X aria-hidden="true" />
      </IconButton>
    </div>
  {/each}
  <div>
    <Button type="button" variant="ghost" size="sm" onclick={() => list.push('')}>
      <Plus class="size-4" aria-hidden="true" />
      {s.addEditor}
    </Button>
  </div>
  {#if message}<p id="editors-{uid}-error" class="text-xs text-danger" role="alert">
      {message}
    </p>{/if}
</fieldset>
