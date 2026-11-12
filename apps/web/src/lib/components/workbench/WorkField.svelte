<script lang="ts">
  /**
   * The work text is assigned to, where segments are named, lines numbered
   * and text imported. A transcript has no works of its own: the select
   * offers the works its text is already assigned to, in the order they
   * first occur, and those chosen during this visit; any other registered
   * work is found by ticking the box and searching. A work chosen so is
   * learnt from the server, added to the select and proposed for the rest
   * of the visit, and is stored nowhere: once text is assigned to it, the
   * text brings it back.
   */
  import { untrack } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import { Checkbox, Field, Input, Select, toasts } from '$lib/components/ui';
  import { fetchMatches, SEARCH_DELAY, searchable } from '$lib/registry/search';
  import type { SearchHit } from '$lib/registry/types';
  import { workbench as t } from '$lib/strings/workbench';
  import type { Workbench } from './workbench.svelte';

  interface Props {
    wb: Workbench;
    /** The id of the work chosen; empty for none. */
    value: string;
    /** The words of a first option that means no work, where an empty choice is allowed. */
    none?: string;
  }

  let { wb, value = $bindable(''), none }: Props = $props();

  const s = t.workField;
  const uid = $props.id();
  const searchId = `work-search-${uid}`;

  const options = $derived([
    ...(none !== undefined ? [{ value: '', label: none }] : []),
    ...wb.works.map((w) => ({ value: w.id, label: w.title })),
  ]);

  // Where the select has no work to offer, the search is open from the start.
  let another = $state(untrack(() => wb.works.length === 0));
  let query = $state('');
  let hits = $state<SearchHit[]>([]);
  let choosing = $state(false);

  $effect(() => {
    const wanted = another ? searchable([query]) : [];
    if (wanted.length === 0) {
      hits = [];
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchMatches('work', wanted, controller.signal)
        .then((found) => {
          if (!controller.signal.aborted) hits = found;
        })
        .catch(() => {
          // Nothing found: the list stays as it is.
        });
    }, SEARCH_DELAY);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  async function choose(hit: SearchHit) {
    if (choosing) return;
    choosing = true;
    const work = await wb.chooseWork(hit.id);
    choosing = false;
    if (!work) {
      toasts.error(s.failed);
      return;
    }
    value = work.id;
    another = false;
    query = '';
  }

  /** Enter in the search chooses the first work found, and never sends the window's form. */
  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (hits[0]) void choose(hits[0]);
  }
</script>

<div class="flex flex-col gap-2">
  <Field label={s.label}>
    {#snippet children(control)}
      <Select {...control} bind:value {options} />
    {/snippet}
  </Field>
  <Checkbox bind:checked={another}>{s.another}</Checkbox>
  {#if another}
    <div class="relative">
      <label for={searchId} class="sr-only">{s.search}</label>
      <Search
        class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />
      <Input
        id={searchId}
        type="search"
        bind:value={query}
        placeholder={s.search}
        autocomplete="off"
        class="pl-9"
        {onkeydown}
      />
    </div>
    {#if hits.length}
      <ul
        class="flex max-h-48 flex-col divide-y divide-line overflow-y-auto rounded-md border border-line bg-surface"
      >
        {#each hits as hit (hit.id)}
          <li>
            <button
              type="button"
              class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-sunken disabled:opacity-50"
              disabled={choosing}
              onclick={() => choose(hit)}
            >
              <span class="font-serif text-base text-ink">{hit.title}</span>
              {#if hit.author}<span class="text-xs text-ink-muted">{hit.author}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
