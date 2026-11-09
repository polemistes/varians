<script lang="ts">
  import {
    fetchMatches,
    hitDetail,
    SEARCH_DELAY,
    searchable,
    type RegistryKind,
  } from '$lib/registry/search';
  import type { SearchHit } from '$lib/registry/types';
  import { registry } from '$lib/strings/registry';

  interface Props {
    kind: RegistryKind;
    /** What has been typed: a title; a name and a shelfmark. Each is searched, the matches merged. */
    queries: string[];
  }

  let { kind, queries }: Props = $props();

  let hits = $state<SearchHit[]>([]);
  const wanted = $derived(searchable(queries));
  const key = $derived(wanted.join('\n'));

  $effect(() => {
    const current = key ? key.split('\n') : [];
    if (current.length === 0) {
      hits = [];
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchMatches(kind, current, controller.signal)
        .then((found) => {
          if (!controller.signal.aborted) hits = found;
        })
        .catch(() => {
          // A failed search leaves the form as it is: creating stays possible.
        });
    }, SEARCH_DELAY);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  const href = (hit: SearchHit) =>
    kind === 'work' ? `/works/${hit.slug}` : `/witnesses/${hit.slug}`;
</script>

<div aria-live="polite" class="empty:hidden">
  {#if hits.length && wanted.length}
    <div class="rounded-md border border-line bg-sunken px-3.5 py-3 font-sans text-sm">
      <p class="text-xs font-medium text-ink-soft">{registry.search.matches}</p>
      <ul class="mt-2 flex flex-col gap-1.5">
        {#each hits as hit (hit.id)}
          {@const detail = hitDetail(hit)}
          <li class="leading-snug">
            <span class="font-serif text-base text-ink">{hit.title}</span>{#if detail}<span
                class="text-ink-soft">, {detail}</span
              >{/if}
            <span class="text-ink-soft">{registry.search.existsPrefix}</span>
            <a
              href={href(hit)}
              class="text-accent underline-offset-2 hover:underline"
              aria-label={registry.search.useItLabel(hit.title)}>{registry.search.useIt}</a
            >
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
