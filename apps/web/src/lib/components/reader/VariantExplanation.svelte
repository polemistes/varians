<script lang="ts">
  /**
   * A variant place explained in plain sentences: what the edition prints
   * and on what authority, one line per alternative, the witnesses without
   * the passage, and the editor's notes on the words. The popover on a word and the list of variants both
   * show it, from the same explanation.
   */
  import type { SiteExplanation } from '$lib/reader/explain';
  import { reader as r } from '$lib/strings/reader';
  import ExplainSentence from './ExplainSentence.svelte';
  import ReaderNotes from './ReaderNotes.svelte';

  interface Props {
    explanation: SiteExplanation;
    lang: string;
    /** Smaller type, for the list of variants. */
    compact?: boolean;
  }

  let { explanation, lang, compact = false }: Props = $props();
</script>

<div class={['explanation', compact && 'compact']}>
  {#each explanation.authority as sentence, k (k)}
    <p class="authority"><ExplainSentence {sentence} {lang} />{#if k === explanation.authority.length - 1 && explanation.authorityReferences.length}{' '}<span class="refs">{explanation.authorityReferences.join('; ')}</span>{/if}</p>
  {/each}

  {#if explanation.lines.length}
    <ul class="lines">
      {#each explanation.lines as line, k (k)}
        <li><ExplainSentence sentence={line.sentence} {lang} />{#if line.references.length}{' '}<span class="refs">{line.references.join('; ')}</span>{/if}</li>
      {/each}
    </ul>
  {/if}

  {#if explanation.absent}
    <p class="absent"><ExplainSentence sentence={explanation.absent.sentence} {lang} /></p>
  {/if}

  {#if explanation.notes.length}
    <ReaderNotes notes={explanation.notes} {compact} />
  {/if}
</div>

<style>
  .explanation {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    font-family: var(--font-sans);
    font-size: 0.875rem;
    line-height: 1.55;
    color: var(--color-ink-soft);
  }

  .compact {
    gap: 0.35rem;
    font-size: 0.8125rem;
  }

  .authority {
    color: var(--color-ink);
  }

  .lines {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .refs {
    font-size: 0.85em;
    color: var(--color-ink-muted);
    white-space: nowrap;
  }


  .absent {
    font-size: 0.92em;
    color: var(--color-ink-muted);
  }
</style>
