<script lang="ts">
  /**
   * The variants of the lines on screen, explained: for each segment with
   * variant places, a card with its label and, for each place, the edition's
   * words and the same explanation the popover gives; then what belongs to
   * the segment as a whole (conjectures no place took, notes). Hovering a
   * place lights its words in the text; clicking it scrolls to them and
   * opens their popover.
   */
  import X from '@lucide/svelte/icons/x';
  import type { SegmentVariants, SiteExplanation } from '$lib/reader/explain';
  import { fill, plainSentence } from '$lib/reader/explain';
  import { reader as r } from '$lib/strings/reader';
  import ExplainSentence from './ExplainSentence.svelte';
  import PlaceWords from './PlaceWords.svelte';
  import ReaderNotes from './ReaderNotes.svelte';
  import VariantExplanation from './VariantExplanation.svelte';

  interface Props {
    groups: SegmentVariants[];
    /** Whether any text is on screen at all. */
    onScreen: boolean;
    lang: string;
    /** The place whose popover is open, marked in the list. */
    active: string[];
    onhover: (keys: string[]) => void;
    onopen: (key: string, from: HTMLElement) => void;
    onclose: () => void;
  }

  let { groups, onScreen, lang, active, onhover, onopen, onclose }: Props = $props();

  function wordsOf(place: SiteExplanation): string {
    if (place.words) return place.words;
    if (!place.place) return '';
    return plainSentence(fill(place.place.side === 'after' ? r.explain.after : r.explain.before, { words: [{ kind: 'words', text: place.place.word }] }));
  }

  function open(event: MouseEvent, key: string) {
    // Selecting text in a card is not opening it.
    if (window.getSelection()?.toString()) return;
    const card = event.currentTarget as HTMLElement;
    onopen(key, card.querySelector<HTMLElement>('.place-words') ?? card);
  }
</script>

<section class="panel" aria-labelledby="variants-panel-title">
  <header class="panel-header">
    <h2 id="variants-panel-title" class="panel-title">{r.panels.variants}</h2>
    <button type="button" class="panel-close" aria-label={r.panels.close(r.toolbar.variants)} title={r.panels.close(r.toolbar.variants)} onclick={onclose}>
      <X class="size-4" aria-hidden="true" />
    </button>
  </header>

  <div class="body">
    {#if !onScreen}
      <p class="empty">{r.panels.variantsNothingOnScreen}</p>
    {:else if groups.length === 0}
      <p class="empty">{r.panels.variantsNone}</p>
    {:else}
      <ol class="cards">
        {#each groups as group (group.segmentId)}
          <li class="card">
            <h3 class="card-label">{group.label}</h3>
            {#each group.places as place (place.key)}
              <!-- The words are the place's button for the keyboard; the whole place answers the pointer. -->
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <div
                class={['place', active.includes(place.key) && 'active']}
                data-variant-place={place.key}
                onpointerenter={() => onhover([place.key])}
                onpointerleave={() => onhover([])}
                onclick={(event) => open(event, place.key)}
              >
                <button
                  type="button"
                  class="place-words"
                  aria-haspopup="dialog"
                  aria-label={r.panels.variantsShow(wordsOf(place), place.label)}
                  onfocus={() => onhover([place.key])}
                  onblur={() => onhover([])}
                >
                  <PlaceWords explanation={place} {lang} />
                </button>
                <VariantExplanation explanation={place} {lang} compact />
              </div>
            {/each}
            {#if group.unplaced.length}
              <ul class="unplaced">
                {#each group.unplaced as line, k (k)}
                  <li><ExplainSentence sentence={line.sentence} {lang} />{#if line.references.length}{' '}<span class="refs">{line.references.join('; ')}</span>{/if}</li>
                {/each}
              </ul>
            {/if}
            {#if group.notes.length}
              <div class="segment-notes"><ReaderNotes notes={group.notes} compact /></div>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</section>

<style>
  .panel {
    border: 1px solid var(--color-line);
    border-radius: 0.5rem;
    background: var(--color-surface);
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem 0.4rem 1rem;
  }

  .panel-title {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }

  .panel-close {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.375rem;
    color: var(--color-ink-muted);
  }

  .panel-close:hover {
    background: var(--color-sunken);
    color: var(--color-ink);
  }

  .body {
    padding: 0 0.75rem 0.75rem;
  }

  .empty {
    padding: 0 0.25rem 0.25rem;
    font-size: 0.875rem;
    color: var(--color-ink-muted);
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .card {
    border: 1px solid var(--color-line);
    border-radius: 0.4rem;
    padding: 0.55rem 0.4rem 0.4rem;
  }

  .card-label {
    padding: 0 0.5rem 0.15rem;
    font-family: var(--font-sans);
    font-size: 0.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--color-ink-soft);
  }

  .place {
    cursor: pointer;
    border-radius: 0.3rem;
    padding: 0.4rem 0.5rem 0.5rem;
    transition: background-color 120ms ease-out;
  }

  .place + .place {
    margin-top: 0.15rem;
    border-top: 1px solid var(--color-line);
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  .place:hover,
  .place:focus-within {
    background: var(--color-sunken);
  }

  .place.active {
    background: var(--color-accent-soft);
  }

  .place-words {
    display: inline-block;
    margin-bottom: 0.3rem;
    border-radius: 0.2rem;
    font-size: 1.2rem;
    line-height: 1.35;
    text-align: start;
  }

  .place-words:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .unplaced {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.45rem 0.5rem 0.3rem;
    border-top: 1px solid var(--color-line);
    font-size: 0.8125rem;
    line-height: 1.55;
    color: var(--color-ink-soft);
  }

  .refs {
    font-size: 0.85em;
    color: var(--color-ink-muted);
  }

  .segment-notes {
    padding: 0.35rem 0.5rem 0.2rem;
    border-top: 1px solid var(--color-line);
  }

  .card-label + .segment-notes,
  .card-label + .unplaced {
    border-top: 0;
  }
</style>
