<script lang="ts">
  /**
   * The registry's witnesses to choose from, on the page itself: a search
   * field over a list, each witness with Choose, so that several are chosen
   * one after another. Those suggested for the work (with a transcript of
   * it, or with reported readings) come first; those the conspectus has
   * already are left out.
   */
  import { untrack } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import { Button, Input } from '$lib/components/ui';
  import type { SuggestedWitness } from '$lib/edition/conspectus';
  import { hitDetail, SEARCH_DELAY } from '$lib/registry/search';
  import type { SearchHit } from '$lib/registry/types';
  import { edition } from '$lib/strings/edition';

  interface Props {
    /** The witnesses of the conspectus, which are not offered again. */
    present: string[];
    suggestions: SuggestedWitness[];
    /** Takes the witness into the conspectus; a refusal is shown under the search field. */
    onchoose: (hit: SearchHit) => Promise<void>;
  }

  let { present, suggestions, onchoose }: Props = $props();

  const t = edition.conspectus;
  const uid = $props.id();

  let query = $state('');
  let listed = $state<SearchHit[]>([]);
  /** The query the list answers; null until the first answer has come. */
  let answered = $state<string | null>(null);
  let choosing = $state<string | null>(null);
  let error = $state<string | null>(null);

  // The list follows what is typed, after a pause; the first list comes at once.
  $effect(() => {
    const wanted = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        fetch(`/api/witnesses?q=${encodeURIComponent(wanted)}`, { signal: controller.signal })
          .then((response) => (response.ok ? response.json() : { witnesses: [] }))
          .then((body: { witnesses?: SearchHit[] }) => {
            if (controller.signal.aborted) return;
            listed = body.witnesses ?? [];
            answered = wanted;
          })
          .catch(() => {});
      },
      untrack(() => answered) === null ? 0 : SEARCH_DELAY,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  /** The rows: the suggestions that match what is typed, then the registry's list. */
  const shown = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase();
    const taken = new Set(present);
    const byId = new Map(listed.map((hit) => [hit.id, hit]));
    const suggested = suggestions
      .filter(
        (w) =>
          !taken.has(w.id) &&
          (!needle ||
            w.name.toLocaleLowerCase().includes(needle) ||
            w.siglum.toLocaleLowerCase().includes(needle)),
      )
      .map((w) => ({
        hit:
          byId.get(w.id) ??
          ({
            id: w.id,
            slug: w.slug,
            title: w.name,
            author: null,
            siglum: w.siglum,
            shelfmark: null,
            settlement: null,
          } satisfies SearchHit),
        note: w.reason === 'reported' ? t.picker.reported : t.picker.transcribed,
      }));
    const seen = new Set(suggested.map((row) => row.hit.id));
    return [
      ...suggested,
      ...listed
        .filter((hit) => !taken.has(hit.id) && !seen.has(hit.id))
        .map((hit) => ({ hit, note: null as string | null })),
    ];
  });

  async function choose(hit: SearchHit) {
    choosing = hit.id;
    error = null;
    try {
      await onchoose(hit);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      choosing = null;
    }
  }
</script>

<!-- data-search: Enter in the field searches and does not save the page. -->
<div class="flex flex-col gap-3" data-search>
  <div class="relative">
    <label for="witness-search-{uid}" class="sr-only">{t.search}</label>
    <Search
      class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
      aria-hidden="true"
    />
    <Input
      id="witness-search-{uid}"
      type="search"
      bind:value={query}
      autocomplete="off"
      class="pl-9"
      placeholder={t.search}
    />
  </div>
  {#if error}<p class="font-sans text-xs text-danger" role="alert">{error}</p>{/if}
  {#if shown.length}
    <ul
      class="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface"
    >
      {#each shown as { hit, note } (hit.id)}
        {@const detail = [hitDetail(hit), note].filter(Boolean).join(' · ')}
        <li class="flex items-center gap-4 px-4 py-2.5">
          <span class="min-w-0 flex-1">
            {#if detail}<span class="block font-sans text-xs text-ink-muted">{detail}</span>{/if}
            <span class="font-serif text-base text-ink">{hit.title}</span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${edition.choose}: ${hit.title}`}
            disabled={choosing !== null}
            onclick={() => choose(hit)}>{edition.choose}</Button
          >
        </li>
      {/each}
    </ul>
  {:else if answered !== null}
    <p class="font-sans text-sm text-ink-soft">
      {query.trim()
        ? t.noWitnessesFor(query.trim())
        : present.length
          ? t.noOtherWitnesses
          : t.noWitnesses}
    </p>
  {/if}
</div>
