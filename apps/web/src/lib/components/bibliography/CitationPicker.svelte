<script lang="ts">
  /**
   * The works a conjecture or note cites: chosen from the shared
   * bibliography by search, each with what comes before the label ("cf.")
   * and after it (pages).
   */
  import X from '@lucide/svelte/icons/x';
  import Search from '@lucide/svelte/icons/search';
  import { IconButton, Input } from '$lib/components/ui';
  import type { CitationDraft } from '$lib/bibliography/types';
  import { bibStrings as t } from '$lib/strings/bibliography';

  interface Props {
    value: CitationDraft[];
  }

  let { value = $bindable() }: Props = $props();
  const id = $props.id();

  let query = $state('');
  let results = $state<{ id: string; label: string; reference: string }[]>([]);
  let searched = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;

  function search(q: string) {
    clearTimeout(timer);
    if (!q.trim()) {
      results = [];
      searched = false;
      return;
    }
    timer = setTimeout(async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`/api/bibliography/search?q=${encodeURIComponent(q.trim())}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = (await response.json()) as { items: { id: string; label: string; reference: string }[] };
        results = data.items.filter((item) => !value.some((c) => c.itemId === item.id)).slice(0, 6);
        searched = true;
      } catch {
        // A newer search replaced this one.
      }
    }, 200);
  }

  function choose(item: { id: string; label: string }) {
    value = [...value, { itemId: item.id, label: item.label, prenote: '', postnote: '' }];
    query = '';
    results = [];
    searched = false;
  }

  function remove(index: number) {
    value = value.filter((_, i) => i !== index);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      // Enter takes the first match rather than submitting the surrounding form.
      event.preventDefault();
      if (results[0]) choose(results[0]);
    }
  }
</script>

<fieldset class="flex flex-col gap-2 font-sans">
  <legend class="text-sm font-medium text-ink">{t.picker.label}</legend>
  {#if value.length}
    <ul class="flex flex-col gap-1.5">
      {#each value as citation, i (citation.itemId)}
        <li class="flex items-center gap-2">
          <div class="w-16 shrink-0">
            <Input bind:value={citation.prenote} aria-label={t.picker.prenote} placeholder={t.picker.prenotePlaceholder} class="text-xs" />
          </div>
          <span class="min-w-0 flex-1 truncate text-sm text-ink">{citation.label}</span>
          <div class="w-28 shrink-0">
            <Input bind:value={citation.postnote} aria-label={t.picker.postnote} placeholder={t.picker.postnotePlaceholder} class="text-xs" />
          </div>
          <IconButton label={t.picker.remove(citation.label)} size="sm" onclick={() => remove(i)}>
            <X class="size-4" aria-hidden="true" />
          </IconButton>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="relative">
    <label for="cite-{id}" class="sr-only">{t.picker.search}</label>
    <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
    <Input
      id="cite-{id}"
      type="search"
      bind:value={query}
      oninput={() => search(query)}
      {onkeydown}
      placeholder={t.picker.placeholder}
      autocomplete="off"
      class="pl-9"
    />
  </div>
  {#if results.length}
    <ul class="flex flex-col rounded-md border border-line bg-surface">
      {#each results as item (item.id)}
        <li>
          <button
            type="button"
            class="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
            onclick={() => choose(item)}
          >
            <span class="text-sm font-medium text-ink">{item.label}</span>
            <span class="line-clamp-1 font-serif text-xs text-ink-soft">{item.reference}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if searched}
    <p class="text-xs text-ink-soft">{t.picker.none} <a href="/bibliography" target="_blank" class="text-accent underline">{t.picker.manage}</a></p>
  {/if}
</fieldset>
