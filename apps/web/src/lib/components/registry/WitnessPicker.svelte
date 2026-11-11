<script lang="ts">
  /**
   * A witness found in the registry. On a work's page it is transcribed: the
   * form posts ?/transcribe. With `onchoose` it is handed over instead, for a
   * conspectus: the witnesses suggested (those with a transcript of the work
   * first) are listed before anything is typed, none of them chosen, and
   * those already in the conspectus cannot be chosen again.
   */
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import { Button, Checkbox, Dialog, Input, Notice, Spinner, toasts } from '$lib/components/ui';
  import type { SuggestedWitness } from '$lib/edition/conspectus';
  import { fetchMatches, hitDetail, SEARCH_DELAY, searchable } from '$lib/registry/search';
  import type { SearchHit } from '$lib/registry/types';
  import { edition } from '$lib/strings/edition';
  import { registry } from '$lib/strings/registry';
  import { autofocus } from './focus';

  interface Props {
    open?: boolean;
    /** Where "register a new witness" leads; it comes back here with the new witness chosen. */
    newWitnessHref?: string;
    /** A witness chosen from the start, such as one just registered. */
    initial?: SearchHit | null;
    /** Hands the witness chosen over, in place of transcribing it; the window closes when it resolves. */
    onchoose?: (hit: SearchHit) => void | Promise<void>;
    /** Add New Witness, in place of the link to the New Witness page. */
    onnew?: () => void;
    /** Listed first, and before anything is typed. */
    suggestions?: SuggestedWitness[];
    /** Witnesses that cannot be chosen, being chosen already. */
    present?: string[];
  }

  let {
    open = $bindable(false),
    newWitnessHref = '/witnesses/new',
    initial = null,
    onchoose,
    onnew,
    suggestions = [],
    present = [],
  }: Props = $props();

  const s = registry.picker;
  const p = edition.conspectus.picker;
  const choosing = $derived(!!onchoose);
  const uid = $props.id();
  const formId = `picker-${uid}`;
  const searchId = `picker-search-${uid}`;

  let query = $state('');
  let hits = $state<SearchHit[]>([]);
  let searching = $state(false);
  let chosen = $state<SearchHit | null>(null);
  let submitting = $state(false);
  let error = $state<string | null>(null);

  const asHit = (w: SuggestedWitness): SearchHit => ({
    id: w.id,
    slug: w.slug,
    title: w.name,
    author: null,
    siglum: w.siglum,
    shelfmark: null,
    settlement: null,
  });

  const typed = $derived(searchable([query]));

  /** The rows: the suggestions that match what is typed, then the hits of the search. */
  const shown = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase();
    const suggested = suggestions
      .filter(
        (w) =>
          !needle ||
          w.name.toLocaleLowerCase().includes(needle) ||
          w.siglum.toLocaleLowerCase().includes(needle),
      )
      .map((w) => ({ hit: asHit(w), note: w.reason === 'reported' ? p.reported : p.transcribed }));
    const seen = new Set(suggested.map((r) => r.hit.id));
    const found = (typed.length ? hits : []).filter((h) => !seen.has(h.id));
    const rows = [...suggested, ...found.map((hit) => ({ hit, note: null as string | null }))];
    if (chosen && !rows.some((r) => r.hit.id === chosen!.id))
      rows.unshift({ hit: chosen, note: null });
    return rows;
  });

  // Every opening starts afresh, with the initial witness when there is one.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      query = '';
      hits = initial ? [initial] : [];
      chosen = initial;
      error = null;
    });
  });

  $effect(() => {
    const wanted = typed;
    if (wanted.length === 0) {
      searching = false;
      return;
    }
    const controller = new AbortController();
    searching = true;
    const timer = setTimeout(() => {
      fetchMatches('witness', wanted, controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          hits = found;
          searching = false;
        })
        .catch(() => {
          if (!controller.signal.aborted) searching = false;
        });
    }, SEARCH_DELAY);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  async function hand(hit: SearchHit) {
    submitting = true;
    error = null;
    try {
      await onchoose!(hit);
      open = false;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      submitting = false;
    }
  }

  const submit: SubmitFunction = ({ cancel }) => {
    if (!chosen || choosing) {
      cancel();
      if (chosen && choosing) void hand(chosen);
      return;
    }
    const name = chosen.title;
    submitting = true;
    error = null;
    return async ({ result, update }) => {
      submitting = false;
      if (result.type === 'redirect' || result.type === 'success') {
        toasts.success(registry.transcription.createdFor(name));
        await update();
      } else if (result.type === 'failure') {
        error = String(result.data?.error ?? registry.common.forbidden);
      } else {
        error = result.error?.message ?? registry.common.forbidden;
      }
    };
  };
</script>

<Dialog bind:open title={choosing ? p.title : s.title} size="md">
  <form
    id={formId}
    method="post"
    action="?/transcribe"
    class="flex flex-col gap-4"
    use:enhance={submit}
  >
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
        {@attach autofocus}
      />
      {#if searching}
        <Spinner size="sm" class="absolute top-1/2 right-3 -translate-y-1/2 text-ink-muted" />
      {/if}
    </div>

    <fieldset class="min-w-0">
      <legend class="sr-only">{s.results}</legend>
      {#if shown.length}
        <ul class="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
          {#each shown as { hit, note } (hit.id)}
            {@const detail = hitDetail(hit)}
            {@const taken = present.includes(hit.id)}
            <li>
              <label
                class={[
                  'flex items-start gap-3 px-3 py-2 transition-colors has-[:checked]:bg-accent-soft',
                  taken ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-sunken',
                ]}
              >
                <input
                  type="radio"
                  name="witnessId"
                  value={hit.id}
                  checked={chosen?.id === hit.id}
                  disabled={taken}
                  onchange={() => (chosen = hit)}
                  class="mt-1 size-4 shrink-0 accent-accent"
                />
                <span class="min-w-0 flex-1">
                  <span class="block font-serif text-base leading-snug text-ink">{hit.title}</span>
                  {#if detail}<span class="block font-sans text-xs text-ink-soft">{detail}</span
                    >{/if}
                </span>
                {#if taken || note}
                  <span class="mt-0.5 shrink-0 font-sans text-xs text-ink-muted"
                    >{taken ? p.present : note}</span
                  >
                {/if}
              </label>
            </li>
          {/each}
        </ul>
      {:else}
        <p
          class="rounded-md border border-dashed border-line px-3 py-4 text-center font-sans text-sm text-ink-soft"
          aria-live="polite"
        >
          {typed.length && !searching ? s.noMatches : s.typeToSearch}
        </p>
      {/if}
    </fieldset>

    {#if !choosing}
      <Checkbox name="keepsWrittenForm">
        {registry.transcription.keepsWritten}
      </Checkbox>
    {/if}

    {#if onnew}
      <div>
        <Button type="button" variant="secondary" size="sm" onclick={onnew}>
          <Plus class="size-4" aria-hidden="true" />
          {edition.conspectus.addNewWitness}
        </Button>
      </div>
    {:else}
      <a
        href={newWitnessHref}
        class="inline-flex items-center gap-1.5 self-start font-sans text-sm text-accent hover:underline"
      >
        <Plus class="size-4" aria-hidden="true" />
        {s.newWitness}
      </a>
    {/if}

    {#if error}
      <Notice kind="error">{error}</Notice>
    {/if}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>{registry.common.cancel}</Button>
    <Button
      type="submit"
      form={formId}
      variant="primary"
      loading={submitting}
      disabled={!chosen || present.includes(chosen.id)}>{choosing ? p.add : s.create}</Button
    >
  {/snippet}
</Dialog>
