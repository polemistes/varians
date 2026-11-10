<script lang="ts">
  /**
   * Search within the edition: the field in the header, the count of the
   * lines that match, and steps to the next and previous. Enter steps on,
   * Shift+Enter steps back, Escape clears.
   */
  import Search from '@lucide/svelte/icons/search';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import X from '@lucide/svelte/icons/x';
  import { reader as r } from '$lib/strings/reader';

  interface Props {
    query: string;
    /** Number of matching lines, and the 0-based current one. */
    count: number;
    current: number;
    oninput: (query: string) => void;
    onstep: (direction: 1 | -1) => void;
  }

  let { query, count, current, oninput, onstep }: Props = $props();

  let input = $state<HTMLInputElement | null>(null);

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      onstep(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      oninput('');
    }
  }

  /** Ctrl+F or Cmd+F stays the browser's; "/" focuses the field as in many readers. */
  function globalKey(event: KeyboardEvent) {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)))
      return;
    event.preventDefault();
    input?.focus();
  }
</script>

<svelte:window onkeydown={globalKey} />

<div class="reader-search flex min-w-0 items-center gap-1" role="search">
  <div class="relative min-w-0">
    <Search
      class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-muted"
      aria-hidden="true"
    />
    <input
      bind:this={input}
      type="search"
      value={query}
      placeholder={r.toolbar.searchPlaceholder}
      aria-label={r.toolbar.search}
      autocomplete="off"
      spellcheck="false"
      class="h-8 w-28 rounded-md border border-line bg-surface pr-2 pl-8 font-sans text-sm text-ink placeholder:text-ink-muted transition-[width,border-color] duration-150 focus:w-44 focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none sm:w-40 sm:focus:w-52 [&::-webkit-search-cancel-button]:hidden"
      oninput={(event) => oninput((event.currentTarget as HTMLInputElement).value)}
      onkeydown={keydown}
    />
  </div>
  {#if query.trim() !== ''}
    <span class="shrink-0 font-sans text-xs text-ink-muted tabular-nums" aria-live="polite">
      {count ? r.toolbar.searchCount(current + 1, count) : r.toolbar.searchNone}
    </span>
    <button
      type="button"
      class="inline-flex size-7 shrink-0 items-center justify-center rounded text-ink-soft hover:bg-sunken hover:text-ink disabled:opacity-40"
      aria-label={r.toolbar.searchPrevious}
      title={r.toolbar.searchPrevious}
      disabled={count === 0}
      onclick={() => onstep(-1)}
    >
      <ChevronUp class="size-4" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="inline-flex size-7 shrink-0 items-center justify-center rounded text-ink-soft hover:bg-sunken hover:text-ink disabled:opacity-40"
      aria-label={r.toolbar.searchNext}
      title={r.toolbar.searchNext}
      disabled={count === 0}
      onclick={() => onstep(1)}
    >
      <ChevronDown class="size-4" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="inline-flex size-7 shrink-0 items-center justify-center rounded text-ink-soft hover:bg-sunken hover:text-ink"
      aria-label={r.toolbar.searchClear}
      title={r.toolbar.searchClear}
      onclick={() => {
        oninput('');
        input?.focus();
      }}
    >
      <X class="size-4" aria-hidden="true" />
    </button>
  {/if}
</div>
