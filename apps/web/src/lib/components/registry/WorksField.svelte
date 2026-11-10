<script lang="ts" module>
  export interface ChosenWork {
    id: string;
    title: string;
  }
</script>

<script lang="ts">
  /**
   * The works a transcription is for, in order, as a form field: each sent
   * as a `workIds` value. Works are found by typing their title or author;
   * the first gives the transcription's defaults (the segment labels offered,
   * the spelling rules for text not yet assigned to a work).
   */
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import X from '@lucide/svelte/icons/x';
  import { Input } from '$lib/components/ui';
  import { fetchMatches, SEARCH_DELAY, searchable } from '$lib/registry/search';
  import type { SearchHit } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';

  interface Props {
    works: ChosenWork[];
    name?: string;
  }

  let { works = $bindable([]), name = 'workIds' }: Props = $props();

  const s = registry.transcription.works;

  let query = $state('');
  let hits = $state<SearchHit[]>([]);

  $effect(() => {
    const wanted = searchable([query]);
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

  const offered = $derived(hits.filter((h) => !works.some((w) => w.id === h.id)));

  function add(hit: SearchHit) {
    works = [...works, { id: hit.id, title: hit.title }];
    query = '';
  }

  function remove(id: string) {
    works = works.filter((w) => w.id !== id);
  }

  function raise(index: number) {
    if (index === 0) return;
    const next = [...works];
    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
    works = next;
  }
</script>

<fieldset class="flex flex-col gap-2">
  <legend class="mb-1 text-sm font-medium text-ink">{s.label}</legend>
  <p class="text-xs text-ink-muted">{s.hint}</p>
  {#if works.length}
    <ol class="divide-y divide-line rounded-md border border-line">
      {#each works as work, i (work.id)}
        <li class="flex items-center gap-2 px-3 py-1.5 text-sm">
          <input type="hidden" {name} value={work.id} />
          <span class="flex-1 truncate font-serif">{work.title}</span>
          {#if i === 0}<span class="text-xs text-ink-muted">{s.first}</span>{/if}
          {#if i > 0}
            <button
              type="button"
              class="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink"
              title={s.raise}
              aria-label={s.raiseLabel(work.title)}
              onclick={() => raise(i)}
            >
              <ArrowUp class="size-3.5" aria-hidden="true" />
            </button>
          {/if}
          <button
            type="button"
            class="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink"
            title={s.remove}
            aria-label={s.removeLabel(work.title)}
            onclick={() => remove(work.id)}
          >
            <X class="size-3.5" aria-hidden="true" />
          </button>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="text-sm text-ink-soft">{s.none}</p>
  {/if}
  <Input bind:value={query} placeholder={s.find} aria-label={s.find} autocomplete="off" />
  {#if offered.length}
    <ul class="flex flex-col rounded-md border border-line bg-surface">
      {#each offered as hit (hit.id)}
        <li>
          <button
            type="button"
            class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-sunken"
            onclick={() => add(hit)}
          >
            <span class="font-serif">{hit.title}</span>
            {#if hit.author}<span class="text-xs text-ink-muted">{hit.author}</span>{/if}
            <span class="ml-auto text-xs text-accent">{s.add}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</fieldset>
