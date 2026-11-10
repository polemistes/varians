<script lang="ts">
  /** A search that stays in the address: a GET form with one field, and a way back to the whole list. */
  import Search from '@lucide/svelte/icons/search';
  import { Button, Input } from '$lib/components/ui';
  import { site } from '$lib/strings/site';

  interface Props {
    /** Where the form goes. */
    action: string;
    /** The query in force, from the address. */
    query: string;
    label: string;
    placeholder?: string;
  }

  let { action, query, label, placeholder }: Props = $props();
  const id = $props.id();
  let value = $derived(query);
</script>

<form
  method="get"
  {action}
  role="search"
  class="flex flex-wrap items-center gap-2 font-sans"
  data-sveltekit-keepfocus
>
  <label for="search-{id}" class="sr-only">{label}</label>
  <div class="relative w-80 max-w-full">
    <Search
      class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
      aria-hidden="true"
    />
    <Input
      id="search-{id}"
      name="q"
      type="search"
      bind:value
      {placeholder}
      autocomplete="off"
      class="pl-9"
    />
  </div>
  <Button type="submit" variant="secondary">{site.search.action}</Button>
  {#if query}<Button href={action} variant="ghost">{site.search.clear}</Button>{/if}
</form>
