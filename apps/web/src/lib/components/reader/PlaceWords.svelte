<script lang="ts">
  /**
   * The edition's words at a variant place, in the text's serif; where the
   * edition has nothing (a witness adds words), the word the place follows
   * or precedes.
   */
  import { fill, type SiteExplanation } from '$lib/reader/explain';
  import { reader as r } from '$lib/strings/reader';
  import ExplainSentence from './ExplainSentence.svelte';

  interface Props {
    explanation: Pick<SiteExplanation, 'words' | 'place'>;
    lang: string;
    class?: string;
  }

  let { explanation, lang, class: className }: Props = $props();

  const where = $derived(
    explanation.place
      ? fill(explanation.place.side === 'after' ? r.explain.after : r.explain.before, { words: [{ kind: 'words', text: explanation.place.word }] })
      : [],
  );
</script>

{#if explanation.words}
  <span class={['words', className]} {lang} dir="auto">{explanation.words}</span>
{:else if where.length}
  <span class={['where', className]}><ExplainSentence sentence={where} {lang} /></span>
{/if}

<style>
  .words {
    font-family: var(--font-serif);
    color: var(--color-ink);
  }

  .where {
    font-family: var(--font-sans);
    font-size: 0.8em;
    color: var(--color-ink-muted);
  }

  .where :global(.words) {
    font-size: 1.25em;
  }
</style>
